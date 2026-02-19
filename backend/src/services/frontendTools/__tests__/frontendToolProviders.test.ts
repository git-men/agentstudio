import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: vi.fn(({ name }) => ({ type: 'sdk', name })),
  tool: vi.fn((name, desc, schema, handler) => ({
    name,
    description: desc,
    schema,
    handler,
  })),
}));

import { InProcessProvider, HttpMcpProvider, getFrontendToolProvider } from '../frontendToolProviders.js';
import { httpMcpToolRegistry } from '../httpMcpServer.js';
import type { FrontendToolDefinition } from '../types.js';

const TOOL_DEF: FrontendToolDefinition = {
  name: 'rate_response',
  description: 'Rate a response',
  parameters: {
    type: 'object',
    properties: { rating: { type: 'number' } },
    required: ['rating'],
  },
};

describe('InProcessProvider', () => {
  it('creates MCP servers for built-in and dynamic tools', async () => {
    const provider = new InProcessProvider();
    const result = await provider.setup('session-1', 'agent-1', [TOOL_DEF]);

    expect(Object.keys(result.mcpServers).length).toBeGreaterThanOrEqual(1);
    expect(result.allowedTools.length).toBeGreaterThanOrEqual(1);
    expect(result.sessionRef.current).toBe('session-1');

    // Should have both built-in (ask-user-question) and dynamic (frontend-tools)
    expect(result.mcpServers).toHaveProperty('ask-user-question');
    expect(result.mcpServers).toHaveProperty('frontend-tools');
    expect(result.allowedTools).toContain('mcp__frontend-tools__rate_response');
  });

  it('works with no dynamic tools (only built-ins)', async () => {
    const provider = new InProcessProvider();
    const result = await provider.setup('session-2', 'agent-1', []);

    expect(result.mcpServers).toHaveProperty('ask-user-question');
    expect(result.mcpServers).not.toHaveProperty('frontend-tools');
  });

  it('cleanup is a no-op', () => {
    const provider = new InProcessProvider();
    expect(() => provider.cleanup('session-1')).not.toThrow();
  });
});

describe('HttpMcpProvider', () => {
  beforeEach(() => {
    httpMcpToolRegistry.unregisterSession('session-3');
  });

  it('registers tools in the HTTP MCP registry', async () => {
    const provider = new HttpMcpProvider();
    await provider.setup('session-3', 'agent-1', [TOOL_DEF]);

    const session = httpMcpToolRegistry.getSession('session-3');
    expect(session).toBeDefined();
    expect(session!.tools.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty mcpServers (tools are exposed via HTTP)', async () => {
    const provider = new HttpMcpProvider();
    const result = await provider.setup('session-3', 'agent-1', [TOOL_DEF]);

    expect(Object.keys(result.mcpServers)).toHaveLength(0);
    expect(result.allowedTools).toHaveLength(0);
  });

  it('cleanup removes session from registry', async () => {
    const provider = new HttpMcpProvider();
    await provider.setup('session-3', 'agent-1', [TOOL_DEF]);
    provider.cleanup('session-3');

    expect(httpMcpToolRegistry.getSession('session-3')).toBeUndefined();
  });
});

describe('getFrontendToolProvider', () => {
  it('returns InProcessProvider for in-process type', () => {
    const provider = getFrontendToolProvider('in-process');
    expect(provider).toBeInstanceOf(InProcessProvider);
  });

  it('returns HttpMcpProvider for http-mcp type', () => {
    const provider = getFrontendToolProvider('http-mcp');
    expect(provider).toBeInstanceOf(HttpMcpProvider);
  });
});
