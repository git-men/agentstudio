/**
 * LAVS Script Executor
 *
 * Executes script handlers with proper input/output handling and security.
 */

import { spawn, ChildProcess } from 'child_process';
import {
  ScriptHandler,
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
} from './types.js';

export class ScriptExecutor {
  /**
   * Execute a script handler
   * @param handler - Script handler configuration
   * @param input - Input data to pass to script
   * @param context - Execution context with permissions
   * @returns Script output (parsed as JSON)
   */
  async execute(
    handler: ScriptHandler,
    input: any,
    context: ExecutionContext
  ): Promise<any> {
    const startTime = Date.now();
    console.log(`[LAVS] Executing script for ${context.endpointId}`, {
      command: handler.command,
      args: handler.args,
      input: handler.input,
    });

    try {
      // 1. Prepare command and arguments
      const { command, args = [] } = handler;
      const resolvedArgs = this.resolveArgs(args, input);

      // 2. Prepare environment variables
      const processEnv = this.buildEnvironment(handler, input, context);

      // 3. Determine timeout
      const timeout = handler.timeout || context.timeout || 30000;

      // 4. Spawn process
      const proc = spawn(command, resolvedArgs, {
        cwd: handler.cwd || context.workdir,
        env: processEnv,
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      });

      // 5. Send input to stdin if needed
      if (handler.input === 'stdin' && input) {
        try {
          proc.stdin.write(JSON.stringify(input));
          proc.stdin.end();
        } catch (e: any) {
          console.error(`[LAVS] Failed to write to stdin:`, e);
        }
      }

      // 6. Capture output and wait for completion
      const result = await this.captureOutput(proc, timeout, context.endpointId);

      const duration = Date.now() - startTime;
      console.log(`[LAVS] Script completed in ${duration}ms`, {
        endpointId: context.endpointId,
        exitCode: result.exitCode,
      });

      // 7. Handle non-zero exit code
      if (result.exitCode !== 0) {
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `Script exited with code ${result.exitCode}`,
          {
            exitCode: result.exitCode,
            stderr: result.stderr,
            stdout: result.stdout,
          }
        );
      }

      // 8. Parse output as JSON
      return this.parseOutput(result.stdout, result.stderr);
    } catch (error: any) {
      if (error instanceof LAVSError) {
        throw error;
      }

      // Handle timeout
      if (error.code === 'ETIMEDOUT' || error.killed) {
        throw new LAVSError(
          LAVSErrorCode.Timeout,
          `Script execution timeout after ${handler.timeout || context.timeout || 30000}ms`
        );
      }

      // Handle spawn errors
      throw new LAVSError(
        LAVSErrorCode.HandlerError,
        `Script execution failed: ${error.message}`,
        { cause: error }
      );
    }
  }

  /**
   * Resolve argument templates with input values
   * Replaces {{path.to.value}} with actual values from input
   */
  private resolveArgs(args: string[], input: any): string[] {
    if (!input) return args;

    return args.map((arg) => {
      return arg.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
        const value = this.getValueByPath(input, path);
        return value != null ? String(value) : '';
      });
    });
  }

  /**
   * Get value from nested object by dot path
   * e.g., "user.name" from { user: { name: "Alice" } } => "Alice"
   * Protects against prototype pollution by blocking __proto__, constructor, prototype keys.
   */
  private getValueByPath(obj: unknown, path: string): unknown {
    // Block prototype pollution attacks
    const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current == null) return undefined;
      if (BLOCKED_KEYS.has(key)) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  /**
   * Build environment variables for script execution
   */
  buildEnvironment(
    handler: ScriptHandler,
    input: any,
    context: ExecutionContext
  ): Record<string, string> {
    const env: Record<string, string> = {
      // Inherit base environment (filtered for security)
      ...this.getBaseEnvironment(),
      // LAVS context variables
      LAVS_AGENT_ID: context.agentId,
      LAVS_ENDPOINT_ID: context.endpointId,
      // Handler-specific env vars (declared by manifest author)
      ...(handler.env || {}),
      // Context env vars (e.g. LAVS_PROJECT_PATH)
      ...(context.env || {}),
    };

    // If input mode is 'env', flatten input object to env vars
    if (handler.input === 'env' && input) {
      Object.assign(env, this.inputToEnv(input));
    }

    // Final safety pass: remove any sensitive vars that might have leaked through
    return this.filterSensitiveVars(env);
  }

  /**
   * Sensitive environment variable patterns (case-insensitive match).
   * These keywords in variable names indicate potentially sensitive data.
   */
  private static readonly SENSITIVE_PATTERNS = [
    'SECRET',
    'TOKEN',
    'PASSWORD',
    'PASSWD',
    'CREDENTIAL',
    'PRIVATE_KEY',
    'API_KEY',
    'APIKEY',
    'ACCESS_KEY',
    'AUTH',
  ];

  /**
   * Whitelist of variable names that are safe even if they match sensitive patterns.
   * For example, LAVS variables or NODE_ENV.
   */
  private static readonly SAFE_OVERRIDES = new Set([
    'LAVS_AGENT_ID',
    'LAVS_ENDPOINT_ID',
    'LAVS_PROJECT_PATH',
    'NODE_ENV',
  ]);

  /**
   * Filter out environment variables that match sensitive patterns.
   * Variables explicitly declared in handler.env are preserved (they are
   * intentionally set by the manifest author), but inherited vars from
   * process.env that match sensitive patterns are removed.
   *
   * @param env - Environment variables to filter
   * @returns Filtered environment variables
   */
  filterSensitiveVars(env: Record<string, string>): Record<string, string> {
    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      // Always allow safe overrides
      if (ScriptExecutor.SAFE_OVERRIDES.has(key)) {
        filtered[key] = value;
        continue;
      }

      // Check if variable name matches any sensitive pattern
      const upperKey = key.toUpperCase();
      const isSensitive = ScriptExecutor.SENSITIVE_PATTERNS.some(
        (pattern) => upperKey.includes(pattern)
      );

      if (!isSensitive) {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Get base environment variables (filtered for security)
   * Only include safe variables, exclude sensitive ones
   */
  getBaseEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};

    // Whitelist of safe env vars to inherit
    const safeVars = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TZ',
      'NODE_ENV',
      'SHELL',
      'TMPDIR',
      'TERM',
    ];

    for (const key of safeVars) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    return env;
  }

  /**
   * Convert input object to environment variables
   * Flattens nested objects with underscore notation
   */
  private inputToEnv(input: any, prefix = ''): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(input)) {
      const envKey = prefix ? `${prefix}_${key}` : key;

      if (value == null) {
        continue;
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Recursively flatten nested objects
        Object.assign(env, this.inputToEnv(value, envKey.toUpperCase()));
      } else {
        // Convert to string
        env[envKey.toUpperCase()] = String(value);
      }
    }

    return env;
  }

  /**
   * Capture stdout/stderr from process and wait for completion
   */
  private async captureOutput(
    proc: ChildProcess,
    timeout: number,
    endpointId: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    let stdout = '';
    let stderr = '';

    // Collect stdout
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr (and log it)
    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.log(`[LAVS:${endpointId}] stderr:`, text);
    });

    // Wait for process to exit
    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Set timeout
      timeoutHandle = setTimeout(() => {
        proc.kill('SIGTERM');
        // Give it 5 seconds to terminate gracefully, then force kill
        setTimeout(() => proc.kill('SIGKILL'), 5000);

        reject(new LAVSError(
          LAVSErrorCode.Timeout,
          `Script execution timeout after ${timeout}ms`
        ));
      }, timeout);

      proc.on('exit', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve({
          stdout,
          stderr,
          exitCode: code || 0,
        });
      });

      proc.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  /**
   * Parse script output as JSON
   */
  private parseOutput(stdout: string, stderr: string): any {
    const trimmed = stdout.trim();

    // Handle empty output
    if (!trimmed) {
      return null;
    }

    // Try to parse as JSON
    try {
      return JSON.parse(trimmed);
    } catch (e: any) {
      // If not valid JSON, try to extract JSON from output
      // Look for first { or [ and last } or ]
      const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (e2) {
          // Fall through to error
        }
      }

      throw new LAVSError(
        LAVSErrorCode.HandlerError,
        'Script output is not valid JSON',
        {
          stdout: trimmed,
          stderr,
          parseError: e.message,
        }
      );
    }
  }
}
