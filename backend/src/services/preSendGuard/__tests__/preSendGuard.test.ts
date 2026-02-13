import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluatePreSendGuard } from '../index.js';

function createContext(message = 'hello') {
  return {
    message,
    agentId: 'agent-1',
    sessionId: 'session-1',
    projectPath: '/tmp/project',
    channel: 'web' as const,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('evaluatePreSendGuard', () => {
  it('should bypass when disabled', async () => {
    const result = await evaluatePreSendGuard({
      globalConfig: { enabled: false },
      context: createContext(),
    });

    expect(result.enabled).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.message).toBe('hello');
  });

  it('should allow when http-audit returns allow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ decision: 'allow' }),
    }));

    const result = await evaluatePreSendGuard({
      globalConfig: {
        enabled: true,
        providers: [{ name: 'http-audit', options: { url: 'https://audit.local/check' } }],
      },
      context: createContext(),
    });

    expect(result.enabled).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.decision).toBe('allow');
  });

  it('should rewrite message when provider returns rewrite', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ decision: 'rewrite', rewrittenMessage: 'masked content' }),
    }));

    const result = await evaluatePreSendGuard({
      globalConfig: {
        enabled: true,
        providers: [{ name: 'http-audit', options: { url: 'https://audit.local/check' } }],
      },
      context: createContext('contains secret'),
    });

    expect(result.blocked).toBe(false);
    expect(result.message).toBe('masked content');
    expect(result.steps[0]?.decision).toBe('rewrite');
  });

  it('should block when provider returns block', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ decision: 'block', reason: 'policy hit', code: 'policy_violation' }),
    }));

    const result = await evaluatePreSendGuard({
      globalConfig: {
        enabled: true,
        providers: [{ name: 'http-audit', options: { url: 'https://audit.local/check' } }],
      },
      context: createContext('bad input'),
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('policy hit');
    expect(result.code).toBe('policy_violation');
  });

  it('should fail open when provider errors and onError=allow', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    const result = await evaluatePreSendGuard({
      globalConfig: {
        enabled: true,
        providers: [{ name: 'http-audit', onError: 'allow', options: { url: 'https://audit.local/check' } }],
      },
      context: createContext(),
    });

    expect(result.blocked).toBe(false);
    expect(result.steps[0]?.code).toBe('guard_provider_error');
  });

  it('should fail closed when provider not found and onError=block', async () => {
    const result = await evaluatePreSendGuard({
      globalConfig: {
        enabled: true,
        providers: [{ name: 'not-exists', onError: 'block' }],
      },
      context: createContext(),
    });

    expect(result.blocked).toBe(true);
    expect(result.code).toBe('guard_provider_not_found');
  });
});
