/**
 * A2UI Integration
 * 
 * Integrates the A2UI MCP server into Claude SDK query options,
 * providing agents with the `render_ui` tool.
 */

import { createA2UIMcpServer } from './a2uiMcpServer.js';

const A2UI_TOOL_NAME = 'mcp__a2ui-renderer__render_ui';

/**
 * Get the A2UI tool name (as it appears in allowedTools)
 */
export function getA2UIToolName(): string {
  return A2UI_TOOL_NAME;
}

/**
 * Integrate A2UI MCP server into query options
 * 
 * @param queryOptions - The query options object to modify
 * @returns The modified query options
 */
export async function integrateA2UIMcpServer(queryOptions: any) {
  try {
    const a2uiServer = createA2UIMcpServer();

    // Add to mcpServers
    queryOptions.mcpServers = {
      ...queryOptions.mcpServers,
      'a2ui-renderer': a2uiServer,
    };

    // Add tool to allowedTools
    if (!queryOptions.allowedTools) {
      queryOptions.allowedTools = [A2UI_TOOL_NAME];
    } else {
      if (!queryOptions.allowedTools.includes(A2UI_TOOL_NAME)) {
        queryOptions.allowedTools.push(A2UI_TOOL_NAME);
      }
    }

    console.log('✅ [A2UI] MCP server integrated successfully');
  } catch (error) {
    console.error('❌ [A2UI] Failed to integrate MCP server:', error);
  }

  return queryOptions;
}
