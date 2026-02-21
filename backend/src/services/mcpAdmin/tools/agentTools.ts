/**
 * Agent Management Tools
 *
 * MCP tools for managing AI agents in AgentStudio.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { AgentStorage } from '../../agentStorage.js';

const agentStorage = new AgentStorage();

/**
 * List all agents
 */
export const listAgentsTool: ToolDefinition = {
  tool: {
    name: 'list_agents',
    description: 'List all registered agents in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {
        includeDisabled: {
          type: 'boolean',
          description: 'Include disabled agents (default: false)',
        },
        source: {
          type: 'string',
          description: 'Filter by source: "local", "plugin", or "all" (default: all)',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const includeDisabled = (params.includeDisabled as boolean) ?? false;
      const source = (params.source as string) || 'all';

      let agents = agentStorage.getAllAgents();

      // Filter by enabled status
      if (!includeDisabled) {
        agents = agents.filter((a) => a.enabled !== false);
      }

      // Filter by source
      if (source !== 'all') {
        agents = agents.filter((a) => a.source === source);
      }

      const agentList = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        enabled: a.enabled !== false,
        source: a.source,
        version: a.version,
        // Note: model field removed - model is now determined by project/provider configuration
        tags: a.tags,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                agents: agentList,
                total: agentList.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing agents: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:read'],
};

/**
 * Get agent details
 */
export const getAgentTool: ToolDefinition = {
  tool: {
    name: 'get_agent',
    description: 'Get detailed information about a specific agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID',
        },
      },
      required: ['agentId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const agentId = params.agentId as string;

      if (!agentId) {
        return {
          content: [{ type: 'text', text: 'Agent ID is required' }],
          isError: true,
        };
      }

      const agent = agentStorage.getAgent(agentId);

      if (!agent) {
        return {
          content: [{ type: 'text', text: `Agent not found: ${agentId}` }],
          isError: true,
        };
      }

      // Return full agent config (excluding sensitive data)
      // Note: model field removed - model is now determined by project/provider configuration
      const agentInfo = {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        enabled: agent.enabled !== false,
        source: agent.source,
        version: agent.version,
        maxTurns: agent.maxTurns,
        permissionMode: agent.permissionMode,
        tags: agent.tags,
        author: agent.author,
        allowedTools: agent.allowedTools?.map((t) => ({
          name: t.name,
          enabled: t.enabled,
        })),
        ui: agent.ui,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(agentInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting agent: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:read'],
};

/**
 * Update agent settings
 */
export const updateAgentTool: ToolDefinition = {
  tool: {
    name: 'update_agent',
    description: 'Update agent settings (enabled status, maxTurns, etc.). Note: model is determined by project/provider config, not agent config.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the agent',
        },
        maxTurns: {
          type: 'number',
          description: 'Maximum conversation turns',
        },
        description: {
          type: 'string',
          description: 'Agent description',
        },
      },
      required: ['agentId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const agentId = params.agentId as string;

      if (!agentId) {
        return {
          content: [{ type: 'text', text: 'Agent ID is required' }],
          isError: true,
        };
      }

      const agent = agentStorage.getAgent(agentId);

      if (!agent) {
        return {
          content: [{ type: 'text', text: `Agent not found: ${agentId}` }],
          isError: true,
        };
      }

      // Build update object
      // Note: model field removed - model is now determined by project/provider configuration
      const updates: Record<string, unknown> = {};

      if (params.enabled !== undefined) {
        updates.enabled = params.enabled;
      }
      if (params.maxTurns !== undefined) {
        updates.maxTurns = params.maxTurns;
      }
      if (params.description !== undefined) {
        updates.description = params.description;
      }

      // Update the agent
      const updatedAgent = {
        ...agent,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      agentStorage.saveAgent(updatedAgent);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                agent: {
                  id: updatedAgent.id,
                  name: updatedAgent.name,
                  enabled: updatedAgent.enabled,
                  updatedAt: updatedAgent.updatedAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating agent: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:write'],
};

/**
 * Toggle agent tool
 */
export const toggleAgentToolTool: ToolDefinition = {
  tool: {
    name: 'toggle_agent_tool',
    description: 'Enable or disable a specific tool for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID',
        },
        toolName: {
          type: 'string',
          description: 'Name of the tool to toggle',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the tool',
        },
      },
      required: ['agentId', 'toolName', 'enabled'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const agentId = params.agentId as string;
      const toolName = params.toolName as string;
      const enabled = params.enabled as boolean;

      if (!agentId || !toolName || enabled === undefined) {
        return {
          content: [{ type: 'text', text: 'agentId, toolName, and enabled are required' }],
          isError: true,
        };
      }

      const agent = agentStorage.getAgent(agentId);

      if (!agent) {
        return {
          content: [{ type: 'text', text: `Agent not found: ${agentId}` }],
          isError: true,
        };
      }

      // Find and update the tool
      const tool = agent.allowedTools?.find((t) => t.name === toolName);

      if (!tool) {
        return {
          content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
          isError: true,
        };
      }

      tool.enabled = enabled;
      agent.updatedAt = new Date().toISOString();

      agentStorage.saveAgent(agent);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                tool: {
                  name: toolName,
                  enabled,
                },
                agent: {
                  id: agent.id,
                  updatedAt: agent.updatedAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error toggling tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:write'],
};

/**
 * Create a new agent
 */
export const createAgentTool: ToolDefinition = {
  tool: {
    name: 'create_agent',
    description: 'Create a new agent in AgentStudio with the specified configuration',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique agent ID (lowercase, numbers, hyphens, underscores)',
        },
        name: {
          type: 'string',
          description: 'Display name for the agent',
        },
        description: {
          type: 'string',
          description: 'Agent description',
        },
        systemPrompt: {
          type: 'string',
          description: 'System prompt for the agent',
        },
        maxTurns: {
          type: 'number',
          description: 'Maximum conversation turns (1-100, or omit for unlimited)',
        },
        permissionMode: {
          type: 'string',
          description: 'Permission mode: "default", "acceptEdits", "bypassPermissions", or "plan"',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        icon: {
          type: 'string',
          description: 'Icon emoji for the agent UI',
        },
        welcomeMessage: {
          type: 'string',
          description: 'Welcome message shown when user opens the agent',
        },
      },
      required: ['id', 'name', 'description', 'systemPrompt'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const id = params.id as string;
      const name = params.name as string;
      const description = params.description as string;
      const systemPrompt = params.systemPrompt as string;

      if (!id || !name || !description || !systemPrompt) {
        return {
          content: [{ type: 'text', text: 'id, name, description, and systemPrompt are required' }],
          isError: true,
        };
      }

      // Check if agent already exists
      const existing = agentStorage.getAgent(id);
      if (existing) {
        return {
          content: [{ type: 'text', text: `Agent already exists: ${id}` }],
          isError: true,
        };
      }

      const agentConfig = {
        id,
        name,
        description,
        version: '1.0.0',
        systemPrompt,
        maxTurns: (params.maxTurns as number) || undefined,
        permissionMode: (params.permissionMode as string) || 'acceptEdits',
        allowedTools: [],
        ui: {
          icon: (params.icon as string) || '🤖',
          headerTitle: name,
          headerDescription: description,
        },
        welcomeMessage: (params.welcomeMessage as string) || undefined,
        enabled: true,
        source: 'local' as const,
        tags: (params.tags as string[]) || [],
        author: 'Meta Agent',
      };

      const created = agentStorage.createAgent(agentConfig as any);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                agent: {
                  id: created.id,
                  name: created.name,
                  description: created.description,
                  createdAt: created.createdAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:write'],
};

/**
 * Delete an agent
 */
export const deleteAgentTool: ToolDefinition = {
  tool: {
    name: 'delete_agent',
    description: 'Delete an agent (built-in agents will be disabled instead of deleted)',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID to delete',
        },
      },
      required: ['agentId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const agentId = params.agentId as string;

      if (!agentId) {
        return {
          content: [{ type: 'text', text: 'Agent ID is required' }],
          isError: true,
        };
      }

      const agent = agentStorage.getAgent(agentId);
      if (!agent) {
        return {
          content: [{ type: 'text', text: `Agent not found: ${agentId}` }],
          isError: true,
        };
      }

      const result = agentStorage.deleteAgent(agentId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result,
                agentId,
                message: result ? 'Agent deleted successfully' : 'Failed to delete agent',
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting agent: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:write'],
};

/**
 * Preview agent configuration without creating
 */
export const previewAgentTool: ToolDefinition = {
  tool: {
    name: 'preview_agent',
    description: 'Preview an agent configuration without actually creating it. Returns the full rendered configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Proposed agent ID',
        },
        name: {
          type: 'string',
          description: 'Display name',
        },
        description: {
          type: 'string',
          description: 'Agent description',
        },
        systemPrompt: {
          type: 'string',
          description: 'System prompt',
        },
        maxTurns: {
          type: 'number',
          description: 'Maximum conversation turns',
        },
        permissionMode: {
          type: 'string',
          description: 'Permission mode',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags',
        },
      },
      required: ['id', 'name', 'systemPrompt'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const id = params.id as string;
      const name = params.name as string;

      // Check if ID would conflict
      const existing = agentStorage.getAgent(id);
      const conflicts = existing ? `⚠️ Agent with ID "${id}" already exists and would be overwritten` : null;

      const preview = {
        id,
        name,
        description: (params.description as string) || '',
        version: '1.0.0',
        systemPrompt: params.systemPrompt as string,
        systemPromptPreview: (params.systemPrompt as string).substring(0, 200) + ((params.systemPrompt as string).length > 200 ? '...' : ''),
        maxTurns: (params.maxTurns as number) || 'unlimited',
        permissionMode: (params.permissionMode as string) || 'acceptEdits',
        tags: (params.tags as string[]) || [],
        ui: {
          icon: '🤖',
          headerTitle: name,
          headerDescription: (params.description as string) || '',
        },
        warnings: conflicts ? [conflicts] : [],
        note: 'This is a preview only. Call create_agent to actually create the agent.',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(preview, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error previewing agent: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:read'],
};

/**
 * Get chat URL for testing an agent
 */
export const getAgentChatUrlTool: ToolDefinition = {
  tool: {
    name: 'get_agent_chat_url',
    description: 'Get the chat URL for a specific agent. Use this after creating an agent to give the user a link to start testing it.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID',
        },
        projectPath: {
          type: 'string',
          description: 'Optional project path to open with the agent',
        },
      },
      required: ['agentId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const agentId = params.agentId as string;
      const projectPath = params.projectPath as string | undefined;

      const agents = agentStorage.getAllAgents();
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        return {
          content: [{ type: 'text', text: `Agent "${agentId}" not found` }],
          isError: true,
        };
      }

      let url = `/chat/${agentId}`;
      if (projectPath) {
        url += `?project=${encodeURIComponent(projectPath)}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                agentId,
                agentName: agent.name,
                chatUrl: url,
                fullUrl: `http://localhost:4201${url}`,
                message: `Open this URL to start chatting with "${agent.name}": ${url}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting agent chat URL: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['agents:read'],
};

/**
 * All agent tools
 */
export const agentTools: ToolDefinition[] = [
  listAgentsTool,
  getAgentTool,
  updateAgentTool,
  toggleAgentToolTool,
  createAgentTool,
  deleteAgentTool,
  previewAgentTool,
  getAgentChatUrlTool,
];
