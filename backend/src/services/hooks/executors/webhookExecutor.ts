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

/**
 * Interpolate {{event.field}} and {{event.data.field}} placeholders in a template.
 */
function interpolateTemplate(template: string, event: HookEvent): string {
  return template.replace(/\{\{event\.([^}]+)\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    let value: unknown = event;
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== 'object') return '';
      value = (value as Record<string, unknown>)[part];
    }
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

export class WebhookExecutor implements InterceptorExecutor {
  readonly type = 'webhook';

  async execute(
    hook: PlatformHook,
    event: HookEvent,
    options: ExecutionOptions,
  ): Promise<HookExecutionResult> {
    const action = hook.action;
    if (action.type !== 'webhook') {
      return { success: false, duration: 0, timedOut: false, error: 'Invalid action type for WebhookExecutor' };
    }

    const start = Date.now();
    const timeout = options.timeout || hook.timeout;
    const method = action.method ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...action.headers,
    };

    let body: string | undefined;
    if (method !== 'GET') {
      body = action.bodyTemplate
        ? interpolateTemplate(action.bodyTemplate, event)
        : JSON.stringify(event);
    }

    try {
      const response = await fetch(action.url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeout),
      });

      const responseBody = await response.text();
      const duration = Date.now() - start;

      return {
        success: response.ok,
        duration,
        output: responseBody.slice(0, MAX_OUTPUT_BYTES) || undefined,
        httpStatus: response.status,
        timedOut: false,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';

      return {
        success: false,
        duration,
        timedOut: isTimeout,
        error: isTimeout ? 'Request timed out' : (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  async executeInterceptor(
    hook: PlatformHook,
    context: HookContext,
    options: ExecutionOptions,
  ): Promise<InterceptorExecutionResult> {
    const action = hook.action;
    if (action.type !== 'webhook') {
      return { success: false, duration: 0, timedOut: false, error: 'Invalid action type for WebhookExecutor' };
    }

    const start = Date.now();
    const timeoutMs = options.timeout ?? hook.timeout ?? 30000;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...action.headers,
    };

    try {
      const response = await fetch(action.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(context),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const responseBody = await response.text();
      const duration = Date.now() - start;

      if (!response.ok) {
        return {
          success: false,
          duration,
          timedOut: false,
          rawOutput: responseBody.slice(0, MAX_OUTPUT_BYTES) || undefined,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        return {
          success: false,
          duration,
          timedOut: false,
          rawOutput: responseBody.slice(0, MAX_OUTPUT_BYTES) || undefined,
          error: 'Webhook returned non-JSON response body',
        };
      }

      const decision = parseHookDecision(parsed);
      return {
        success: decision !== null,
        duration,
        timedOut: false,
        decision: decision ?? undefined,
        rawOutput: responseBody.slice(0, MAX_OUTPUT_BYTES) || undefined,
        error: decision === null ? 'Webhook returned invalid HookDecision' : undefined,
      };
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';

      return {
        success: false,
        duration,
        timedOut: isTimeout,
        error: isTimeout ? 'Request timed out' : (err instanceof Error ? err.message : String(err)),
      };
    }
  }
}

export { interpolateTemplate };
