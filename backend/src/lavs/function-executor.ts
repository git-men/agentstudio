/**
 * LAVS Function Executor
 *
 * Executes function handlers by dynamically importing JS/TS modules
 * and calling exported functions.
 */

import {
  FunctionHandler,
  ExecutionContext,
  LAVSError,
  LAVSErrorCode,
} from './types.js';

/**
 * LAVS Function Executor - executes function handlers from JS modules
 */
export class FunctionExecutor {
  /**
   * Execute a function handler
   *
   * @param handler - Function handler configuration (module path + function name)
   * @param input - Input data to pass to the function
   * @param context - Execution context with permissions
   * @returns Function return value
   */
  async execute(
    handler: FunctionHandler,
    input: unknown,
    context: ExecutionContext
  ): Promise<unknown> {
    const startTime = Date.now();
    console.log(`[LAVS] Executing function for ${context.endpointId}`, {
      module: handler.module,
      function: handler.function,
    });

    try {
      // 1. Dynamically import the module
      let mod: Record<string, unknown>;
      try {
        mod = await import(handler.module);
      } catch (importError: unknown) {
        const message = importError instanceof Error ? importError.message : String(importError);
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `Failed to import module '${handler.module}': ${message}`
        );
      }

      // 2. Find the function
      const fn = mod[handler.function];
      if (typeof fn !== 'function') {
        throw new LAVSError(
          LAVSErrorCode.HandlerError,
          `Function '${handler.function}' not found or not a function in module '${handler.module}'`
        );
      }

      // 3. Execute with timeout
      const timeout = context.timeout || context.permissions.maxExecutionTime || 30000;
      const result = await this.executeWithTimeout(
        fn as (input: unknown, context: ExecutionContext) => Promise<unknown>,
        input,
        context,
        timeout
      );

      const duration = Date.now() - startTime;
      console.log(`[LAVS] Function completed in ${duration}ms`, {
        endpointId: context.endpointId,
      });

      return result;
    } catch (error: unknown) {
      if (error instanceof LAVSError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new LAVSError(
        LAVSErrorCode.HandlerError,
        `Function execution failed: ${message}`,
        { cause: error }
      );
    }
  }

  /**
   * Execute a function with a timeout
   */
  private async executeWithTimeout(
    fn: (input: unknown, context: ExecutionContext) => Promise<unknown>,
    input: unknown,
    context: ExecutionContext,
    timeout: number
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new LAVSError(
          LAVSErrorCode.Timeout,
          `Function execution timeout after ${timeout}ms`
        ));
      }, timeout);

      // Call the function - pass both input and context
      Promise.resolve(fn(input, context))
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
