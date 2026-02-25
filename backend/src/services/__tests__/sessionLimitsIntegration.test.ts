/**
 * Integration tests for MAX_SESSIONS_PER_AGENT environment variable
 *
 * These tests verify the full chain:
 *   MAX_SESSIONS_PER_AGENT env var → SessionManager constructor → session limit enforcement → HTTP response
 *
 * Unlike the unit tests in sessionLimits.test.ts (which focus on internal SessionManager
 * logic), these tests also exercise the HTTP API layer by mounting a minimal Express
 * application that exposes the same session-inspection and session-management endpoints
 * used by the real backend (/api/agents/sessions).
 *
 * The only external dependency that is mocked is @anthropic-ai/claude-agent-sdk because
 * it spawns a real subprocess.  All other code — SessionManager, ClaudeSession, and the
 * HTTP route — runs as-is.
 *
 * Run: pnpm run test:run --reporter=verbose src/services/__tests__/sessionLimitsIntegration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SessionManager } from '../sessionManager.js';

// ---------------------------------------------------------------------------
// Mock the SDK — only the external subprocess needs to be faked
// ---------------------------------------------------------------------------
const mockSdkClose = vi.fn();
const mockSdkInterrupt = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const gen = (async function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
    })();
    (gen as any).close = mockSdkClose;
    (gen as any).interrupt = mockSdkInterrupt;
    return gen;
  }),
}));

// ---------------------------------------------------------------------------
// Minimal Express app that mirrors the real /api/agents/sessions endpoints
// ---------------------------------------------------------------------------
function buildApp(sm: SessionManager) {
  const app = express();
  app.use(express.json());

  // GET /sessions — list all active sessions (mirrors GET /api/agents/sessions)
  app.get('/sessions', (_req, res) => {
    res.json({
      activeSessionCount: sm.getActiveSessionCount(),
      sessions: sm.getSessionsInfo(),
    });
  });

  // DELETE /sessions/:sessionId — remove a single session
  app.delete('/sessions/:sessionId', async (req, res) => {
    const removed = await sm.removeSession(req.params.sessionId);
    if (removed) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // DELETE /sessions — clear all sessions (mirrors DELETE /api/agents/sessions)
  app.delete('/sessions', async (_req, res) => {
    const cleared = await sm.clearAllSessions();
    res.json({ cleared });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------
const mockOptions = {
  systemPrompt: 'integration-test',
  allowedTools: [],
  maxTurns: 10,
  cwd: '/tmp/test-project',
};

// ===========================================================================
// 1. Default behaviour — no env var set (unlimited)
// ===========================================================================
describe('MAX_SESSIONS_PER_AGENT not set (default = unlimited)', () => {
  let sm: SessionManager;

  beforeEach(() => {
    delete process.env.MAX_SESSIONS_PER_AGENT;
    sm = new SessionManager();
    mockSdkClose.mockClear();
  });

  afterEach(async () => {
    await sm.shutdown();
  });

  it('GET /sessions returns 0 active sessions initially', async () => {
    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    expect(res.body.activeSessionCount).toBe(0);
    expect(res.body.sessions).toHaveLength(0);
  });

  it('allows creating many sessions for the same agent without eviction', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    await sm.createNewSession('agent-A', mockOptions, 'sess-2');
    await sm.createNewSession('agent-A', mockOptions, 'sess-3');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    expect(res.body.activeSessionCount).toBe(3);
    const ids = res.body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain('sess-1');
    expect(ids).toContain('sess-2');
    expect(ids).toContain('sess-3');
    // No session should have been evicted
    expect(mockSdkClose).not.toHaveBeenCalled();
  });

  it('sessions for different agents coexist freely', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-A');
    await sm.createNewSession('agent-B', mockOptions, 'sess-B');
    await sm.createNewSession('agent-C', mockOptions, 'sess-C');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(3);
  });
});

// ===========================================================================
// 2. MAX_SESSIONS_PER_AGENT=1
// ===========================================================================
describe('MAX_SESSIONS_PER_AGENT=1', () => {
  let sm: SessionManager;

  beforeEach(() => {
    process.env.MAX_SESSIONS_PER_AGENT = '1';
    sm = new SessionManager();
    mockSdkClose.mockClear();
  });

  afterEach(async () => {
    delete process.env.MAX_SESSIONS_PER_AGENT;
    await sm.shutdown();
  });

  it('GET /sessions returns 0 active sessions initially', async () => {
    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    expect(res.body.activeSessionCount).toBe(0);
  });

  it('creating the first session succeeds and is visible via API', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(1);
    expect(res.body.sessions[0]).toMatchObject({
      sessionId: 'sess-1',
      agentId: 'agent-A',
    });
  });

  it('second session for the same agent replaces the first (limit enforced)', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    await sm.createNewSession('agent-A', mockOptions, 'sess-2');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(1);
    const ids = res.body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).not.toContain('sess-1'); // evicted
    expect(ids).toContain('sess-2');     // new session kept
    // The evicted session's close() must have been called
    expect(mockSdkClose).toHaveBeenCalled();
  });

  it('each agent independently keeps exactly 1 session', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-A');
    await sm.createNewSession('agent-B', mockOptions, 'sess-B');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    // Two agents, one session each → total 2
    expect(res.body.activeSessionCount).toBe(2);
    const ids = res.body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain('sess-A');
    expect(ids).toContain('sess-B');
  });

  it('third session for agent also evicts, keeping only the latest', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    await sm.createNewSession('agent-A', mockOptions, 'sess-2');
    await sm.createNewSession('agent-A', mockOptions, 'sess-3');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(1);
    expect(res.body.sessions[0].sessionId).toBe('sess-3');
  });

  it('DELETE /sessions/:sessionId removes the session and returns 200', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-x');

    const app = buildApp(sm);
    const delRes = await request(app).delete('/sessions/sess-x');
    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const listRes = await request(app).get('/sessions');
    expect(listRes.body.activeSessionCount).toBe(0);
  });

  it('DELETE /sessions/:sessionId returns 404 for unknown session', async () => {
    const app = buildApp(sm);
    const res = await request(app).delete('/sessions/nonexistent-sess');
    expect(res.status).toBe(404);
  });

  it('DELETE /sessions clears all sessions', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-A');
    await sm.createNewSession('agent-B', mockOptions, 'sess-B');

    const app = buildApp(sm);
    const delRes = await request(app).delete('/sessions');
    expect(delRes.status).toBe(200);
    expect(delRes.body.cleared).toBe(2);

    const listRes = await request(app).get('/sessions');
    expect(listRes.body.activeSessionCount).toBe(0);
  });
});

// ===========================================================================
// 3. MAX_SESSIONS_PER_AGENT=2
// ===========================================================================
describe('MAX_SESSIONS_PER_AGENT=2', () => {
  let sm: SessionManager;

  beforeEach(() => {
    process.env.MAX_SESSIONS_PER_AGENT = '2';
    sm = new SessionManager();
    mockSdkClose.mockClear();
  });

  afterEach(async () => {
    delete process.env.MAX_SESSIONS_PER_AGENT;
    await sm.shutdown();
  });

  it('allows up to 2 sessions per agent without eviction', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    await sm.createNewSession('agent-A', mockOptions, 'sess-2');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(2);
    expect(mockSdkClose).not.toHaveBeenCalled();
  });

  it('3rd session for agent evicts the oldest, keeping 2', async () => {
    await sm.createNewSession('agent-A', mockOptions, 'sess-1');
    // Small delay so activity timestamps differ
    await new Promise(r => setTimeout(r, 10));
    await sm.createNewSession('agent-A', mockOptions, 'sess-2');
    await new Promise(r => setTimeout(r, 10));
    await sm.createNewSession('agent-A', mockOptions, 'sess-3');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(2);

    const ids = res.body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).not.toContain('sess-1'); // oldest evicted
    expect(ids).toContain('sess-2');
    expect(ids).toContain('sess-3');
    expect(mockSdkClose).toHaveBeenCalledTimes(1);
  });

  it('sessions across different agents are counted independently', async () => {
    // agent-A gets 2, agent-B gets 2 — total 4, no evictions
    await sm.createNewSession('agent-A', mockOptions, 'a1');
    await sm.createNewSession('agent-A', mockOptions, 'a2');
    await sm.createNewSession('agent-B', mockOptions, 'b1');
    await sm.createNewSession('agent-B', mockOptions, 'b2');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.body.activeSessionCount).toBe(4);
    expect(mockSdkClose).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 4. Response shape validation
// ===========================================================================
describe('Session API response shape', () => {
  let sm: SessionManager;

  beforeEach(() => {
    delete process.env.MAX_SESSIONS_PER_AGENT;
    sm = new SessionManager();
  });

  afterEach(async () => {
    await sm.shutdown();
  });

  it('each session entry includes expected fields', async () => {
    await sm.createNewSession('agent-shape', mockOptions, 'sess-shape');

    const app = buildApp(sm);
    const res = await request(app).get('/sessions');
    expect(res.status).toBe(200);
    const session = res.body.sessions[0];

    expect(session).toMatchObject({
      sessionId:        'sess-shape',
      agentId:          'agent-shape',
      isActive:         expect.any(Boolean),
      lastActivity:     expect.any(Number),
      idleTimeMs:       expect.any(Number),
      status:           expect.stringMatching(/^(confirmed|pending)$/),
    });
  });
});
