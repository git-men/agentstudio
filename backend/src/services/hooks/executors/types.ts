import type { HookAction, HookEvent, HookExecutionResult, PlatformHook } from '../../../types/platformHooks.js';

export interface HookExecutor {
  readonly type: string;
  execute(
    hook: PlatformHook,
    event: HookEvent,
    options: ExecutionOptions,
  ): Promise<HookExecutionResult>;
}

export interface ExecutionOptions {
  timeout: number;
  cwd?: string;
}

export type ExecutorRegistry = Map<HookAction['type'], HookExecutor>;
