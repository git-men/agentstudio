/**
 * Frontend Tools Integration Helper
 *
 * Integrates built-in frontend tool MCP servers into Claude query options.
 */

import {
  createFrontendToolMcpServer,
  getMcpToolName,
  registerServerName,
  type SessionRef,
} from './frontendToolMcp.js';
import { BUILTIN_FRONTEND_TOOLS } from './builtinTools.js';
import { getDynamicTools } from './dynamicToolRegistry.js';
import type { FrontendToolDefinition } from './types.js';

export type { SessionRef };

export interface FrontendToolsIntegration {
  queryOptions: any;
  sessionRef: SessionRef | null;
}

/**
 * Integrate all frontend tools (built-in + dynamically registered) as MCP
 * servers into query options.
 *
 * The `extraTools` parameter is kept for backward compatibility but the
 * preferred path for runtime registration is `registerDynamicTools()` +
 * `POST /agents/register-frontend-tools`.
 */
export async function integrateFrontendTools(
  queryOptions: any,
  sessionId: string,
  agentId: string,
  extraTools?: FrontendToolDefinition[],
): Promise<FrontendToolsIntegration> {
  const sessionRef: SessionRef = { current: sessionId };
  const dynamicTools = getDynamicTools(agentId);
  const allTools = [...BUILTIN_FRONTEND_TOOLS, ...dynamicTools, ...(extraTools || [])];

  if (dynamicTools.length > 0) {
    console.log(`[FrontendTools] Integrating ${dynamicTools.length} dynamic tool(s) for agent ${agentId}:`, dynamicTools.map(t => t.name));
  }

  try {
    for (const toolDef of allTools) {
      const { server, serverName } = await createFrontendToolMcpServer(toolDef, sessionRef, agentId);

      if (server) {
        registerServerName(serverName);

        queryOptions.mcpServers = {
          ...queryOptions.mcpServers,
          [serverName]: server,
        };

        const mcpName = getMcpToolName(toolDef);
        if (!queryOptions.allowedTools) {
          queryOptions.allowedTools = [mcpName];
        } else if (!queryOptions.allowedTools.includes(mcpName)) {
          queryOptions.allowedTools.push(mcpName);
        }
      }
    }
  } catch (error) {
    console.error('[FrontendTools] Failed to integrate MCP servers:', error);
    // Still return sessionRef so already-registered tools get session updates
    return { queryOptions, sessionRef };
  }

  return { queryOptions, sessionRef };
}
