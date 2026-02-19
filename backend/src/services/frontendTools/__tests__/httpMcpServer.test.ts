import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { httpMcpToolRegistry, createHttpMcpRouter } from '../httpMcpServer.js';
import { frontendToolBridge } from '../frontendToolBridge.js';
import type { FrontendToolDefinition } from '../types.js';

const TOOL_DEF: FrontendToolDefinition = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp-bridge', createHttpMcpRouter());
  return app;
}

describe('HttpMcpToolRegistry', () => {
  const SID = 'registry-test';

  afterEach(() => {
    httpMcpToolRegistry.unregisterSession(SID);
    httpMcpToolRegistry.unregisterSession('new-id');
  });

  it('registers and retrieves sessions', () => {
    httpMcpToolRegistry.registerSession(SID, 'agent-1', [TOOL_DEF]);
    const entry = httpMcpToolRegistry.getSession(SID);
    expect(entry).toBeDefined();
    expect(entry!.agentId).toBe('agent-1');
    expect(entry!.tools).toHaveLength(1);
    expect(entry!.tools[0].name).toBe('test_tool');
  });

  it('unregisters sessions', () => {
    httpMcpToolRegistry.registerSession(SID, 'agent-1', [TOOL_DEF]);
    httpMcpToolRegistry.unregisterSession(SID);
    expect(httpMcpToolRegistry.getSession(SID)).toBeUndefined();
  });

  it('updates session IDs', () => {
    httpMcpToolRegistry.registerSession(SID, 'agent-1', [TOOL_DEF]);
    httpMcpToolRegistry.updateSessionId(SID, 'new-id');
    expect(httpMcpToolRegistry.getSession(SID)).toBeUndefined();
    expect(httpMcpToolRegistry.getSession('new-id')).toBeDefined();
  });
});

describe('HTTP MCP Router', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createApp();
    httpMcpToolRegistry.registerSession('test-session', 'agent-1', [TOOL_DEF]);
  });

  afterEach(() => {
    httpMcpToolRegistry.unregisterSession('test-session');
  });

  it('handles initialize', async () => {
    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/test-session')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('frontend-tools');
  });

  it('handles tools/list', async () => {
    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/test-session')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.body.result.tools).toHaveLength(1);
    expect(res.body.result.tools[0].name).toBe('test_tool');
  });

  it('returns empty tools for unknown session', async () => {
    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/unknown-session')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.body.result.tools).toHaveLength(0);
  });

  it('handles tools/call and resolves via bridge', async () => {
    // Auto-resolve tool invocations from the bridge
    frontendToolBridge.once('tool_invocation', (req) => {
      frontendToolBridge.submitResult(req.toolCallId, 'tool result', 'test-session', 'agent-1');
    });

    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/test-session')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'test_tool', arguments: { value: 'hello' } },
      });

    expect(res.status).toBe(200);
    expect(res.body.result.content[0].text).toBe('tool result');
  });

  it('returns error for unknown tool', async () => {
    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/test-session')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'nonexistent' },
      });
    expect(res.body.error).toBeDefined();
    expect(res.body.error.message).toContain('Unknown tool');
  });

  it('returns error for unknown method', async () => {
    const res = await request(app)
      .post('/mcp-bridge/frontend-tools/test-session')
      .send({ jsonrpc: '2.0', id: 4, method: 'unknown/method' });
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32601);
  });
});
