import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing the module under test
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: vi.fn(({ name, tools }) => ({ name, tools, _mock: true })),
  tool: vi.fn((name, description, shape, handler) => ({ name, description, shape, handler, _mockTool: true })),
}));

import {
  createFrontendToolMcpServer,
  createUnifiedFrontendToolServer,
  isFrontendTool,
  resolveServerName,
  registerServerName,
  UNIFIED_SERVER_NAME,
  type SessionRef,
} from '../frontendToolMcp.js';
import type { FrontendToolDefinition } from '../types.js';

const makeToolDef = (name: string, overrides?: Partial<FrontendToolDefinition>): FrontendToolDefinition => ({
  name,
  description: `Test tool ${name}`,
  parameters: {
    type: 'object',
    properties: { input: { type: 'string', description: 'test input' } },
    required: ['input'],
  },
  ...overrides,
});

const makeSessionRef = (): SessionRef => ({ current: 'test-session' });

describe('frontendToolMcp', () => {
  describe('UNIFIED_SERVER_NAME', () => {
    it('is "frontend-tools"', () => {
      expect(UNIFIED_SERVER_NAME).toBe('frontend-tools');
    });
  });

  describe('resolveServerName', () => {
    it('returns custom mcpServerName when provided', () => {
      const def = makeToolDef('my_tool', { mcpServerName: 'custom-server' });
      expect(resolveServerName(def)).toBe('custom-server');
    });

    it('returns default frontend-tool-{name} otherwise', () => {
      const def = makeToolDef('rate_response');
      expect(resolveServerName(def)).toBe('frontend-tool-rate_response');
    });
  });

  describe('createFrontendToolMcpServer', () => {
    it('creates a server with the resolved name', async () => {
      const def = makeToolDef('my_tool');
      const { server, serverName } = await createFrontendToolMcpServer(def, makeSessionRef(), 'agent-1');

      expect(serverName).toBe('frontend-tool-my_tool');
      expect(server).toBeDefined();
      expect((server as any).name).toBe('frontend-tool-my_tool');
    });

    it('uses custom server name for built-in tools', async () => {
      const def = makeToolDef('ask_user_question', { mcpServerName: 'ask-user-question' });
      const { serverName } = await createFrontendToolMcpServer(def, makeSessionRef(), 'agent-1');

      expect(serverName).toBe('ask-user-question');
    });
  });

  describe('createUnifiedFrontendToolServer', () => {
    it('returns null for empty tool list', async () => {
      const result = await createUnifiedFrontendToolServer([], makeSessionRef(), 'agent-1');
      expect(result).toBeNull();
    });

    it('creates server with all tools under unified name', async () => {
      const tools = [makeToolDef('tool_a'), makeToolDef('tool_b'), makeToolDef('tool_c')];
      const result = await createUnifiedFrontendToolServer(tools, makeSessionRef(), 'agent-1');

      expect(result).not.toBeNull();
      expect(result!.serverName).toBe('frontend-tools');
      expect((result!.server as any).name).toBe('frontend-tools');
      expect((result!.server as any).tools).toHaveLength(3);
    });
  });

  describe('isFrontendTool', () => {
    it('recognizes unified server name', () => {
      expect(isFrontendTool('mcp__frontend-tools__rate_response')).toBe(true);
      expect(isFrontendTool('mcp__frontend-tools__collect_logs')).toBe(true);
    });

    it('recognizes legacy per-tool server name', () => {
      expect(isFrontendTool('mcp__frontend-tool-rate_response__rate_response')).toBe(true);
    });

    it('recognizes registered custom server names', () => {
      registerServerName('ask-user-question');
      expect(isFrontendTool('mcp__ask-user-question__ask_user_question')).toBe(true);
    });

    it('rejects unrelated tool names', () => {
      expect(isFrontendTool('mcp__browser__navigate')).toBe(false);
      expect(isFrontendTool('Read')).toBe(false);
      expect(isFrontendTool('Bash')).toBe(false);
    });
  });
});
