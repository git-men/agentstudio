/**
 * Unit tests for cursorA2aService
 * Tests Cursor A2A protocol integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createUserMessage,
  CursorA2AMessageParams,
  CursorA2AConfig,
} from '../cursorA2aService.js';
import type { A2AMessage } from '../../../engines/cursor/a2aAdapter.js';

// Mock the cursorEngine module
vi.mock('../../../engines/cursor/index.js', () => ({
  cursorEngine: {
    sendMessage: vi.fn(),
    getSupportedModels: vi.fn(() =>
      Promise.resolve([
        { id: 'auto', name: 'Auto' },
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'claude-3-opus', name: 'Claude 3 Opus' },
      ])
    ),
    capabilities: {
      streaming: true,
      thinking: true,
      vision: true,
      features: {
        codeExecution: true,
        multiTurn: true,
      },
    },
  },
}));

describe('cursorA2aService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createUserMessage', () => {
    it('should create a valid A2A user message', () => {
      const message = createUserMessage('Hello, world!');

      expect(message.kind).toBe('message');
      expect(message.role).toBe('user');
      expect(message.messageId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0]).toEqual({
        kind: 'text',
        text: 'Hello, world!',
      });
    });

    it('should include optional taskId and contextId', () => {
      const message = createUserMessage('Test message', {
        taskId: 'task-123',
        contextId: 'ctx-456',
      });

      expect(message.taskId).toBe('task-123');
      expect(message.contextId).toBe('ctx-456');
    });

    it('should include optional metadata', () => {
      const message = createUserMessage('Test message', {
        metadata: {
          source: 'test',
          priority: 'high',
        },
      });

      expect(message.metadata).toEqual({
        source: 'test',
        priority: 'high',
      });
    });

    it('should handle empty text', () => {
      const message = createUserMessage('');

      expect(message.parts[0]).toEqual({
        kind: 'text',
        text: '',
      });
    });

    it('should handle multiline text', () => {
      const multilineText = `Line 1
Line 2
Line 3`;
      const message = createUserMessage(multilineText);

      expect(message.parts[0]).toEqual({
        kind: 'text',
        text: multilineText,
      });
    });
  });

  describe('CursorA2AMessageParams interface', () => {
    it('should accept valid message params structure', () => {
      const userMessage: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-123',
        parts: [{ kind: 'text', text: 'Test' }],
      };

      const params: CursorA2AMessageParams = {
        message: userMessage,
        configuration: {
          acceptedOutputModes: ['text/plain'],
          historyLength: 10,
          blocking: true,
        },
        metadata: {
          requestId: 'req-456',
        },
      };

      expect(params.message.role).toBe('user');
      expect(params.configuration?.blocking).toBe(true);
      expect(params.metadata?.requestId).toBe('req-456');
    });

    it('should work with minimal params', () => {
      const userMessage: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-123',
        parts: [{ kind: 'text', text: 'Test' }],
      };

      const params: CursorA2AMessageParams = {
        message: userMessage,
      };

      expect(params.message).toBeDefined();
      expect(params.configuration).toBeUndefined();
      expect(params.metadata).toBeUndefined();
    });
  });

  describe('CursorA2AConfig interface', () => {
    it('should accept full config', () => {
      const config: CursorA2AConfig = {
        workspace: '/test/workspace',
        model: 'gpt-4',
        sessionId: 'session-123',
        timeout: 30000,
        requestId: 'req-789',
        contextId: 'ctx-111',
        taskId: 'task-222',
      };

      expect(config.workspace).toBe('/test/workspace');
      expect(config.model).toBe('gpt-4');
      expect(config.timeout).toBe(30000);
    });

    it('should work with minimal config (only workspace)', () => {
      const config: CursorA2AConfig = {
        workspace: '/test/workspace',
      };

      expect(config.workspace).toBe('/test/workspace');
      expect(config.model).toBeUndefined();
      expect(config.sessionId).toBeUndefined();
    });
  });
});

describe('cursorA2aService - Integration Tests (Mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Note: Full integration tests for executeCursorA2AQuery, executeCursorA2AStreaming,
  // handleMessageSend, and handleMessageStream require more complex mocking of the
  // cursorEngine.sendMessage callback behavior. These are better tested as integration
  // tests with the actual engine or in E2E tests.

  describe('executeCursorA2AQuery', () => {
    it('should require text content in message', async () => {
      const { executeCursorA2AQuery } = await import('../cursorA2aService.js');

      const emptyMessage: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-123',
        parts: [], // No text parts
      };

      const params: CursorA2AMessageParams = { message: emptyMessage };
      const config: CursorA2AConfig = { workspace: '/test' };

      await expect(executeCursorA2AQuery(params, config)).rejects.toThrow(
        'Message must contain at least one text part'
      );
    });

    it('should extract text from multiple text parts', async () => {
      const { cursorEngine } = await import('../../../engines/cursor/index.js');
      const { executeCursorA2AQuery } = await import('../cursorA2aService.js');

      // Mock sendMessage to capture the messageText
      let capturedMessage = '';
      vi.mocked(cursorEngine.sendMessage).mockImplementation(
        async (message: string, config: any, callback: any) => {
          capturedMessage = message;
          // Simulate a simple response
          callback({ type: 'RUN_STARTED' });
          callback({ type: 'TEXT_MESSAGE_START', messageId: 'resp-1' });
          callback({ type: 'TEXT_MESSAGE_CONTENT', content: 'Response' });
          callback({ type: 'TEXT_MESSAGE_END' });
          callback({ type: 'RUN_FINISHED' });
          return { sessionId: 'test-session' };
        }
      );

      const multiPartMessage: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-123',
        parts: [
          { kind: 'text', text: 'First part' },
          { kind: 'text', text: 'Second part' },
        ],
      };

      const params: CursorA2AMessageParams = { message: multiPartMessage };
      const config: CursorA2AConfig = { workspace: '/test' };

      await executeCursorA2AQuery(params, config);

      expect(capturedMessage).toBe('First part\nSecond part');
    });

    it('should return task with completed state after successful execution', async () => {
      const { cursorEngine } = await import('../../../engines/cursor/index.js');
      const { executeCursorA2AQuery } = await import('../cursorA2aService.js');

      vi.mocked(cursorEngine.sendMessage).mockImplementation(
        async (message: string, config: any, callback: any) => {
          callback({ type: 'RUN_STARTED' });
          callback({ type: 'TEXT_MESSAGE_START', messageId: 'resp-1' });
          callback({ type: 'TEXT_MESSAGE_CONTENT', content: 'Hello!' });
          callback({ type: 'TEXT_MESSAGE_END' });
          callback({ type: 'RUN_FINISHED' });
          return { sessionId: 'session-abc' };
        }
      );

      const message = createUserMessage('Say hello');
      const result = await executeCursorA2AQuery(
        { message },
        { workspace: '/test', model: 'auto' }
      );

      expect(result.task.status.state).toBe('completed');
      expect(result.responseText).toBe('Hello!');
      expect(result.sessionId).toBe('session-abc');
    });
  });

  describe('executeCursorA2AStreaming', () => {
    it('should call onResponse for each A2A event', async () => {
      const { cursorEngine } = await import('../../../engines/cursor/index.js');
      const { executeCursorA2AStreaming, createUserMessage } = await import(
        '../cursorA2aService.js'
      );

      vi.mocked(cursorEngine.sendMessage).mockImplementation(
        async (message: string, config: any, callback: any) => {
          callback({ type: 'RUN_STARTED' });
          callback({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
          callback({ type: 'TEXT_MESSAGE_CONTENT', content: 'Streaming' });
          callback({ type: 'TEXT_MESSAGE_END' });
          callback({ type: 'RUN_FINISHED' });
          return { sessionId: 'stream-session' };
        }
      );

      const responses: any[] = [];
      const message = createUserMessage('Test streaming');

      const result = await executeCursorA2AStreaming(
        { message },
        { workspace: '/test' },
        (response) => responses.push(response)
      );

      // Should have received multiple A2A responses
      expect(responses.length).toBeGreaterThan(0);

      // First should be status working
      expect(responses[0].result.kind).toBe('status-update');
      expect(responses[0].result.status.state).toBe('working');

      // Last should be status completed
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.result.status.state).toBe('completed');

      expect(result.sessionId).toBe('stream-session');
    });
  });

  describe('handleMessageSend', () => {
    it('should return task immediately for non-blocking requests', async () => {
      const { handleMessageSend, createUserMessage } = await import(
        '../cursorA2aService.js'
      );

      const message = createUserMessage('Non-blocking test');
      const params: CursorA2AMessageParams = {
        message,
        configuration: { blocking: false },
      };

      const result = await handleMessageSend(params, {
        workspace: '/test',
        taskId: 'predefined-task',
        contextId: 'predefined-context',
      });

      // Non-blocking should return submitted task immediately
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('status');
      expect((result as any).status.state).toBe('submitted');
    });
  });
});

describe('generateCursorAgentCard', () => {
  it('should generate valid Agent Card structure', async () => {
    const { generateCursorAgentCard } = await import('../cursorA2aService.js');

    const context = {
      a2aAgentId: 'agent-123',
      projectId: 'proj-456',
      projectName: 'Test Project',
      workingDirectory: '/test/project',
      baseUrl: 'https://example.com',
    };

    const card = await generateCursorAgentCard(context);

    // Check required fields
    expect(card.name).toBe('Cursor Agent');
    expect(card.description).toContain('Cursor CLI');
    expect(card.url).toBe('https://example.com/a2a/agent-123');
    expect(card.version).toBe('1.0.0');

    // Check provider info
    expect(card.provider?.organization).toBe('Cursor');
    expect(card.provider?.url).toBe('https://cursor.com');

    // Check capabilities
    expect(card.capabilities.streaming).toBe(true);

    // Check security
    expect(card.securitySchemes.apiKey).toBeDefined();
    expect(card.securitySchemes.apiKey.type).toBe('apiKey');

    // Check skills
    expect(card.skills).toBeInstanceOf(Array);
    expect(card.skills.length).toBeGreaterThan(0);

    // Check context
    expect(card.context.engineType).toBe('cursor');
    expect(card.context.projectId).toBe('proj-456');
    expect(card.context.supportedModels).toBeInstanceOf(Array);
  });

  it('should include all expected skills', async () => {
    const { generateCursorAgentCard } = await import('../cursorA2aService.js');

    const card = await generateCursorAgentCard({
      a2aAgentId: 'agent-123',
      projectId: 'proj-456',
      projectName: 'Test Project',
      workingDirectory: '/test',
      baseUrl: 'https://example.com',
    });

    const skillIds = card.skills.map((s: any) => s.id);

    expect(skillIds).toContain('code-editing');
    expect(skillIds).toContain('file-operations');
    expect(skillIds).toContain('terminal-execution');
    expect(skillIds).toContain('code-search');
    expect(skillIds).toContain('coding-assistant');
  });

  it('should include supported models from cursor engine', async () => {
    const { generateCursorAgentCard } = await import('../cursorA2aService.js');

    const card = await generateCursorAgentCard({
      a2aAgentId: 'agent-123',
      projectId: 'proj-456',
      projectName: 'Test Project',
      workingDirectory: '/test',
      baseUrl: 'https://example.com',
    });

    const modelIds = card.context.supportedModels.map((m: any) => m.id);

    expect(modelIds).toContain('auto');
    expect(modelIds).toContain('gpt-4');
    expect(modelIds).toContain('claude-3-opus');
  });
});
