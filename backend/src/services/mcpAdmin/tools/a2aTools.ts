/**
 * A2A Management Tools
 *
 * MCP tools for managing A2A (Agent-to-Agent) integration in AgentStudio.
 * Used by meta-agent to automate WeCom/IM integration setup.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { getOrCreateA2AId } from '../../a2a/agentMappingService.js';
import { generateApiKey, listApiKeysWithDecryption } from '../../a2a/apiKeyService.js';
import { loadA2AConfig, saveA2AConfig } from '../../a2a/a2aConfigService.js';
import { generateAgentCard, type ProjectContext } from '../../a2a/agentCardService.js';
import { AgentStorage } from '../../agentStorage.js';
import { DEFAULT_A2A_CONFIG } from '../../../types/a2a.js';
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

      const allStatuses = tunnelService.getAllStatuses();
      const allConfigs = tunnelService.getAllConfigs();
      const tunnelStatus = allStatuses[0] ?? { connected: false, domain: null };
      const tunnelConfig = allConfigs[0] ?? { protocol: 'https', domainSuffix: '', serverUrl: '', tunnelName: '' };

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
  requiredPermissions: ['system:read'],
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
  requiredPermissions: ['system:write'],
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
  requiredPermissions: ['system:read'],
};

/**
 * Allow a project's agent to call another project's agent via A2A.
 *
 * Automates the full flow: resolve target agent card → generate API key
 * in the target project → add to caller's allowed agents list.
 */
export const allowA2ACallTool: ToolDefinition = {
  tool: {
    name: 'allow_a2a_call',
    description:
      "Allow this project's agent to call another project's agent via A2A protocol. " +
      'Automatically generates an API key in the target project and adds it to the ' +
      "caller's allowed agents list. After this, call_external_agent can reach the target.",
    inputSchema: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the calling project (the one that wants to make A2A calls)',
        },
        target_project_path: {
          type: 'string',
          description: 'Absolute path to the target project (the one to be called)',
        },
      },
      required: ['project_path', 'target_project_path'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const projectPath = params.project_path as string;
      const targetProjectPath = params.target_project_path as string;

      const callerName = projectPath.split('/').pop() || projectPath;
      const targetName = targetProjectPath.split('/').pop() || targetProjectPath;

      // Build target project's agent card
      const targetProjectId = `proj_${Buffer.from(targetProjectPath)
        .toString('base64')
        .replace(/[+/=]/g, '')
        .slice(-12)}`;
      const agentType = 'claude-code';
      const a2aAgentId = await getOrCreateA2AId(targetProjectId, agentType, targetProjectPath);

      // Resolve base URL (tunnel or local)
      const port = parseInt(process.env.PORT || '4936', 10);
      const allStatuses = tunnelService.getAllStatuses();
      const allConfigs = tunnelService.getAllConfigs();
      const tunnelStatus = allStatuses[0] ?? { connected: false, domain: null };
      const tunnelConfig = allConfigs[0] ?? { protocol: 'https', domainSuffix: '', serverUrl: '', tunnelName: '' };

      let baseUrl: string;
      if (tunnelStatus.connected && tunnelStatus.domain) {
        const protocol = tunnelConfig.protocol || 'https';
        const fullDomain = tunnelConfig.domainSuffix
          ? `${tunnelStatus.domain}${tunnelConfig.domainSuffix}`
          : tunnelStatus.domain;
        baseUrl = `${protocol}://${fullDomain}`;
      } else {
        const networkInfo = getNetworkInfo();
        const ip = networkInfo.bestLocalIP || 'localhost';
        baseUrl = `http://${ip}:${port}`;
      }

      const agentStorage = new AgentStorage();
      const agentConfig = agentStorage.getAgent(agentType);
      if (!agentConfig) {
        return {
          content: [{ type: 'text', text: `Error: Agent type '${agentType}' not found` }],
          isError: true,
        };
      }

      const projectContext: ProjectContext = {
        projectId: targetProjectId,
        projectName: targetName,
        workingDirectory: targetProjectPath,
        a2aAgentId,
        baseUrl,
      };
      const agentCard = generateAgentCard(agentConfig, projectContext);

      // Load caller's A2A config
      let config = await loadA2AConfig(projectPath);
      if (config === null) {
        config = { ...DEFAULT_A2A_CONFIG };
      }

      // Check for duplicate
      const existing = config.allowedAgents.find((agent) => agent.url === agentCard.url);
      if (existing) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'already_exists',
                  name: existing.name,
                  url: existing.url,
                  enabled: existing.enabled,
                  message: `Target agent '${targetName}' is already in the allowed list.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // Generate API key in the target project for the caller to use
      const { key } = await generateApiKey(targetProjectPath, `A2A access from ${callerName}`);

      // Add to allowed list
      config.allowedAgents.push({
        name: targetName,
        url: agentCard.url,
        apiKey: key,
        description: agentCard.description || '',
        enabled: true,
      });

      await saveA2AConfig(projectPath, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'success',
                name: targetName,
                url: agentCard.url,
                enabled: true,
                message: `Agent '${callerName}' can now call '${targetName}' via A2A. Use call_external_agent with the URL above.`,
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
            text: `Error allowing A2A call: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * All A2A tools
 */
export const a2aTools: ToolDefinition[] = [
  getA2AEndpointTool,
  createA2AApiKeyTool,
  listA2AApiKeysTool,
  allowA2ACallTool,
];
