import type {
  HookAction,
  HookContext,
  HookEvent,
  HookExecutionResult,
  InterceptorExecutionResult,
  PlatformHook,
} from '../../../types/platformHooks.js';

export interface HookExecutor {
  readonly type: string;
  execute(
    hook: PlatformHook,
    event: HookEvent,
    options: ExecutionOptions,
  ): Promise<HookExecutionResult>;
}

export interface InterceptorExecutor extends HookExecutor {
  executeInterceptor(
    hook: PlatformHook,
    context: HookContext,
    options: ExecutionOptions,
  ): Promise<InterceptorExecutionResult>;
}

export function isInterceptorExecutor(executor: HookExecutor): executor is InterceptorExecutor {
  return 'executeInterceptor' in executor && typeof (executor as any).executeInterceptor === 'function';
}

export interface ExecutionOptions {
  timeout: number;
  cwd?: string;
}

export type ExecutorRegistry = Map<HookAction['type'], HookExecutor>;
