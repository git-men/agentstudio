/**
 * HTTP MCP Server for Frontend Tools
 *
 * Exposes frontend tools as an HTTP-based MCP endpoint that external CLI
 * engines (e.g. Cursor CLI) can connect to via .cursor/mcp.json.
 *
 * Implements a minimal subset of the MCP protocol (JSON-RPC 2.0 over HTTP):
 *   - initialize
 *   - tools/list
 *   - tools/call
 *
 * Tool calls are bridged to the shared `frontendToolBridge` so that results
 * flow through the same SSE / AGUI notification mechanism.
 */

import express, { type Router, type Request, type Response } from 'express';
import { frontendToolBridge } from './frontendToolBridge.js';
import type { FrontendToolDefinition } from './types.js';

// ── Session-scoped Tool Registry ────────────────────────────────────

interface SessionToolEntry {
  agentId: string;
  tools: FrontendToolDefinition[];
  registeredAt: number;
}

class HttpMcpToolRegistry {
  private sessions = new Map<string, SessionToolEntry>();

  registerSession(sessionId: string, agentId: string, tools: FrontendToolDefinition[]): void {
    this.sessions.set(sessionId, { agentId, tools, registeredAt: Date.now() });
    console.log(`[HttpMcp] Registered ${tools.length} tool(s) for session ${sessionId}`);
  }

  unregisterSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[HttpMcp] Unregistered session ${sessionId}`);
  }

  getSession(sessionId: string): SessionToolEntry | undefined {
    return this.sessions.get(sessionId);
  }

  updateSessionId(oldId: string, newId: string): void {
    const entry = this.sessions.get(oldId);
    if (entry) {
      this.sessions.delete(oldId);
      this.sessions.set(newId, entry);
      console.log(`[HttpMcp] Updated session ID: ${oldId} → ${newId}`);
    }
  }

  getStats(): { sessionCount: number } {
    return { sessionCount: this.sessions.size };
  }
}

export const httpMcpToolRegistry = new HttpMcpToolRegistry();

// ── JSON-RPC helpers ────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
}

function jsonRpcOk(id: string | number | undefined, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function jsonRpcError(id: string | number | undefined, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

// ── Convert FrontendToolDefinition → MCP tool schema ────────────────

function toMcpToolSchema(def: FrontendToolDefinition) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: {
      type: 'object',
      properties: def.parameters.properties,
      required: def.parameters.required || [],
    },
  };
}

// ── Route handler ───────────────────────────────────────────────────

/**
 * Create a standalone router for the HTTP MCP endpoint.
 * Mount on `/api/mcp-bridge` — endpoint: POST /api/mcp-bridge/frontend-tools/:sessionId
 */
export function createHttpMcpRouter(): Router {
  const router = express.Router();

  router.post('/frontend-tools/:sessionId', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const body = req.body as JsonRpcRequest;

    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return res.status(400).json(jsonRpcError(body?.id, -32600, 'Invalid JSON-RPC request'));
    }

    const entry = httpMcpToolRegistry.getSession(sessionId);

    switch (body.method) {
      case 'initialize': {
        return res.json(jsonRpcOk(body.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'frontend-tools', version: '1.0.0' },
        }));
      }

      case 'notifications/initialized': {
        return res.json(jsonRpcOk(body.id, {}));
      }

      case 'tools/list': {
        if (!entry) {
          return res.json(jsonRpcOk(body.id, { tools: [] }));
        }
        return res.json(jsonRpcOk(body.id, {
          tools: entry.tools.map(toMcpToolSchema),
        }));
      }

      case 'tools/call': {
        if (!entry) {
          return res.json(jsonRpcError(body.id, -32602, 'Session not found'));
        }

        const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
        if (!params?.name) {
          return res.json(jsonRpcError(body.id, -32602, 'Missing tool name'));
        }

        const toolDef = entry.tools.find(t => t.name === params.name);
        if (!toolDef) {
          return res.json(jsonRpcError(body.id, -32602, `Unknown tool: ${params.name}`));
        }

        const toolCallId = `ft_http_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        const args = params.arguments || {};

        try {
          const result = await frontendToolBridge.waitForResult(
            toolCallId,
            toolDef.name,
            sessionId,
            entry.agentId,
            args,
          );

          return res.json(jsonRpcOk(body.id, {
            content: [{ type: 'text', text: result }],
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return res.json(jsonRpcOk(body.id, {
            content: [{ type: 'text', text: `Frontend tool error: ${msg}` }],
            isError: true,
          }));
        }
      }

      default:
        return res.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
    }
  });

  return router;
}
