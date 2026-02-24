import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookExecutor, interpolateTemplate } from '../executors/webhookExecutor.js';
import type { HookEvent, PlatformHook } from '../../../types/platformHooks.js';

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'run.end',
    timestamp: '2026-02-19T12:00:00.000Z',
    source: 'TestRunner',
    data: { engine: 'claude', durationMs: 1234 },
    sessionId: 'sess-1',
    projectId: 'proj-1',
    ...overrides,
  };
}

function makeWebhookHook(url: string, overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-webhook',
    name: 'Test Webhook Hook',
    enabled: true,
    event: 'run.end',
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

describe('interpolateTemplate', () => {
  it('should replace top-level event fields', () => {
    const event = makeEvent();
    const result = interpolateTemplate('Project: {{event.projectId}}', event);
    expect(result).toBe('Project: proj-1');
  });

  it('should replace nested data fields', () => {
    const event = makeEvent({ data: { engine: 'claude' } });
    const result = interpolateTemplate('Engine: {{event.data.engine}}', event);
    expect(result).toBe('Engine: claude');
  });

  it('should replace missing fields with empty string', () => {
    const event = makeEvent();
    const result = interpolateTemplate('Agent: {{event.agentId}}', event);
    expect(result).toBe('Agent: ');
  });

  it('should handle multiple placeholders', () => {
    const event = makeEvent();
    const result = interpolateTemplate('{{event.type}} in {{event.projectId}}', event);
    expect(result).toBe('run.end in proj-1');
  });
});

describe('WebhookExecutor', () => {
  const executor = new WebhookExecutor();
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should POST to URL with interpolated body', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

    const hook = makeWebhookHook('https://example.com/hook', {
      action: {
        type: 'webhook',
        url: 'https://example.com/hook',
        bodyTemplate: '{"text": "Run finished in {{event.projectId}}"}',
      },
    });

    const result = await executor.execute(hook, makeEvent(), { timeout: 5000 });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).text).toBe('Run finished in proj-1');
  });

  it('should send GET request without body', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }));

    const hook = makeWebhookHook('https://example.com/ping', {
      action: { type: 'webhook', url: 'https://example.com/ping', method: 'GET' },
    });

    const result = await executor.execute(hook, makeEvent(), { timeout: 5000 });

    expect(result.success).toBe(true);
    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.method).toBe('GET');
    expect(opts.body).toBeUndefined();
  });

  it('should include custom headers', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 200 }));

    const hook = makeWebhookHook('https://example.com/hook', {
      action: {
        type: 'webhook',
        url: 'https://example.com/hook',
        headers: { 'X-Custom': 'value' },
      },
    });

    await executor.execute(hook, makeEvent(), { timeout: 5000 });

    const [, opts] = fetchSpy.mock.calls[0];
    expect(opts.headers['X-Custom']).toBe('value');
  });

  it('should return failure for HTTP error status', async () => {
    fetchSpy.mockResolvedValue(new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }));

    const hook = makeWebhookHook('https://example.com/hook');
    const result = await executor.execute(hook, makeEvent(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.error).toContain('500');
  });

  it('should return failure for network error', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));

    const hook = makeWebhookHook('https://unreachable.example.com');
    const result = await executor.execute(hook, makeEvent(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('fetch failed');
  });

  it('should send event JSON as body when no template', async () => {
    fetchSpy.mockResolvedValue(new Response('ok', { status: 200 }));

    const hook = makeWebhookHook('https://example.com/hook');
    const event = makeEvent();

    await executor.execute(hook, event, { timeout: 5000 });

    const [, opts] = fetchSpy.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.type).toBe('run.end');
    expect(body.projectId).toBe('proj-1');
  });
});
