/**
 * Frontend Tool MCP Server Factory
 *
 * Creates in-process MCP servers that wrap frontend tool definitions.
 * When the agent calls one of these tools, the handler blocks (via the
 * FrontendToolBridge) until the frontend submits a result.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { frontendToolBridge } from './frontendToolBridge.js';
import type { FrontendToolDefinition } from './types.js';

/**
 * Session reference that can be updated when the real session ID arrives.
 */
export interface SessionRef {
  current: string;
}

/**
 * Convert a JSON-Schema-style parameters object to a Zod object schema.
 * Supports a subset sufficient for frontend tool parameter definitions:
 * string, number, boolean, array, object, enum.
 */
function jsonSchemaToZod(params: FrontendToolDefinition['parameters']): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(params.required || []);

  for (const [key, rawDef] of Object.entries(params.properties)) {
    const def = rawDef as Record<string, unknown>;
    let field: z.ZodTypeAny;

    switch (def.type) {
      case 'string':
        field = def.enum
          ? z.enum(def.enum as [string, ...string[]])
          : z.string();
        break;
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.any());
        break;
      case 'object':
        field = z.record(z.string(), z.any());
        break;
      default:
        field = z.any();
    }

    if (def.description) field = field.describe(def.description as string);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Create an SDK MCP server for a single frontend tool definition.
 */
export async function createFrontendToolMcpServer(
  toolDef: FrontendToolDefinition,
  sessionRef: SessionRef,
  agentId: string,
) {
  const zodSchema = jsonSchemaToZod(toolDef.parameters);

  const mcpTool = tool(
    toolDef.name,
    toolDef.description,
    (zodSchema as z.ZodObject<any>).shape,
    async (args: Record<string, unknown>, context: unknown) => {
      const toolCallId =
        (context as any)?.toolUseId ||
        `ft_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      const currentSessionId = sessionRef.current;

      try {
        const result = await frontendToolBridge.waitForResult(
          toolCallId,
          toolDef.name,
          currentSessionId,
          agentId,
          args as Record<string, unknown>,
        );

        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Frontend tool error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  const serverName = resolveServerName(toolDef);

  const server = createSdkMcpServer({
    name: serverName,
    version: '1.0.0',
    tools: [mcpTool],
  });

  return { server, tool: mcpTool, sessionRef, serverName };
}

/**
 * Resolve the MCP server name for a tool definition.
 * Uses `mcpServerName` when explicitly set (for built-in tools that need
 * a stable identity), otherwise falls back to `frontend-tool-${name}`.
 */
export function resolveServerName(toolDef: FrontendToolDefinition): string {
  return toolDef.mcpServerName || `frontend-tool-${toolDef.name}`;
}

/**
 * Return the full MCP tool name as it appears to Claude.
 */
export function getMcpToolName(toolDef: FrontendToolDefinition): string {
  const serverName = resolveServerName(toolDef);
  return `mcp__${serverName}__${toolDef.name}`;
}

/**
 * Set of MCP server names registered through the frontend tool framework.
 * Used by `isFrontendTool` to recognize tools with custom server names.
 */
const registeredServerNames = new Set<string>();

export function registerServerName(name: string): void {
  registeredServerNames.add(name);
}

/**
 * Check if a tool name belongs to the frontend tool framework.
 * Matches both the default `frontend-tool-` prefix and any explicitly
 * registered server names (e.g. 'ask-user-question').
 */
export function isFrontendTool(toolName: string): boolean {
  if (toolName.startsWith('mcp__frontend-tool-')) return true;
  for (const serverName of registeredServerNames) {
    if (toolName.startsWith(`mcp__${serverName}__`)) return true;
  }
  return false;
}
