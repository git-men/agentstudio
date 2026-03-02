/**
 * A2A Management Tools
 *
 * MCP tools for managing A2A (Agent-to-Agent) integration in AgentStudio.
 * Used by meta-agent to automate WeCom/IM integration setup.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { getOrCreateA2AId } from '../../a2a/agentMappingService.js';
import { generateApiKey, listApiKeysWithDecryption } from '../../a2a/apiKeyService.js';
import { tunnelService } from '../../tunnelService.js';
import { getNetworkInfo } from '../../../utils/networkUtils.js';

/**
 * Get A2A endpoint info for a project.
 * Auto-detects tunnel URL if connected, falls back to local IP.
 */
export const getA2AEndpointTool: ToolDefinition = {
  tool: {
    name: 'get_a2a_endpoint',
    description:
      'Get the A2A endpoint URL and agent ID for a project. ' +
      'Auto-detects tunnel URL if connected, otherwise returns local IP URL. ' +
      'Use this before setting up IM/WeCom integration.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the project directory (e.g., /Users/me/projects/my-app)',
        },
      },
      required: ['project_path'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const projectPath = params.project_path as string;

      const projectId = `proj_${Buffer.from(projectPath)
        .toString('base64')
        .replace(/[+/=]/g, '')
        .slice(-12)}`;
      const agentType = 'claude-code';
      const a2aAgentId = await getOrCreateA2AId(projectId, agentType, projectPath);

      const port = parseInt(process.env.PORT || '4936', 10);

      const tunnelStatus = tunnelService.getStatus();
      const tunnelConfig = tunnelService.getConfig();

      let baseUrl: string;
      let accessMode: string;

      if (tunnelStatus.connected && tunnelStatus.domain) {
        const protocol = tunnelConfig.protocol || 'https';
        const fullDomain = tunnelConfig.domainSuffix
          ? `${tunnelStatus.domain}${tunnelConfig.domainSuffix}`
          : tunnelStatus.domain;
        baseUrl = `${protocol}://${fullDomain}`;
        accessMode = 'tunnel';
      } else {
        const networkInfo = getNetworkInfo();
        const ip = networkInfo.bestLocalIP || 'localhost';
        baseUrl = `http://${ip}:${port}`;
        accessMode = 'local';
      }

      const a2aEndpoint = `${baseUrl}/a2a/${a2aAgentId}/messages`;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                a2aAgentId,
                a2aEndpoint,
                baseUrl,
                port,
                accessMode,
                tunnelConnected: tunnelStatus.connected,
                tunnelDomain: tunnelStatus.domain || null,
                projectPath,
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
            text: `Error getting A2A endpoint: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * Create an A2A API key for a project.
 */
export const createA2AApiKeyTool: ToolDefinition = {
  tool: {
    name: 'create_a2a_api_key',
    description:
      'Create an API key for A2A access to a project. ' +
      'Returns the plaintext key (only shown once). ' +
      'Use this to generate credentials for IM/WeCom bot integration.',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the project directory',
        },
        description: {
          type: 'string',
          description: 'Description for the API key (e.g., "企微群机器人 - 项目名")',
        },
      },
      required: ['project_path', 'description'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const projectPath = params.project_path as string;
      const description = params.description as string;

      const { key, keyData } = await generateApiKey(projectPath, description);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                key,
                id: keyData.id,
                description: keyData.description,
                createdAt: keyData.createdAt,
                projectPath,
                note: 'Save this key — it cannot be retrieved again after this response.',
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
            text: `Error creating A2A API key: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * List existing A2A API keys for a project.
 */
export const listA2AApiKeysTool: ToolDefinition = {
  tool: {
    name: 'list_a2a_api_keys',
    description: 'List existing A2A API keys for a project (with decrypted key values for display).',
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the project directory',
        },
      },
      required: ['project_path'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const projectPath = params.project_path as string;

      const apiKeys = await listApiKeysWithDecryption(projectPath);

      const keys = apiKeys.map((k) => ({
        id: k.id,
        description: k.description,
        key: k.decryptedKey || null,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        revoked: !!k.revokedAt,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ keys, total: keys.length }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing A2A API keys: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

/**
 * All A2A tools
 */
export const a2aTools: ToolDefinition[] = [
  getA2AEndpointTool,
  createA2AApiKeyTool,
  listA2AApiKeysTool,
];
