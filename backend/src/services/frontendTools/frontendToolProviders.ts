/**
 * Frontend Tool Providers
 *
 * Abstraction layer that decouples frontend tool delivery from the specific
 * transport used by each engine.
 *
 * - InProcessProvider  → Claude SDK / CodeBuddy SDK  (in-process MCP Server)
 * - HttpMcpProvider    → Cursor CLI                  (HTTP MCP + .mcp.json)
 */

import {
  createFrontendToolMcpServer,
  createUnifiedFrontendToolServer,
  registerServerName,
  UNIFIED_SERVER_NAME,
  type SessionRef,
} from './frontendToolMcp.js';
import { BUILTIN_FRONTEND_TOOLS } from './builtinTools.js';
import type { FrontendToolDefinition } from './types.js';
import { httpMcpToolRegistry } from './httpMcpServer.js';

// ── Provider Interface ──────────────────────────────────────────────

export interface FrontendToolProviderResult {
  mcpServers: Record<string, any>;
  allowedTools: string[];
  sessionRef: SessionRef;
}

export interface ProviderContext {
  workspace?: string;
  backendBaseUrl?: string;
}

export interface IFrontendToolProvider {
  setup(
    sessionId: string,
    agentId: string,
    clientTools: FrontendToolDefinition[],
    context?: ProviderContext,
  ): Promise<FrontendToolProviderResult>;

  cleanup(sessionId: string): void;
}

// ── InProcessProvider ───────────────────────────────────────────────

/**
 * Creates in-process SDK MCP servers.
 * Used by engines that accept MCP server objects directly (Claude, CodeBuddy).
 */
export class InProcessProvider implements IFrontendToolProvider {
  async setup(
    sessionId: string,
    agentId: string,
    clientTools: FrontendToolDefinition[],
  ): Promise<FrontendToolProviderResult> {
    const sessionRef: SessionRef = { current: sessionId };
    const mcpServers: Record<string, any> = {};
    const allowedTools: string[] = [];

    // Built-in tools get their own dedicated MCP servers (stable names)
    for (const toolDef of BUILTIN_FRONTEND_TOOLS) {
      const { server, serverName } = await createFrontendToolMcpServer(toolDef, sessionRef, agentId);
      if (server) {
        registerServerName(serverName);
        mcpServers[serverName] = server;
        const mcpName = `mcp__${serverName}__${toolDef.name}`;
        if (!allowedTools.includes(mcpName)) allowedTools.push(mcpName);
      }
    }

    // Dynamic tools share a single unified MCP server
    if (clientTools.length > 0) {
      const unified = await createUnifiedFrontendToolServer(clientTools, sessionRef, agentId);
      if (unified) {
        registerServerName(UNIFIED_SERVER_NAME);
        mcpServers[UNIFIED_SERVER_NAME] = unified.server;
        for (const toolDef of clientTools) {
          const mcpName = `mcp__${UNIFIED_SERVER_NAME}__${toolDef.name}`;
          if (!allowedTools.includes(mcpName)) allowedTools.push(mcpName);
        }
      }
    }

    return { mcpServers, allowedTools, sessionRef };
  }

  cleanup(_sessionId: string): void {
    // In-process servers are GC'd when queryOptions go out of scope
  }
}

// ── HttpMcpProvider ─────────────────────────────────────────────────

/**
 * Registers tools with an HTTP MCP endpoint and writes .cursor/mcp.json.
 * Used by engines that invoke an external CLI (Cursor CLI).
 */
export class HttpMcpProvider implements IFrontendToolProvider {
  async setup(
    sessionId: string,
    agentId: string,
    clientTools: FrontendToolDefinition[],
    context?: ProviderContext,
  ): Promise<FrontendToolProviderResult> {
    const sessionRef: SessionRef = { current: sessionId };
    const allTools = [...BUILTIN_FRONTEND_TOOLS, ...clientTools];

    if (allTools.length > 0) {
      httpMcpToolRegistry.registerSession(sessionId, agentId, allTools);
    }

    if (context?.workspace && context?.backendBaseUrl && allTools.length > 0) {
      const { writeMcpConfig } = await import('./mcpConfigManager.js');
      await writeMcpConfig(context.workspace, context.backendBaseUrl, sessionId);
    }

    return { mcpServers: {}, allowedTools: [], sessionRef };
  }

  cleanup(sessionId: string): void {
    httpMcpToolRegistry.unregisterSession(sessionId);
  }
}

// ── Factory ─────────────────────────────────────────────────────────

const inProcessProvider = new InProcessProvider();
const httpMcpProvider = new HttpMcpProvider();

export type ProviderType = 'in-process' | 'http-mcp';

export function getFrontendToolProvider(type: ProviderType): IFrontendToolProvider {
  return type === 'http-mcp' ? httpMcpProvider : inProcessProvider;
}
