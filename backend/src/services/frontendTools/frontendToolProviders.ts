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
  private configWriter: McpConfigWriter;

  constructor(configWriter?: McpConfigWriter) {
    this.configWriter = configWriter || new CursorConfigWriter();
  }

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

    if (context?.backendBaseUrl && allTools.length > 0) {
      await this.configWriter.write(context.workspace || '', context.backendBaseUrl, sessionId);
    }

    return { mcpServers: {}, allowedTools: [], sessionRef };
  }

  cleanup(sessionId: string): void {
    httpMcpToolRegistry.unregisterSession(sessionId);
    this.configWriter.cleanup?.(sessionId);
  }
}

// ── Config Writers ──────────────────────────────────────────────────

export interface McpConfigWriter {
  write(workspace: string, backendBaseUrl: string, sessionId: string): Promise<void>;
  cleanup?(sessionId: string): Promise<void>;
}

export class CursorConfigWriter implements McpConfigWriter {
  async write(workspace: string, backendBaseUrl: string, sessionId: string): Promise<void> {
    const { writeMcpConfig } = await import('./mcpConfigManager.js');
    await writeMcpConfig(workspace, backendBaseUrl, sessionId);
  }
}

export class CodexConfigWriter implements McpConfigWriter {
  async write(_workspace: string, backendBaseUrl: string, sessionId: string): Promise<void> {
    const { writeCodexMcpToml } = await import('./mcpConfigManager.js');
    await writeCodexMcpToml(backendBaseUrl, sessionId);
  }

  async cleanup(sessionId: string): Promise<void> {
    const { removeCodexMcpTomlEntry } = await import('./mcpConfigManager.js');
    await removeCodexMcpTomlEntry(sessionId);
  }
}

// ── Factory ─────────────────────────────────────────────────────────

const inProcessProvider = new InProcessProvider();
const cursorHttpProvider = new HttpMcpProvider(new CursorConfigWriter());
const codexHttpProvider = new HttpMcpProvider(new CodexConfigWriter());

export type ProviderType = 'in-process' | 'http-mcp' | 'http-mcp-codex';

export function getFrontendToolProvider(type: ProviderType): IFrontendToolProvider {
  if (type === 'http-mcp-codex') return codexHttpProvider;
  if (type === 'http-mcp') return cursorHttpProvider;
  return inProcessProvider;
}

/**
 * Determine the correct provider type for a given engine type.
 */
export function getProviderType(engineType: string): ProviderType {
  if (engineType === 'codex' || engineType === 'codex-sdk') {
    return 'http-mcp-codex';
  }
  if (engineType === 'cursor') {
    return 'http-mcp';
  }
  return 'in-process';
}
