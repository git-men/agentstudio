import type { HookEvent, HookExecutionResult, PlatformHook } from '../../../types/platformHooks.js';
import type { ExecutionOptions, HookExecutor } from './types.js';

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

export class WebhookExecutor implements HookExecutor {
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
}

export { interpolateTemplate };
