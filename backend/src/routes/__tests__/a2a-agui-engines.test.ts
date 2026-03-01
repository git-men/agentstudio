/**
 * Tests for A2A AGUI engine routing
 *
 * Validates that the A2A routes correctly detect and dispatch to the
 * generic AGUI A2A service for Cursor, Codex, Codex-SDK, CodeBuddy engines,
 * covering both /messages and /.well-known/agent-card.json endpoints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('../../middleware/a2aAuth');
vi.mock('../../middleware/rateLimiting');

// Engine config mocks — controls service-level engine detection
const mockIsCursorEngine = vi.fn(() => false);
const mockIsCodexEngine = vi.fn(() => false);
const mockIsCodexSdkEngine = vi.fn(() => false);
const mockIsCodebuddyEngine = vi.fn(() => false);

vi.mock('../../config/engineConfig.js', () => ({
  isCursorEngine: () => mockIsCursorEngine(),
  isCodexEngine: () => mockIsCodexEngine(),
  isCodexSdkEngine: () => mockIsCodexSdkEngine(),
  isCodebuddyEngine: () => mockIsCodebuddyEngine(),
  isClaudeEngine: vi.fn(() => false),
}));

// AGUI A2A service mocks
const mockExecuteAguiA2AQuery = vi.fn();
const mockExecuteAguiA2AStreaming = vi.fn();
const mockGenerateAguiAgentCard = vi.fn();

vi.mock('../../services/a2a/aguiA2aService.js', () => ({
  executeAguiA2AQuery: (...args: any[]) => mockExecuteAguiA2AQuery(...args),
  executeAguiA2AStreaming: (...args: any[]) => mockExecuteAguiA2AStreaming(...args),
  generateAguiAgentCard: (...args: any[]) => mockGenerateAguiAgentCard(...args),
}));

// Cursor A2A service — needed for import resolution but not exercised here
vi.mock('../../services/a2a/cursorA2aService.js', () => ({
  executeCursorA2AQuery: vi.fn(),
  executeCursorA2AStreaming: vi.fn(),
  createUserMessage: vi.fn(
    (text: string, opts?: any) => ({
      kind: 'message',
      role: 'user',
      messageId: 'test-msg-id',
      parts: [{ kind: 'text', text }],
      ...opts,
    })
  ),
}));

vi.mock('../../engines/cursor/a2aAdapter.js', () => ({
  CursorA2AAdapter: {
    formatAsSSE: vi.fn((r: any) => `data: ${JSON.stringify(r)}\n\n`),
  },
}));

// Other mocks for a2a.ts dependencies
vi.mock('../../services/a2a/agentMappingService');
vi.mock('../../services/a2a/apiKeyService');
vi.mock('../../services/a2a/a2aQueryService', () => ({
  executeA2AQuery: vi.fn(),
  executeA2AQueryStreaming: vi.fn(),
}));
vi.mock('../../services/agentStorage', () => ({
  AgentStorage: vi.fn().mockImplementation(() => ({
    getAgent: vi.fn().mockReturnValue(null),
  })),
}));
vi.mock('../../services/projectMetadataStorage', () => ({
  ProjectMetadataStorage: vi.fn().mockImplementation(() => ({
    getProjectMetadata: vi.fn().mockReturnValue({ name: 'Test Project' }),
  })),
}));
vi.mock('../../services/a2a/agentCardService', () => ({
  generateAgentCard: vi.fn(),
  generateCursorAgentCard: vi.fn(),
  getEngineTypeFromContext: vi.fn(),
}));
vi.mock('../../utils/agentCardCache', () => ({
  agentCardCache: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
}));
vi.mock('../../utils/claudeUtils', () => ({
  buildQueryOptions: vi.fn(),
}));
vi.mock('../../services/a2a/a2aHistoryService', () => ({
  a2aHistoryService: { appendEvent: vi.fn() },
}));
vi.mock('../../services/a2a/taskManager', () => ({
  taskManager: {
    createTask: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    updateTaskStatus: vi.fn(),
  },
}));
vi.mock('../../services/taskExecutor/index', () => ({
  getTaskExecutor: vi.fn().mockReturnValue({
    submitTask: vi.fn(),
    getStats: vi.fn().mockReturnValue({ mode: 'builtin', activeTasks: 0 }),
  }),
}));
vi.mock('../../services/sessionManager');
vi.mock('../../utils/sessionUtils');
vi.mock('../../services/hooks/platformEventBus.js', () => ({
  platformEventBus: { emit: vi.fn() },
}));
vi.mock('../../services/hooks/index.js', () => ({
  getHookManager: vi.fn().mockReturnValue(null),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeA2AContext(agentType = 'ppt-editor') {
  return {
    a2aAgentId: 'agent-test-id',
    projectId: 'proj-test',
    agentType,
    workingDirectory: '/test/ws',
    apiKeyId: 'key-test',
  };
}

async function buildApp(agentType = 'ppt-editor') {
  const app = express();
  app.use(express.json());

  const { a2aAuth } = await import('../../middleware/a2aAuth');
  const { a2aRateLimiter, a2aStrictRateLimiter } = await import('../../middleware/rateLimiting');

  vi.mocked(a2aAuth).mockImplementation(async (req: any, _res, next) => {
    req.a2aContext = makeA2AContext(agentType);
    next();
  });
  vi.mocked(a2aRateLimiter).mockImplementation((_req, _res, next) => next());
  vi.mocked(a2aStrictRateLimiter).mockImplementation((_req, _res, next) => next());

  const a2aRouter = await import('../a2a');
  app.use('/a2a/:a2aAgentId', a2aRouter.default);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A2A AGUI Engine Routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockIsCursorEngine.mockReturnValue(false);
    mockIsCodexEngine.mockReturnValue(false);
    mockIsCodexSdkEngine.mockReturnValue(false);
    mockIsCodebuddyEngine.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Engine detection — service-level configuration
  // =========================================================================

  describe('service-level engine detection (ENV)', () => {
    it('should route to AGUI service when ENGINE=codex-sdk', async () => {
      mockIsCodexSdkEngine.mockReturnValue(true);
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't1', status: { state: 'completed' } },
        responseText: 'Codex SDK reply',
        sessionId: 'sess-codex',
      });

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'hello codex-sdk' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
      expect(res.body.response).toBe('Codex SDK reply');
      expect(res.body.metadata.engineType).toBe('codex-sdk');
    });

    it('should route to AGUI service when ENGINE=codex', async () => {
      mockIsCodexEngine.mockReturnValue(true);
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't2', status: { state: 'completed' }, contextId: 'ctx-2' },
        responseText: 'Codex reply',
        sessionId: 'sess-codex',
      });

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'hello codex' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
      expect(res.body.metadata.engineType).toBe('codex');
    });

    it('should route to AGUI service when ENGINE=codebuddy', async () => {
      mockIsCodebuddyEngine.mockReturnValue(true);
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't3', status: { state: 'completed' }, contextId: 'ctx-3' },
        responseText: 'CodeBuddy reply',
        sessionId: 'sess-cb',
      });

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'hello codebuddy' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
      expect(res.body.metadata.engineType).toBe('codebuddy');
    });

    it('should route to AGUI service when ENGINE=cursor-cli', async () => {
      mockIsCursorEngine.mockReturnValue(true);
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't4', status: { state: 'completed' }, contextId: 'ctx-4' },
        responseText: 'Cursor reply',
        sessionId: 'sess-cursor',
      });

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'hello cursor' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
      expect(res.body.metadata.engineType).toBe('cursor');
    });
  });

  // =========================================================================
  // Engine detection — agentType naming convention
  // =========================================================================

  describe('agentType-based engine detection', () => {
    it('should route "codex" agentType to codex engine', async () => {
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't5', status: { state: 'completed' }, contextId: 'c' },
        responseText: 'ok',
        sessionId: 's',
      });

      const app = await buildApp('codex');

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'test' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
    });

    it('should route "codex-sdk-agent" agentType to codex-sdk engine', async () => {
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't6', status: { state: 'completed' }, contextId: 'c' },
        responseText: 'ok',
        sessionId: 's',
      });

      const app = await buildApp('codex-sdk-agent');

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'test' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
    });

    it('should route "codebuddy" agentType to codebuddy engine', async () => {
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't7', status: { state: 'completed' }, contextId: 'c' },
        responseText: 'ok',
        sessionId: 's',
      });

      const app = await buildApp('codebuddy');

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'test' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
    });

    it('should route "my-project:cursor" suffix agentType to cursor engine', async () => {
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 't8', status: { state: 'completed' }, contextId: 'c' },
        responseText: 'ok',
        sessionId: 's',
      });

      const app = await buildApp('my-project:cursor');

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'test' })
        .expect(200);

      expect(mockExecuteAguiA2AQuery).toHaveBeenCalledOnce();
    });

    it('should NOT route "ppt-editor" agentType to AGUI (falls through to Claude)', async () => {
      const app = await buildApp('ppt-editor');

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({ message: 'test' });

      expect(mockExecuteAguiA2AQuery).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Agent Card — AGUI engines
  // =========================================================================

  describe('Agent Card for AGUI engines', () => {
    it('should use generateAguiAgentCard when service engine is codex-sdk', async () => {
      mockIsCodexSdkEngine.mockReturnValue(true);
      mockGenerateAguiAgentCard.mockResolvedValue({
        name: 'Codex Agent',
        description: 'Codex coding assistant',
        url: 'https://example.com/a2a/agent-test-id',
        version: '1.0.0',
        provider: { organization: 'OpenAI', url: 'https://openai.com' },
        capabilities: { streaming: true },
        skills: [{ id: 'code-editing', name: 'Code Editing' }],
        context: { engineType: 'codex-sdk' },
        securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' } },
      });

      const app = await buildApp();

      const res = await request(app)
        .get('/a2a/test-agent/.well-known/agent-card.json')
        .expect(200);

      expect(mockGenerateAguiAgentCard).toHaveBeenCalledOnce();
      expect(mockGenerateAguiAgentCard).toHaveBeenCalledWith(
        'codex-sdk',
        expect.objectContaining({
          a2aAgentId: 'agent-test-id',
          workingDirectory: '/test/ws',
        })
      );
      expect(res.body.name).toBe('Codex Agent');
      expect(res.body.context.engineType).toBe('codex-sdk');
    });

    it('should use generateAguiAgentCard for codebuddy agentType', async () => {
      mockGenerateAguiAgentCard.mockResolvedValue({
        name: 'CodeBuddy Agent',
        skills: [],
        context: { engineType: 'codebuddy' },
      });

      const app = await buildApp('codebuddy');

      await request(app)
        .get('/a2a/test-agent/.well-known/agent-card.json')
        .expect(200);

      expect(mockGenerateAguiAgentCard).toHaveBeenCalledWith(
        'codebuddy',
        expect.objectContaining({ a2aAgentId: 'agent-test-id' })
      );
    });

    it('should NOT use generateAguiAgentCard for non-AGUI agentType', async () => {
      const app = await buildApp('ppt-editor');

      await request(app)
        .get('/a2a/test-agent/.well-known/agent-card.json');

      expect(mockGenerateAguiAgentCard).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Streaming path — AGUI engines
  // =========================================================================

  describe('streaming for AGUI engines', () => {
    it('should use executeAguiA2AStreaming when stream=true query param', async () => {
      mockIsCodexSdkEngine.mockReturnValue(true);
      mockExecuteAguiA2AStreaming.mockImplementation(
        async (_params: any, _config: any, onResponse: (r: any) => void) => {
          onResponse({ result: { kind: 'status-update', status: { state: 'working' } } });
          onResponse({ result: { kind: 'status-update', status: { state: 'completed' } } });
          return { taskId: 'task-s1', contextId: 'ctx-s1', sessionId: 'sess-s1' };
        }
      );

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages?stream=true')
        .send({ message: 'stream me' })
        .expect(200);

      expect(mockExecuteAguiA2AStreaming).toHaveBeenCalledOnce();
      expect(res.text).toContain('working');
      expect(res.text).toContain('done');
    });

    it('should use executeAguiA2AStreaming when Accept header is text/event-stream', async () => {
      mockIsCodexSdkEngine.mockReturnValue(true);
      mockExecuteAguiA2AStreaming.mockImplementation(
        async (_params: any, _config: any, onResponse: (r: any) => void) => {
          onResponse({ result: { kind: 'status-update', status: { state: 'working' } } });
          return { taskId: 'task-s2', contextId: 'ctx-s2', sessionId: 'sess-s2' };
        }
      );

      const app = await buildApp();

      const res = await request(app)
        .post('/a2a/test-agent/messages')
        .set('Accept', 'text/event-stream')
        .send({ message: 'stream via header' })
        .expect(200);

      expect(mockExecuteAguiA2AStreaming).toHaveBeenCalledOnce();
      expect(res.text).toContain('working');
    });
  });

  // =========================================================================
  // Config passthrough
  // =========================================================================

  describe('config passthrough to AGUI service', () => {
    it('should pass model and permissionMode from request body', async () => {
      mockIsCodexSdkEngine.mockReturnValue(true);
      mockExecuteAguiA2AQuery.mockResolvedValue({
        task: { id: 'tp', status: { state: 'completed' }, contextId: 'cp' },
        responseText: 'ok',
        sessionId: 'sp',
      });

      const app = await buildApp();

      await request(app)
        .post('/a2a/test-agent/messages')
        .send({
          message: 'with model',
          model: 'gpt-5.3-codex',
          permissionMode: 'bypassPermissions',
          timeout: 30000,
        })
        .expect(200);

      const passedConfig = mockExecuteAguiA2AQuery.mock.calls[0][1] as any;
      expect(passedConfig.engineType).toBe('codex-sdk');
      expect(passedConfig.model).toBe('gpt-5.3-codex');
      expect(passedConfig.permissionMode).toBe('bypassPermissions');
      expect(passedConfig.timeout).toBe(30000);
      expect(passedConfig.workspace).toBe('/test/ws');
    });
  });
});
