import { describe, it, expect, vi } from 'vitest';
import { CodexEngine } from '../codexEngine.js';

describe('CodexEngine', () => {
  it('omits --cd when building resume args', () => {
    const engine = new CodexEngine();
    const args = (engine as any).buildCodexArgs(
      '/tmp/workspace',
      undefined,
      [],
      'default',
      'session-1',
      true
    );

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args).not.toContain('--cd');
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('session-1');
  });

  it('retries without resume when existing session is missing', async () => {
    const engine = new CodexEngine();
    const executeSpy = vi
      .spyOn(engine as any, 'executeCodexCommand')
      .mockResolvedValueOnce({
        sessionId: 'old-session',
        failed: true,
        errorMessage: 'Unknown session ID',
      })
      .mockResolvedValueOnce({
        sessionId: 'new-session',
        failed: false,
      });

    const result = await engine.sendMessage(
      'hello',
      {
        type: 'codex',
        workspace: '/tmp/workspace',
        sessionId: 'existing-session',
      },
      vi.fn()
    );

    expect(result.sessionId).toBe('new-session');
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(executeSpy.mock.calls[0][6]).toBe('existing-session');
    expect(executeSpy.mock.calls[0][7]).toBe(true);
    expect(executeSpy.mock.calls[1][6]).toBeUndefined();
    expect(executeSpy.mock.calls[1][7]).toBe(false);
  });

  it('does not retry when failure is not resume-related', async () => {
    const engine = new CodexEngine();
    const executeSpy = vi
      .spyOn(engine as any, 'executeCodexCommand')
      .mockResolvedValueOnce({
        sessionId: 'same-session',
        failed: true,
        errorMessage: 'Permission denied',
      });

    const result = await engine.sendMessage(
      'hello',
      {
        type: 'codex',
        workspace: '/tmp/workspace',
        sessionId: 'existing-session',
      },
      vi.fn()
    );

    expect(result.sessionId).toBe('same-session');
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('starts a new execution when sessionId is not provided', async () => {
    const engine = new CodexEngine();
    const executeSpy = vi
      .spyOn(engine as any, 'executeCodexCommand')
      .mockResolvedValueOnce({
        sessionId: 'fresh-session',
        failed: false,
      });

    const result = await engine.sendMessage(
      'hello',
      {
        type: 'codex',
        workspace: '/tmp/workspace',
      },
      vi.fn()
    );

    expect(result.sessionId).toBe('fresh-session');
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][6]).toBeUndefined();
    expect(executeSpy.mock.calls[0][7]).toBe(false);
  });

  it('interrupts an active session and removes it from active map', async () => {
    const engine = new CodexEngine();
    const kill = vi.fn();

    (engine as any).activeSessions.set('session-1', {
      id: 'session-1',
      process: { kill },
      workspace: '/tmp/workspace',
      startedAt: new Date(),
    });

    await engine.interruptSession('session-1');

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect((engine as any).activeSessions.has('session-1')).toBe(false);
  });

  it('throws when interrupting a non-existent session', async () => {
    const engine = new CodexEngine();

    await expect(engine.interruptSession('missing-session')).rejects.toThrow(
      'Session not found: missing-session'
    );
  });
});
