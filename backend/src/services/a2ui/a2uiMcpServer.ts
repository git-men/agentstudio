/**
 * A2UI MCP Server
 * 
 * Provides the `render_ui` tool as an in-process SDK MCP server
 * that agents can call to generate rich A2UI surfaces.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { A2UI_CATALOG_PROMPT } from './a2uiTypes.js';

/**
 * Create the render_ui tool definition
 */
function createRenderUITool() {
  return tool(
    'render_ui',
    `Generate a rich interactive UI surface using A2UI protocol components. Use this when the user's request would benefit from visual presentation like charts, tables, data cards, or forms instead of plain text.\n\n${A2UI_CATALOG_PROMPT}`,
    {
      messages: z
        .array(z.record(z.string(), z.any()))
        .min(1)
        .describe('Array of A2UI server messages (surfaceUpdate, dataModelUpdate, beginRendering)'),
      description: z
        .string()
        .optional()
        .describe('Brief description of what this UI shows (for accessibility and fallback)'),
    },
    async (params) => {
      const { messages, description } = params;

      // Validate: must have beginRendering
      const hasBeginRendering = messages.some(
        (m: any) => 'beginRendering' in m
      );
      if (!hasBeginRendering) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: messages must include a beginRendering message to signal render readiness',
            },
          ],
          isError: true,
        };
      }

      // Return the A2UI payload as a special JSON format
      // The frontend A2UIRenderTool component will detect and render it
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              __a2ui__: true,
              surfaceId: `surface-${Date.now()}`,
              messages,
              description: description || 'Rich UI content',
            }),
          },
        ],
      };
    }
  );
}

/**
 * Create an A2UI SDK MCP server
 */
export function createA2UIMcpServer() {
  const renderUITool = createRenderUITool();

  const server = createSdkMcpServer({
    name: 'a2ui-renderer',
    version: '1.0.0',
    tools: [renderUITool],
  });

  return server;
}
