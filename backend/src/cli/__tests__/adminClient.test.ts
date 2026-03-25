/**
 * Unit tests for McpAdminClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpAdminClient, resolveClientConfig } from '../adminClient';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonRpcOk(id: number, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonRpcError(id: number, code: number, message: string) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('McpAdminClient', () => {
  let client: McpAdminClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new McpAdminClient('http://localhost:4936', 'test-key-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should send initialize JSON-RPC request', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonRpcOk(1, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'agentstudio-admin', version: '1.0.0' },
        }),
      );

      await client.initialize();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:4936/api/mcp-admin');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Authorization']).toBe('Bearer test-key-123');

      const body = JSON.parse(opts.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('initialize');
      expect(body.params.clientInfo.name).toBe('agentstudio-cli');
    });
  });

  describe('listTools', () => {
    it('should return tools from the server', async () => {
      const mockTools = [
        { name: 'list_projects', description: 'List projects', inputSchema: { type: 'object', properties: {} } },
        { name: 'get_agent', description: 'Get agent', inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] } },
      ];

      mockFetch.mockResolvedValueOnce(jsonRpcOk(1, { tools: mockTools }));

      const tools = await client.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('list_projects');
      expect(tools[1].inputSchema.required).toEqual(['agentId']);
    });

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcError(1, -32603, 'Internal error'));

      await expect(client.listTools()).rejects.toThrow('Failed to list tools');
    });
  });

  describe('callTool', () => {
    it('should call a tool and return the result', async () => {
      const toolResult = {
        content: [{ type: 'text', text: '{"projects":[],"total":0}' }],
      };
      mockFetch.mockResolvedValueOnce(jsonRpcOk(1, toolResult));

      const result = await client.callTool('list_projects', { limit: 10 });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('"total":0');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('list_projects');
      expect(body.params.arguments).toEqual({ limit: 10 });
    });

    it('should call a tool with empty args when none provided', async () => {
      const toolResult = { content: [{ type: 'text', text: '{}' }] };
      mockFetch.mockResolvedValueOnce(jsonRpcOk(1, toolResult));

      await client.callTool('health_check');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.params.arguments).toEqual({});
    });

    it('should throw on JSON-RPC error with data', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32601, message: 'Method not found', data: 'Tool not found: bad_tool' },
          }),
          { status: 200 },
        ),
      );

      await expect(client.callTool('bad_tool')).rejects.toThrow('Method not found: Tool not found: bad_tool');
    });
  });

  describe('ping', () => {
    it('should return true when server responds', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcOk(1, {}));
      expect(await client.ping()).toBe(true);
    });

    it('should return false when server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await client.ping()).toBe(false);
    });

    it('should return false on JSON-RPC error', async () => {
      mockFetch.mockResolvedValueOnce(jsonRpcError(1, -32603, 'Internal'));
      expect(await client.ping()).toBe(false);
    });
  });

  describe('HTTP error handling', () => {
    it('should throw on 401 with auth hint', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
      await expect(client.callTool('any')).rejects.toThrow('Authentication failed (401)');
    });

    it('should throw on 403 with auth hint', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      await expect(client.callTool('any')).rejects.toThrow('Authentication failed (403)');
    });

    it('should throw on 500 with status text', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }));
      await expect(client.callTool('any')).rejects.toThrow('HTTP 500');
    });
  });

  describe('trailing slash handling', () => {
    it('should strip trailing slash from base URL', async () => {
      const c = new McpAdminClient('http://localhost:4936/', 'key');
      mockFetch.mockResolvedValueOnce(jsonRpcOk(1, {}));
      await c.ping();
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:4936/api/mcp-admin');
    });
  });

  describe('newline-delimited response parsing', () => {
    it('should handle newline-delimited JSON-RPC responses', async () => {
      const multiLine = [
        JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'test' }] } }),
      ].join('\n');

      mockFetch.mockResolvedValueOnce(new Response(multiLine, { status: 200 }));
      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test');
    });
  });
});

describe('resolveClientConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTSTUDIO_SERVER;
    delete process.env.AGENTSTUDIO_ADMIN_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use CLI options when provided', () => {
    const config = resolveClientConfig({
      server: 'http://custom:9999',
      apiKey: 'my-key',
    });
    expect(config.baseUrl).toBe('http://custom:9999');
    expect(config.apiKey).toBe('my-key');
  });

  it('should fall back to environment variables', () => {
    process.env.AGENTSTUDIO_SERVER = 'http://env-server:4936';
    process.env.AGENTSTUDIO_ADMIN_API_KEY = 'env-key';

    const config = resolveClientConfig({});
    expect(config.baseUrl).toBe('http://env-server:4936');
    expect(config.apiKey).toBe('env-key');
  });

  it('should use defaults for server URL', () => {
    const config = resolveClientConfig({ apiKey: 'k' });
    expect(config.baseUrl).toBe('http://127.0.0.1:4936');
  });

  it('should throw when no API key is provided', () => {
    expect(() => resolveClientConfig({})).toThrow('Admin API key is required');
  });

  it('should prefer CLI option over env var', () => {
    process.env.AGENTSTUDIO_ADMIN_API_KEY = 'env-key';
    const config = resolveClientConfig({ apiKey: 'cli-key' });
    expect(config.apiKey).toBe('cli-key');
  });
});
