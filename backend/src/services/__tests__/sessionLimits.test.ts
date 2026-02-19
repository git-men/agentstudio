/**
 * Session Limit & Cleanup Tests
 *
 * Tests for:
 * 1. ClaudeSession.close() properly calling queryObject.close() to terminate subprocess
 * 2. Per-agent session limit enforcement (maxSessionsPerAgent)
 * 3. Global concurrent session limit enforcement (maxConcurrentSessions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../sessionManager.js';
import { ClaudeSession } from '../claudeSession.js';

const mockClose = vi.fn();
const mockInterrupt = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const mockGenerator = (async function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      };
    })();

    (mockGenerator as any).interrupt = mockInterrupt;
    (mockGenerator as any).close = mockClose;
    return mockGenerator;
  })
}));

const mockOptions = {
  systemPrompt: 'test',
  allowedTools: [],
  maxTurns: 10,
  cwd: '/test/path'
};

// ─────────────────────────────────────────────────────────────────────
// 1. ClaudeSession.close() subprocess termination
// ─────────────────────────────────────────────────────────────────────
describe('ClaudeSession.close() subprocess termination', () => {
  beforeEach(() => {
    mockClose.mockClear();
    mockInterrupt.mockClear();
  });

  it('should call queryObject.close() to terminate the CLI subprocess', async () => {
    const session = new ClaudeSession('agent-1', mockOptions);
    await session.close();

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('should set isActive to false after close', async () => {
    const session = new ClaudeSession('agent-1', mockOptions);
    expect(session.isSessionActive()).toBe(true);

    await session.close();
    expect(session.isSessionActive()).toBe(false);
  });

  it('should clear isProcessing flag on close', async () => {
    const session = new ClaudeSession('agent-1', mockOptions);

    // Simulate a processing state by sending a message
    const cb = vi.fn();
    await session.sendMessage(
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      cb
    );
    expect(session.isCurrentlyProcessing()).toBe(true);

    await session.close();
    expect(session.isCurrentlyProcessing()).toBe(false);
  });

  it('should not call queryObject.close() a second time when already inactive', async () => {
    const session = new ClaudeSession('agent-1', mockOptions);
    await session.close();
    mockClose.mockClear();

    await session.close(); // second call
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should handle queryObject.close() throwing gracefully', async () => {
    mockClose.mockImplementationOnce(() => {
      throw new Error('close failed');
    });

    const session = new ClaudeSession('agent-1', mockOptions);
    // Should not throw
    await expect(session.close()).resolves.toBeUndefined();
    expect(session.isSessionActive()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Per-agent session limit
// ─────────────────────────────────────────────────────────────────────
describe('Per-agent session limit (maxSessionsPerAgent = 1)', () => {
  let sm: SessionManager;

  beforeEach(() => {
    mockClose.mockClear();
    sm = new SessionManager();
  });

  afterEach(async () => {
    await sm.shutdown();
  });

  it('should allow creating the first session for an agent', async () => {
    const session = await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    expect(sm.getSession('sess-1')).toBe(session);
    expect(sm.getActiveSessionCount()).toBe(1);
  });

  it('should close the old session when creating a second session for the same agent', async () => {
    const s1 = await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    expect(sm.getSession('sess-1')).toBe(s1);

    const s2 = await sm.createNewSession('agent-A', mockOptions, 'sess-2');
    expect(sm.getSession('sess-2')).toBe(s2);

    // The old session should have been removed
    expect(sm.getSession('sess-1')).toBeNull();

    // queryObject.close() should have been called (for the evicted session)
    expect(mockClose).toHaveBeenCalled();
  });

  it('should not evict a session that is about to be resumed', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');

    // Resume the same session ID — it should be replaced, not evicted alongside
    mockClose.mockClear();
    const s2 = await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    expect(sm.getSession('sess-1')).toBe(s2);
    // old session for sess-1 was evicted via enforceAgentSessionLimit, then re-created
    expect(sm.getActiveSessionCount()).toBe(1);
  });

  it('should allow different agents to each have one session', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-A');
    await sm.createNewSession('agent-B', mockOptions, 'sess-B');

    expect(sm.getSession('sess-A')).not.toBeNull();
    expect(sm.getSession('sess-B')).not.toBeNull();
    expect(sm.getActiveSessionCount()).toBe(2);
  });

  it('should evict the oldest session when agent has multiple sessions', async () => {
    // Manually set up two sessions by first creating one, then confirming another via temp
    const s1 = await sm.createNewSession('agent-X', mockOptions, 'x-old');

    // Simulate passage of time so we can distinguish activity
    await new Promise(r => setTimeout(r, 10));

    // Creating a new session should evict x-old
    const s2 = await sm.createNewSession('agent-X', mockOptions, 'x-new');
    expect(sm.getSession('x-old')).toBeNull();
    expect(sm.getSession('x-new')).toBe(s2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Global concurrent session limit
// ─────────────────────────────────────────────────────────────────────
describe('Global concurrent session limit (maxConcurrentSessions = 10)', () => {
  let sm: SessionManager;

  beforeEach(() => {
    mockClose.mockClear();
    sm = new SessionManager();
  });

  afterEach(async () => {
    await sm.shutdown();
  });

  it('should allow creating sessions up to the global limit', async () => {
    for (let i = 0; i < 10; i++) {
      await sm.createNewSession(`agent-${i}`, mockOptions, `sess-${i}`);
    }
    expect(sm.getActiveSessionCount()).toBe(10);
  });

  it('should evict the oldest idle session when exceeding the global limit', async () => {
    // Fill up to the limit
    for (let i = 0; i < 10; i++) {
      await sm.createNewSession(`agent-${i}`, mockOptions, `sess-${i}`);
      // Small delay to differentiate lastActivity
      await new Promise(r => setTimeout(r, 5));
    }
    expect(sm.getActiveSessionCount()).toBe(10);

    // Create one more — should evict sess-0 (oldest)
    await sm.createNewSession('agent-new', mockOptions, 'sess-new');

    // The oldest session should have been evicted
    expect(sm.getSession('sess-0')).toBeNull();
    expect(sm.getSession('sess-new')).not.toBeNull();
    expect(sm.getActiveSessionCount()).toBe(10);
  });

  it('should not evict busy sessions during global limit enforcement', async () => {
    // Create sessions
    for (let i = 0; i < 10; i++) {
      await sm.createNewSession(`agent-${i}`, mockOptions, `sess-${i}`);
      await new Promise(r => setTimeout(r, 5));
    }

    // Make the oldest session busy
    const oldestSession = sm.getSession('sess-0');
    if (oldestSession) {
      const cb = vi.fn();
      await oldestSession.sendMessage(
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
        cb
      );
    }

    // Create one more — should evict sess-1 (oldest non-busy) instead of sess-0
    await sm.createNewSession('agent-extra', mockOptions, 'sess-extra');
    expect(sm.getSession('sess-0')).not.toBeNull(); // busy, should survive
    expect(sm.getSession('sess-1')).toBeNull(); // evicted
    expect(sm.getSession('sess-extra')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. SessionManager.removeSession + close integration
// ─────────────────────────────────────────────────────────────────────
describe('SessionManager.removeSession closes subprocess', () => {
  let sm: SessionManager;

  beforeEach(() => {
    mockClose.mockClear();
    sm = new SessionManager();
  });

  afterEach(async () => {
    await sm.shutdown();
  });

  it('should call session.close() (which calls queryObject.close()) on removeSession', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-rm');
    mockClose.mockClear();

    await sm.removeSession('sess-rm');

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(sm.getSession('sess-rm')).toBeNull();
  });

  it('should clean up all indices on removeSession', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-clean');

    expect(sm.hasActiveSession('sess-clean')).toBe(true);
    expect(sm.getActiveSessionCount()).toBe(1);

    await sm.removeSession('sess-clean');

    expect(sm.hasActiveSession('sess-clean')).toBe(false);
    expect(sm.getActiveSessionCount()).toBe(0);
  });
});
