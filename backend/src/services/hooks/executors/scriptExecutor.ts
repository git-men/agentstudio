import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import type {
  HookContext,
  HookEvent,
  HookExecutionResult,
  InterceptorExecutionResult,
  PlatformHook,
} from '../../../types/platformHooks.js';
import type { ExecutionOptions, InterceptorExecutor } from './types.js';
import { parseHookDecision } from '../decisionValidator.js';

const MAX_OUTPUT_BYTES = 10 * 1024;

export class ScriptExecutor implements InterceptorExecutor {
  readonly type = 'script';

  async execute(
    hook: PlatformHook,
    event: HookEvent,
    options: ExecutionOptions,
  ): Promise<HookExecutionResult> {
    const action = hook.action;
    if (action.type !== 'script') {
      return { success: false, duration: 0, timedOut: false, error: 'Invalid action type for ScriptExecutor' };
    }

    const start = Date.now();
    const timeout = options.timeout || hook.timeout;

    try {
      await access(action.path, constants.R_OK);
    } catch {
      return {
        success: false,
        duration: Date.now() - start,
        timedOut: false,
        error: `Script file not found or not readable: ${action.path}`,
      };
    }

    const args = [action.path, JSON.stringify(event), ...(action.args ?? [])];

    return new Promise<HookExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn('node', args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, HOOK_EVENT: JSON.stringify(event) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let timer: NodeJS.Timeout | undefined;
      if (timeout > 0) {
        timer = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 1000);
        }, timeout);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        resolve({
          success: false,
          duration: Date.now() - start,
          timedOut: false,
          error: err.message,
        });
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).slice(0, MAX_OUTPUT_BYTES);
        resolve({
          success: code === 0 && !killed,
          duration: Date.now() - start,
          output: output || undefined,
          exitCode: code ?? undefined,
          timedOut: killed,
          error: killed ? 'Execution timed out' : (code !== 0 ? `Process exited with code ${code}` : undefined),
        });
      });
    });
  }

  async executeInterceptor(
    hook: PlatformHook,
    context: HookContext,
    options: ExecutionOptions,
  ): Promise<InterceptorExecutionResult> {
    const action = hook.action;
    if (action.type !== 'script') {
      return { success: false, duration: 0, timedOut: false, error: 'Invalid action type for ScriptExecutor' };
    }

    const start = Date.now();
    const timeoutMs = options.timeout ?? hook.timeout ?? 30000;

    let mod: Record<string, unknown>;
    try {
      mod = await import(action.path);
    } catch (err) {
      return {
        success: false,
        duration: Date.now() - start,
        timedOut: false,
        error: `Module not found or failed to load: ${action.path} — ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const handler = mod.default ?? mod;
    if (typeof handler !== 'function') {
      return {
        success: false,
        duration: Date.now() - start,
        timedOut: false,
        error: `Script module has no default export function: ${action.path}`,
      };
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const executionPromise = handler(context);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('INTERCEPTOR_TIMEOUT')), timeoutMs);
      });

      const rawResult = await Promise.race([executionPromise, timeoutPromise]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      const duration = Date.now() - start;

      const decision = parseHookDecision(rawResult);
      return {
        success: decision !== null,
        duration,
        timedOut: false,
        decision: decision ?? undefined,
        rawOutput: JSON.stringify(rawResult).slice(0, MAX_OUTPUT_BYTES),
        error: decision === null ? 'Script returned invalid HookDecision' : undefined,
      };
    } catch (err) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      const duration = Date.now() - start;
      const isTimeout = err instanceof Error && err.message === 'INTERCEPTOR_TIMEOUT';

      return {
        success: false,
        duration,
        timedOut: isTimeout,
        error: isTimeout ? 'Execution timed out' : (err instanceof Error ? err.message : String(err)),
      };
    }
  }
}
