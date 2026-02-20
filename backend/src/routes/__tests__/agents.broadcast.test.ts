/**
 * Unit tests for agents.ts - SSE Broadcast via sessionEventBus
 *
 * Verifies that when /api/agents/chat runs in AGUI output mode,
 * events are broadcast to sessionEventBus observers — enabling
 * the /agui/sessions/:sessionId/observe endpoint to fan-out events
 * from agents/chat sessions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/agentStorage');
vi.mock('../../services/sessionManager');
vi.mock('../../utils/claudeUtils.js');
vi.mock('../../utils/sessionUtils.js');
vi.mock('../../services/preSendGuard/index.js', () => ({
  evaluatePreSendGuard: vi.fn().mockResolvedValue({
    enabled: false,
    decision: 'allow',
    blocked: false,
    message: '',
  }),
}));
vi.mock('../../services/preSendGuard/configResolver.js', () => ({
  resolvePreSendGuardConfig: vi.fn().mockResolvedValue({
    config: undefined,
    source: 'none',
  }),
}));

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

import { sessionEventBus, type SessionEvent } from '../../services/sessionEventBus.js';

const MOCK_SESSION_ID = 'broadcast-test-session';

describe('agents.ts - SSE Broadcast to sessionEventBus', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { AgentStorage } = await import('../../services/agentStorage');
    const { sessionManager } = await import('../../services/sessionManager');
    const { buildQueryOptions } = await import('../../utils/claudeUtils.js');
    const { handleSessionManagement, buildUserMessageContent } = await import('../../utils/sessionUtils.js');

    vi.mocked(AgentStorage).mockImplementation(() => ({
      getAgent: vi.fn((agentId: string) => {
        if (agentId === 'test-agent') {
          return {
            id: 'test-agent',
            name: 'Test Agent',
            enabled: true,
            systemPrompt: 'You are a test agent',
            maxTurns: 25,
            permissionMode: 'acceptEdits',
            model: 'sonnet',
            allowedTools: [],
            ui: { icon: '🤖', primaryColor: '#3B82F6', headerTitle: 'Test', headerDescription: 'Test' },
            author: 'test',
            tags: [],
            version: '1.0.0',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
        return null;
      }),
      createAgent: vi.fn(),
      saveAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAllAgents: vi.fn(() => []),
    } as any));

    vi.mocked(sessionManager).getActiveSessionCount = vi.fn(() => 0);
    vi.mocked(sessionManager).getSessionsInfo = vi.fn(() => []);

    vi.mocked(buildQueryOptions).mockResolvedValue({
      queryOptions: {
        systemPrompt: 'You are a test agent',
        allowedTools: [],
        maxTurns: 25,
        permissionMode: 'acceptEdits',
        model: 'sonnet',
        pathToClaudeCodeExecutable: '/mock/claude',
        env: {},
      },
      frontendToolSessionRef: null,
    } as any);

    const mockClaudeSession = {
      sendMessage: vi.fn((_message: unknown, callback: (msg: any) => void) => {
        setTimeout(() => {
          callback({
            type: 'system',
            subtype: 'init',
            session_id: MOCK_SESSION_ID,
          });
          callback({
            type: 'result',
            subtype: 'success',
            result: 'Test response',
          });
        }, 10);
        return Promise.resolve('mock-request-id');
      }),
      getClaudeSessionId: vi.fn(() => MOCK_SESSION_ID),
      setSessionTitle: vi.fn(),
      cancelRequest: vi.fn(),
    };

    vi.mocked(handleSessionManagement).mockResolvedValue({
      claudeSession: mockClaudeSession,
      actualSessionId: MOCK_SESSION_ID,
    } as any);

    vi.mocked(buildUserMessageContent).mockResolvedValue({
      role: 'user',
      content: [{ type: 'text', text: 'Test message' }],
    } as any);

    app = express();
    app.use(express.json());
    const agentsModule = await import('../agents');
    app.use('/api/agents', agentsModule.default);
  });

  afterEach(() => {
    sessionEventBus.cleanupSession(MOCK_SESSION_ID);
  });

  it('should broadcast AGUI events to sessionEventBus when outputFormat is agui', async () => {
    const broadcastedEvents: SessionEvent[] = [];

    const unsub = sessionEventBus.subscribe(
      MOCK_SESSION_ID,
      'test-observer',
      (event) => broadcastedEvents.push(event),
    );

    try {
      const response = await request(app)
        .post('/api/agents/chat')
        .send({
          agentId: 'test-agent',
          message: 'Hello',
          outputFormat: 'agui',
          sessionId: MOCK_SESSION_ID,
        });

      expect([200, 201]).toContain(response.status);

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(broadcastedEvents.length).toBeGreaterThan(0);

      const eventTypes = broadcastedEvents.map((e) => (e as any).type);
      expect(eventTypes).toContain('RUN_STARTED');
      expect(eventTypes).toContain('RUN_FINISHED');
    } finally {
      unsub();
    }
  });

  it('should NOT broadcast when outputFormat is default (SDK format)', async () => {
    const broadcastedEvents: SessionEvent[] = [];

    const unsub = sessionEventBus.subscribe(
      MOCK_SESSION_ID,
      'test-observer',
      (event) => broadcastedEvents.push(event),
    );

    try {
      const response = await request(app)
        .post('/api/agents/chat')
        .send({
          agentId: 'test-agent',
          message: 'Hello',
          sessionId: MOCK_SESSION_ID,
        });

      expect([200, 201]).toContain(response.status);

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(broadcastedEvents.length).toBe(0);
    } finally {
      unsub();
    }
  });

  it('should NOT broadcast when there are no observers', async () => {
    const emitSpy = vi.spyOn(sessionEventBus, 'emit');

    const response = await request(app)
      .post('/api/agents/chat')
      .send({
        agentId: 'test-agent',
        message: 'Hello',
        outputFormat: 'agui',
        sessionId: MOCK_SESSION_ID,
      });

    expect([200, 201]).toContain(response.status);

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(emitSpy).not.toHaveBeenCalled();

    emitSpy.mockRestore();
  });

  it('should broadcast events with correct session ID', async () => {
    const broadcastedEvents: SessionEvent[] = [];

    const unsub = sessionEventBus.subscribe(
      MOCK_SESSION_ID,
      'test-observer',
      (event) => broadcastedEvents.push(event),
    );

    try {
      await request(app)
        .post('/api/agents/chat')
        .send({
          agentId: 'test-agent',
          message: 'Hello',
          outputFormat: 'agui',
          sessionId: MOCK_SESSION_ID,
        });

      await new Promise((resolve) => setTimeout(resolve, 300));

      const runStarted = broadcastedEvents.find(
        (e) => (e as any).type === 'RUN_STARTED',
      ) as any;

      expect(runStarted).toBeDefined();
      expect(runStarted.threadId).toBe(MOCK_SESSION_ID);
    } finally {
      unsub();
    }
  });

  it('should broadcast to multiple observers simultaneously', async () => {
    const observer1Events: SessionEvent[] = [];
    const observer2Events: SessionEvent[] = [];

    const unsub1 = sessionEventBus.subscribe(
      MOCK_SESSION_ID,
      'observer-1',
      (event) => observer1Events.push(event),
    );
    const unsub2 = sessionEventBus.subscribe(
      MOCK_SESSION_ID,
      'observer-2',
      (event) => observer2Events.push(event),
    );

    try {
      await request(app)
        .post('/api/agents/chat')
        .send({
          agentId: 'test-agent',
          message: 'Hello',
          outputFormat: 'agui',
          sessionId: MOCK_SESSION_ID,
        });

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(observer1Events.length).toBeGreaterThan(0);
      expect(observer2Events.length).toBeGreaterThan(0);
      expect(observer1Events.length).toBe(observer2Events.length);

      for (let i = 0; i < observer1Events.length; i++) {
        expect((observer1Events[i] as any).type).toBe((observer2Events[i] as any).type);
      }
    } finally {
      unsub1();
      unsub2();
    }
  });
});
