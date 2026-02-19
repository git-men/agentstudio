import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import type { HookEvent, HookExecutionResult, PlatformHook } from '../../../types/platformHooks.js';
import type { ExecutionOptions, HookExecutor } from './types.js';

const MAX_OUTPUT_BYTES = 10 * 1024;

export class ScriptExecutor implements HookExecutor {
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
}
