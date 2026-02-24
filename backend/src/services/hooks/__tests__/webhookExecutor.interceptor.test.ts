import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookExecutor } from '../executors/webhookExecutor.js';
import type { HookContext, PlatformHook } from '../../../types/platformHooks.js';

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    event: {
      type: 'message.pre_send',
      timestamp: '2026-02-19T12:00:00.000Z',
      source: 'TestRunner',
    },
    session: {
      sessionId: 'sess-1',
      projectId: 'proj-1',
    },
    data: {
      message: 'hello world',
    },
    hookId: 'hook_test-webhook',
    hookName: 'Test Webhook Hook',
    timeout: 5000,
    ...overrides,
  };
}

function makeWebhookHook(url: string, overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-webhook',
    name: 'Test Webhook Hook',
    enabled: true,
    event: 'message.pre_send',
    action: { type: 'webhook', url },
    scope: 'global',
    timeout: 5000,
    failurePolicy: 'warn',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('WebhookExecutor.executeInterceptor', () => {
  const executor = new WebhookExecutor();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return "allow" decision on 200 with allow body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ decision: 'allow' }), { status: 200 }),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.decision).toBeDefined();
    expect(result.decision!.decision).toBe('allow');
  });

  it('should return "block" decision on 200 with block body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ decision: 'block', reason: 'Forbidden content' }),
        { status: 200 },
      ),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(true);
    expect(result.decision!.decision).toBe('block');
    expect(result.decision!.reason).toBe('Forbidden content');
  });

  it('should return "rewrite" decision on 200 with rewrite body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          decision: 'rewrite',
          rewrittenMessage: 'sanitized message',
          reason: 'PII removed',
        }),
        { status: 200 },
      ),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(true);
    expect(result.decision!.decision).toBe('rewrite');
    expect(result.decision!.rewrittenMessage).toBe('sanitized message');
    expect(result.decision!.reason).toBe('PII removed');
  });

  it('should return failed result on non-200 response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('500');
    expect(result.rawOutput).toBe('Internal Server Error');
  });

  it('should return timed out result on timeout', async () => {
    const timeoutError = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    fetchSpy.mockRejectedValue(timeoutError);

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 100 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
  });

  it('should return failed result on invalid JSON response', async () => {
    fetchSpy.mockResolvedValue(
      new Response('not valid json {{{}', { status: 200 }),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('non-JSON');
  });

  it('should return failed result on network error', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const hook = makeWebhookHook('https://unreachable.example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('fetch failed');
  });

  it('should return error for invalid action type', async () => {
    const hook = makeWebhookHook('https://example.com/hook', {
      action: { type: 'script', path: '/tmp/test.js', runtime: 'node' } as any,
    });

    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid action type');
  });

  it('should POST context as JSON body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ decision: 'allow' }), { status: 200 }),
    );

    const context = makeContext({ data: { message: 'test-message' } });
    const hook = makeWebhookHook('https://example.com/hook');
    await executor.executeInterceptor(hook, context, { timeout: 5000 });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.data.message).toBe('test-message');
    expect(body.hookId).toBe('hook_test-webhook');
  });

  it('should include custom headers from action config', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ decision: 'allow' }), { status: 200 }),
    );

    const hook = makeWebhookHook('https://example.com/hook', {
      action: {
        type: 'webhook',
        url: 'https://example.com/hook',
        headers: { Authorization: 'Bearer test-token' },
      },
    });

    await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('should return failed result when 200 response has valid JSON but invalid decision', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid HookDecision');
  });

  it('should include rawOutput in result', async () => {
    const responseBody = JSON.stringify({ decision: 'allow', reason: 'looks good' });
    fetchSpy.mockResolvedValue(
      new Response(responseBody, { status: 200 }),
    );

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.rawOutput).toBeDefined();
    expect(result.rawOutput).toContain('allow');
    expect(result.rawOutput).toContain('looks good');
  });
});
