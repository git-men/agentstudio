/**
 * Unit tests for aguiA2aService — Generic AGUI A2A Service
 *
 * Validates the unified A2A service that handles Cursor, Codex,
 * Codex-SDK, CodeBuddy (and any future AGUI engine) via engineManager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { A2AMessage } from '../../../engines/cursor/a2aAdapter.js';
import type { AguiA2AConfig, AguiA2AMessageParams } from '../aguiA2aService.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSendMessage = vi.fn();
const mockGetSupportedModels = vi.fn();
const mockGetEngine = vi.fn();

vi.mock('../../../engines/index.js', () => ({
  engineManager: {
    sendMessage: (...args: any[]) => mockSendMessage(...args),
    getEngine: (...args: any[]) => mockGetEngine(...args),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTextMessage(text: string, overrides: Partial<A2AMessage> = {}): A2AMessage {
  return {
    kind: 'message',
    role: 'user',
    messageId: 'msg-test-1',
    parts: [{ kind: 'text', text }],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AguiA2AConfig> = {}): AguiA2AConfig {
  return {
    engineType: 'codex-sdk',
    workspace: '/test/workspace',
    ...overrides,
  };
}

function simulateAguiEvents(callback: (...args: any[]) => void) {
  callback({ type: 'RUN_STARTED' });
  callback({ type: 'TEXT_MESSAGE_START', messageId: 'resp-1' });
  callback({ type: 'TEXT_MESSAGE_CONTENT', content: 'Hello from AGUI!' });
  callback({ type: 'TEXT_MESSAGE_END' });
  callback({ type: 'RUN_FINISHED' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('aguiA2aService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSendMessage.mockImplementation(
      async (_engineType: string, _msg: string, _config: any, onEvent: any) => {
        simulateAguiEvents(onEvent);
        return { sessionId: 'sess-abc' };
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // executeAguiA2AQuery
  // =========================================================================

  describe('executeAguiA2AQuery', () => {
    it('should delegate to engineManager.sendMessage with correct engineType', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Explain this code');
      const config = makeConfig({ engineType: 'codex' });

      await executeAguiA2AQuery({ message }, config);

      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage.mock.calls[0][0]).toBe('codex');
      expect(mockSendMessage.mock.calls[0][1]).toBe('Explain this code');
    });

    it('should work with codex-sdk engine', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Fix the bug');
      const config = makeConfig({ engineType: 'codex-sdk' });

      await executeAguiA2AQuery({ message }, config);

      expect(mockSendMessage.mock.calls[0][0]).toBe('codex-sdk');
    });

    it('should work with codebuddy engine', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Refactor this');
      const config = makeConfig({ engineType: 'codebuddy' });

      await executeAguiA2AQuery({ message }, config);

      expect(mockSendMessage.mock.calls[0][0]).toBe('codebuddy');
    });

    it('should work with cursor engine (backward compat)', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Hello cursor');
      const config = makeConfig({ engineType: 'cursor' });

      await executeAguiA2AQuery({ message }, config);

      expect(mockSendMessage.mock.calls[0][0]).toBe('cursor');
    });

    it('should return task, responseText, and sessionId', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Hello');
      const result = await executeAguiA2AQuery({ message }, makeConfig());

      expect(result.sessionId).toBe('sess-abc');
      expect(result.responseText).toBe('Hello from AGUI!');
      expect(result.task).toBeDefined();
      expect(result.task.id).toBeDefined();
      expect(result.task.status.state).toBe('completed');
    });

    it('should pass model and permissionMode through to engineConfig', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('Test');
      const config = makeConfig({
        model: 'gpt-5.3-codex',
        permissionMode: 'bypassPermissions',
        timeout: 30000,
      });

      await executeAguiA2AQuery({ message }, config);

      const passedConfig = mockSendMessage.mock.calls[0][2];
      expect(passedConfig.model).toBe('gpt-5.3-codex');
      expect(passedConfig.permissionMode).toBe('bypassPermissions');
      expect(passedConfig.timeout).toBe(30000);
    });

    it('should throw when message has no text parts', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const emptyMessage: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-empty',
        parts: [],
      };

      await expect(
        executeAguiA2AQuery({ message: emptyMessage }, makeConfig())
      ).rejects.toThrow('Message must contain at least one text part');
    });

    it('should concatenate multiple text parts with newline', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message: A2AMessage = {
        kind: 'message',
        role: 'user',
        messageId: 'msg-multi',
        parts: [
          { kind: 'text', text: 'Part A' },
          { kind: 'text', text: 'Part B' },
        ],
      };

      await executeAguiA2AQuery({ message }, makeConfig());

      expect(mockSendMessage.mock.calls[0][1]).toBe('Part A\nPart B');
    });

    it('should use default timeout of 600000 when not specified', async () => {
      const { executeAguiA2AQuery } = await import('../aguiA2aService.js');

      const message = makeTextMessage('hi');
      await executeAguiA2AQuery({ message }, makeConfig());

      const passedConfig = mockSendMessage.mock.calls[0][2];
      expect(passedConfig.timeout).toBe(600000);
    });
  });

  // =========================================================================
  // executeAguiA2AStreaming
  // =========================================================================

  describe('executeAguiA2AStreaming', () => {
    it('should emit A2A streaming responses for each engine event', async () => {
      const { executeAguiA2AStreaming } = await import('../aguiA2aService.js');

      const responses: any[] = [];
      const message = makeTextMessage('Stream test');

      const result = await executeAguiA2AStreaming(
        { message },
        makeConfig({ engineType: 'codex-sdk' }),
        (response) => responses.push(response)
      );

      expect(responses.length).toBeGreaterThan(0);
      expect(responses[0].result.kind).toBe('status-update');
      expect(responses[0].result.status.state).toBe('working');

      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.result.status.state).toBe('completed');

      expect(result.sessionId).toBe('sess-abc');
      expect(result.taskId).toBeDefined();
      expect(result.contextId).toBeDefined();
    });

    it('should propagate engineType correctly for streaming', async () => {
      const { executeAguiA2AStreaming } = await import('../aguiA2aService.js');

      const message = makeTextMessage('codebuddy stream');
      await executeAguiA2AStreaming(
        { message },
        makeConfig({ engineType: 'codebuddy' }),
        () => {}
      );

      expect(mockSendMessage.mock.calls[0][0]).toBe('codebuddy');
    });

    it('should use provided taskId and contextId', async () => {
      const { executeAguiA2AStreaming } = await import('../aguiA2aService.js');

      const message = makeTextMessage('with ids', {
        taskId: 'custom-task',
        contextId: 'custom-ctx',
      });

      const result = await executeAguiA2AStreaming(
        { message },
        makeConfig({ taskId: 'custom-task', contextId: 'custom-ctx' }),
        () => {}
      );

      expect(result.taskId).toBe('custom-task');
      expect(result.contextId).toBe('custom-ctx');
    });
  });

  // =========================================================================
  // generateAguiAgentCard
  // =========================================================================

  describe('generateAguiAgentCard', () => {
    const defaultContext = {
      a2aAgentId: 'agent-001',
      projectId: 'proj-001',
      projectName: 'My Project',
      workingDirectory: '/workspace',
      baseUrl: 'https://studio.example.com',
    };

    beforeEach(() => {
      mockGetEngine.mockReturnValue({
        getSupportedModels: mockGetSupportedModels,
        capabilities: {
          streaming: true,
          features: { codeExecution: true },
        },
      });
      mockGetSupportedModels.mockResolvedValue([
        { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
        { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
      ]);
    });

    it('should generate card for codex-sdk engine', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex-sdk', defaultContext);

      expect(card.name).toBe('Codex Agent');
      expect(card.provider.organization).toBe('OpenAI');
      expect(card.provider.url).toBe('https://openai.com');
      expect(card.url).toBe('https://studio.example.com/a2a/agent-001');
      expect(card.version).toBe('1.0.0');
      expect(card.context.engineType).toBe('codex-sdk');
    });

    it('should generate card for codex engine', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex', defaultContext);

      expect(card.name).toBe('Codex Agent');
      expect(card.provider.organization).toBe('OpenAI');
    });

    it('should generate card for codebuddy engine', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codebuddy', defaultContext);

      expect(card.name).toBe('CodeBuddy Agent');
      expect(card.provider.organization).toBe('Tencent');
      expect(card.provider.url).toBe('https://cloud.tencent.com');
    });

    it('should generate card for cursor engine', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('cursor', defaultContext);

      expect(card.name).toBe('Cursor Agent');
      expect(card.provider.organization).toBe('Cursor');
    });

    it('should fall back to Claude labels for unknown engine', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('some-future-engine' as any, defaultContext);

      expect(card.name).toBe('Claude Agent');
      expect(card.provider.organization).toBe('Anthropic');
    });

    it('should include supported models in context', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex-sdk', defaultContext);

      expect(card.context.supportedModels).toEqual([
        { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
        { id: 'gpt-5-codex', name: 'GPT-5 Codex' },
      ]);
    });

    it('should include terminal-execution skill when codeExecution is supported', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex-sdk', defaultContext);

      const skillIds = card.skills.map((s: any) => s.id);
      expect(skillIds).toContain('terminal-execution');
      expect(skillIds).toContain('code-editing');
      expect(skillIds).toContain('file-operations');
      expect(skillIds).toContain('code-search');
      expect(skillIds).toContain('coding-assistant');
    });

    it('should omit terminal-execution skill when codeExecution is false', async () => {
      mockGetEngine.mockReturnValue({
        getSupportedModels: mockGetSupportedModels,
        capabilities: {
          streaming: true,
          features: { codeExecution: false },
        },
      });

      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex', defaultContext);

      const skillIds = card.skills.map((s: any) => s.id);
      expect(skillIds).not.toContain('terminal-execution');
      expect(skillIds).toContain('code-editing');
    });

    it('should include standard A2A capabilities', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex-sdk', defaultContext);

      expect(card.capabilities.streaming).toBe(true);
      expect(card.capabilities.pushNotifications).toBe(false);
      expect(card.securitySchemes.apiKey.type).toBe('apiKey');
      expect(card.defaultInputModes).toContain('text/plain');
      expect(card.defaultOutputModes).toContain('text/plain');
    });

    it('should embed project context correctly', async () => {
      const { generateAguiAgentCard } = await import('../aguiA2aService.js');

      const card = await generateAguiAgentCard('codex-sdk', defaultContext);

      expect(card.context.a2aAgentId).toBe('agent-001');
      expect(card.context.projectId).toBe('proj-001');
      expect(card.context.projectName).toBe('My Project');
      expect(card.context.workingDirectory).toBe('/workspace');
    });
  });
});
