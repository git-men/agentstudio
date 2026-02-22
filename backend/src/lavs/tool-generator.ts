/**
 * LAVS Tool Generator
 *
 * Automatically generates Claude SDK tool definitions from LAVS manifests.
 * This allows AI agents to call LAVS endpoints as tools.
 */

import { LAVSManifest, Endpoint } from '../lavs/types.js';
import { ManifestLoader } from '../lavs/loader.js';
import { ScriptExecutor } from '../lavs/script-executor.js';
import { FunctionExecutor } from '../lavs/function-executor.js';
import { LAVSValidator } from '../lavs/validator.js';
import { PermissionChecker } from '../lavs/permission-checker.js';
import { ScriptHandler, FunctionHandler, ExecutionContext } from '../lavs/types.js';
import path from 'path';

/**
 * Claude SDK tool definition
 */
export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool execution function
 */
export type ToolExecutor = (params: any) => Promise<any>;

/**
 * Generated tool with executor
 */
export interface GeneratedTool {
  tool: ClaudeTool;
  execute: ToolExecutor;
}

/**
 * Generate tools from LAVS manifest
 */
export class LAVSToolGenerator {
  /**
   * Generate tools for an agent
   * @param agentId - Agent ID
   * @param agentDir - Agent directory path
   * @param projectPath - Optional project path for data isolation
   * @returns Array of generated tools
   */
  async generateTools(
    agentId: string,
    agentDir: string,
    projectPath?: string
  ): Promise<GeneratedTool[]> {
    try {
      // Load manifest
      const lavsPath = path.join(agentDir, 'lavs.json');
      const loader = new ManifestLoader();
      const manifest = await loader.load(lavsPath);

      // Generate tool for each endpoint
      const tools: GeneratedTool[] = [];

      for (const endpoint of manifest.endpoints) {
        // Only generate tools for query and mutation endpoints
        // Subscriptions don't make sense as tools
        if (endpoint.method === 'subscription') {
          continue;
        }

        const tool = this.generateToolForEndpoint(endpoint, manifest, agentId, agentDir, projectPath);
        tools.push(tool);
      }

      console.log(`[LAVS] Generated ${tools.length} tools for agent ${agentId}`);
      return tools;
    } catch (error: unknown) {
      // If no lavs.json, that's OK - just return empty array
      const message = error instanceof Error ? error.message : '';
      if (message.includes('not found')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Generate tool definition and executor for an endpoint
   */
  private generateToolForEndpoint(
    endpoint: Endpoint,
    manifest: LAVSManifest,
    agentId: string,
    agentDir: string,
    projectPath?: string
  ): GeneratedTool {
    // Generate tool name (prefix with lavs_ to avoid conflicts)
    const toolName = `lavs_${endpoint.id}`;

    // Generate tool description
    const description = endpoint.description || `Call ${endpoint.id} endpoint from ${manifest.name}`;

    // Generate input schema from endpoint schema
    const inputSchema = endpoint.schema?.input || {
      type: 'object',
      properties: {},
    };

    // Ensure it's an object schema
    if (inputSchema.type !== 'object') {
      throw new Error(`Endpoint ${endpoint.id} must have object input schema`);
    }

    const tool: ClaudeTool = {
      name: toolName,
      description,
      input_schema: {
        type: 'object',
        properties: inputSchema.properties || {},
        required: inputSchema.required || [],
      },
    };

    // Create shared instances for validation and permission checking
    const validator = new LAVSValidator();
    const permChecker = new PermissionChecker();

    // Create executor function
    const execute: ToolExecutor = async (params: any) => {
      console.log(`[LAVS] Executing tool ${toolName} with params:`, params);

      // 1. Validate input against schema
      validator.assertValidInput(endpoint, params);

      // 2. Merge permissions
      const mergedPermissions = permChecker.mergePermissions(
        manifest.permissions,
        endpoint.permissions
      );

      // 3. Check permissions for script handlers
      if (endpoint.handler.type === 'script') {
        permChecker.assertAllowed(
          endpoint.handler as ScriptHandler,
          mergedPermissions,
          agentDir
        );
      }

      // 4. Build execution context
      const context: ExecutionContext = {
        endpointId: endpoint.id,
        agentId,
        workdir: agentDir,
        permissions: mergedPermissions,
        env: projectPath ? {
          LAVS_PROJECT_PATH: projectPath,
        } : undefined,
      };

      // 5. Execute the handler
      let result: unknown;
      switch (endpoint.handler.type) {
        case 'script': {
          const executor = new ScriptExecutor();
          result = await executor.execute(
            endpoint.handler as ScriptHandler,
            params,
            context
          );
          break;
        }
        case 'function': {
          const funcExecutor = new FunctionExecutor();
          result = await funcExecutor.execute(
            endpoint.handler as FunctionHandler,
            params,
            context
          );
          break;
        }
        default:
          throw new Error(`Handler type '${endpoint.handler.type}' is not yet supported in tool generation`);
      }

      // 5. Validate output against schema
      validator.assertValidOutput(endpoint, result);

      return result;
    };

    return { tool, execute };
  }

  /**
   * Check if agent has LAVS
   */
  async hasLAVS(agentDir: string): Promise<boolean> {
    try {
      const lavsPath = path.join(agentDir, 'lavs.json');
      const loader = new ManifestLoader();
      await loader.load(lavsPath);
      return true;
    } catch {
      return false;
    }
  }
}
