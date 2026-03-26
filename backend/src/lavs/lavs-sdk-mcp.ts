/**
 * LAVS SDK MCP Server
 *
 * Creates an in-process MCP server that exposes LAVS endpoints as Claude SDK tools.
 * This allows AI agents to call LAVS operations directly.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { LAVSToolGenerator } from 'lavs-runtime';
import type { GeneratedTool } from 'lavs-runtime';
import path from 'path';
import fs from 'fs';
import { AGENTS_DIR } from '../config/paths.js';

/**
 * Get agent directory path
 */
function getAgentDirectory(agentId: string): string {
  const cwd = process.cwd();

  // Check project agents directory (one level up from backend if cwd is backend/)
  let projectAgentDir = path.join(cwd, 'agents', agentId);

  // If cwd ends with 'backend', check parent directory
  if (cwd.endsWith('backend')) {
    projectAgentDir = path.join(cwd, '..', 'agents', agentId);
  }

  if (fs.existsSync(projectAgentDir)) {
    return path.resolve(projectAgentDir);
  }

  // Check global agents directory
  const globalAgentDir = path.join(AGENTS_DIR, agentId);
  if (fs.existsSync(globalAgentDir)) {
    return globalAgentDir;
  }

  // Default to project directory even if it doesn't exist yet
  return path.resolve(projectAgentDir);
}

/**
 * Resolve $ref references in a JSON Schema object.
 * Handles references like "#/types/ContentEntryInput" by inlining the type definition.
 */
function resolveSchemaRefs(schema: any, types: Record<string, any>): any {
  if (!schema || typeof schema !== 'object') return schema;

  if (schema.$ref && typeof schema.$ref === 'string') {
    const match = schema.$ref.match(/^#\/types\/(.+)$/);
    if (match && types[match[1]]) {
      return resolveSchemaRefs({ ...types[match[1]] }, types);
    }
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveSchemaRefs(item, types));
  }

  const resolved: any = {};
  for (const [key, value] of Object.entries(schema)) {
    resolved[key] = resolveSchemaRefs(value, types);
  }
  return resolved;
}

/**
 * Convert a single JSON Schema property to a Zod type
 */
function jsonSchemaPropertyToZod(propSchema: any): z.ZodTypeAny {
  switch (propSchema.type) {
    case 'string':
      if (propSchema.enum) {
        return z.enum(propSchema.enum as [string, ...string[]]);
      }
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const itemSchema = propSchema.items;
      if (itemSchema && itemSchema.type === 'object' && itemSchema.properties) {
        return z.array(z.object(jsonSchemaToZodShape(itemSchema)).passthrough());
      } else if (itemSchema?.type) {
        return z.array(jsonSchemaPropertyToZod(itemSchema));
      }
      return z.array(z.any());
    }
    case 'object':
      if (propSchema.additionalProperties || !propSchema.properties) {
        return z.record(z.string(), z.any());
      }
      return z.object(jsonSchemaToZodShape(propSchema)).passthrough();
    default:
      return z.any();
  }
}

/**
 * Convert JSON Schema to Zod shape.
 * Expects $ref references to already be resolved via resolveSchemaRefs.
 */
function jsonSchemaToZodShape(schema: any): z.ZodRawShape {
  if (!schema || !schema.properties) {
    return {};
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    const propSchema = prop as any;
    let zodType = jsonSchemaPropertyToZod(propSchema);

    if (propSchema.description) {
      zodType = zodType.describe(propSchema.description);
    }

    const isRequired = schema.required && schema.required.includes(key);
    if (!isRequired) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return shape;
}

/**
 * Create SDK MCP server for LAVS tools
 *
 * Generates tools from agent's lavs.json and creates an in-process MCP server.
 *
 * @param agentId - Agent identifier
 * @param projectPath - Optional project path for data isolation
 * @returns SDK MCP server instance or null if agent has no LAVS
 */
export async function createLAVSSdkMcpServer(agentId: string, projectPath?: string) {
  try {
    const agentDir = getAgentDirectory(agentId);
    const generator = new LAVSToolGenerator();

    // Check if agent has LAVS
    const hasLAVS = await generator.hasLAVS(agentDir);
    if (!hasLAVS) {
      console.log(`[LAVS SDK MCP] Agent ${agentId} has no LAVS configuration`);
      return null;
    }

    // Generate tools (with projectPath for data isolation)
    const generatedTools = await generator.generateTools(agentId, agentDir, projectPath);
    if (generatedTools.length === 0) {
      console.log(`[LAVS SDK MCP] No LAVS tools generated for agent ${agentId}`);
      return null;
    }

    if (projectPath) {
      console.log(`[LAVS SDK MCP] Project path for data isolation: ${projectPath}`);
    }

    console.log(`[LAVS SDK MCP] Generating ${generatedTools.length} LAVS tools for agent ${agentId}`);

    // Load manifest types for $ref resolution
    let manifestTypes: Record<string, any> = {};
    try {
      const lavsPath = path.join(agentDir, 'lavs.json');
      const manifest = JSON.parse(fs.readFileSync(lavsPath, 'utf-8'));
      manifestTypes = manifest.types || {};
    } catch {
      // Continue without types - $ref won't be resolved but basic schemas still work
    }

    // Convert generated tools to SDK tools
    const sdkTools = generatedTools.map((genTool: GeneratedTool) => {
      const { tool: toolDef, execute } = genTool;

      // Resolve $ref references before converting to Zod
      const resolvedSchema = Object.keys(manifestTypes).length > 0
        ? resolveSchemaRefs(toolDef.input_schema, manifestTypes)
        : toolDef.input_schema;

      const zodShape = jsonSchemaToZodShape(resolvedSchema);

      // Create SDK tool
      return tool(
        toolDef.name,
        toolDef.description,
        zodShape,
        async (args: any) => {
          try {
            console.log(`[LAVS SDK MCP] Executing ${toolDef.name} with args:`, args);

            // Execute the LAVS endpoint
            const result = await execute(args);

            // Format response
            return {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (error: any) {
            console.error(`[LAVS SDK MCP] Error executing ${toolDef.name}:`, error);

            return {
              content: [
                {
                  type: 'text',
                  text: `Error executing LAVS endpoint: ${error.message || String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
      );
    });

    // Create SDK MCP server
    const server = createSdkMcpServer({
      name: `lavs-${agentId}`,
      version: '1.0.0',
      tools: sdkTools,
    });

    console.log(`[LAVS SDK MCP] Created MCP server for agent ${agentId} with ${sdkTools.length} tools`);

    return {
      server,
      tools: sdkTools,
      toolNames: generatedTools.map((t) => t.tool.name),
    };
  } catch (error: any) {
    console.error(`[LAVS SDK MCP] Failed to create server for agent ${agentId}:`, error);
    return null;
  }
}

/**
 * Get LAVS tool names for an agent
 * Tool names are prefixed with "mcp__{server_name}__"
 *
 * @param agentId - Agent identifier
 * @returns Array of full tool names
 */
export function getLAVSToolNames(agentId: string, toolNames: string[]): string[] {
  return toolNames.map((name) => `mcp__lavs-${agentId}__${name}`);
}
