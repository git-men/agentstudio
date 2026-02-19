/**
 * Frontend Tools Integration Helper
 *
 * Integrates built-in and client-provided frontend tool MCP servers into
 * engine query options using the Provider pattern.
 *
 * Provider selection:
 *   - InProcessProvider  → Claude / CodeBuddy (SDK engines)
 *   - HttpMcpProvider    → Cursor CLI         (external CLI)
 */

import {
  getFrontendToolProvider,
  type ProviderType,
  type ProviderContext,
} from './frontendToolProviders.js';
import type { SessionRef } from './frontendToolMcp.js';
import type { FrontendToolDefinition } from './types.js';

export type { SessionRef };

export interface FrontendToolsIntegration {
  queryOptions: any;
  sessionRef: SessionRef | null;
}

/**
 * Integrate all frontend tools (built-in + client-provided) as MCP servers
 * into query options.
 *
 * @param providerType - Which provider to use ('in-process' or 'http-mcp')
 * @param clientTools  - Tool definitions sent by the frontend with the chat
 *   request. Replaces the old pre-registration mechanism.
 * @param providerContext - Additional context for the provider (workspace, URL)
 */
export async function integrateFrontendTools(
  queryOptions: any,
  sessionId: string,
  agentId: string,
  clientTools?: FrontendToolDefinition[],
  providerType: ProviderType = 'in-process',
  providerContext?: ProviderContext,
): Promise<FrontendToolsIntegration> {
  const dynamicTools = clientTools || [];

  if (dynamicTools.length > 0) {
    console.log(
      `[FrontendTools] Integrating ${dynamicTools.length} dynamic tool(s) for agent ${agentId} via ${providerType}:`,
      dynamicTools.map(t => t.name),
    );
  }

  const provider = getFrontendToolProvider(providerType);

  try {
    const result = await provider.setup(sessionId, agentId, dynamicTools, providerContext);

    // Merge MCP servers into queryOptions (only relevant for in-process provider)
    if (Object.keys(result.mcpServers).length > 0) {
      if (!queryOptions.mcpServers) queryOptions.mcpServers = {};
      Object.assign(queryOptions.mcpServers, result.mcpServers);
    }

    // Merge allowed tools
    if (result.allowedTools.length > 0) {
      if (!queryOptions.allowedTools) queryOptions.allowedTools = [];
      for (const tool of result.allowedTools) {
        if (!queryOptions.allowedTools.includes(tool)) {
          queryOptions.allowedTools.push(tool);
        }
      }
    }

    return { queryOptions, sessionRef: result.sessionRef };
  } catch (error) {
    console.error('[FrontendTools] Failed to integrate MCP servers:', error);
    return { queryOptions, sessionRef: null };
  }
}
