/**
 * Tunnel Management Tools
 *
 * Built-in MCP tools for managing WebSocket tunnels via as-dispatch.
 * These tools wrap tunnelService so agents don't need to configure
 * a separate as-dispatch MCP server.
 *
 * Prerequisites: tunnel server URL and enterprise token must be configured
 * once via `configure_tunnel` (or the AgentStudio UI tunnel settings page).
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { tunnelService } from '../../tunnelService.js';

/**
 * Configure tunnel server connection (one-time setup)
 */
export const configureTunnelTool: ToolDefinition = {
  tool: {
    name: 'configure_tunnel',
    description:
      'Configure the tunnel server URL and enterprise token (one-time setup). ' +
      'The enterprise token is your as-enterprise JWT access token. ' +
      'After configuring, use create_tunnel to create a tunnel.',
    inputSchema: {
      type: 'object',
      properties: {
        server_url: {
          type: 'string',
          description: 'Tunnel server base URL, e.g. https://agentstudio.woa.com',
        },
        enterprise_token: {
          type: 'string',
          description: 'as-enterprise JWT access token for API authentication',
        },
      },
      required: ['server_url', 'enterprise_token'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const serverUrl = params.server_url as string;
      const enterpriseToken = params.enterprise_token as string;

      await tunnelService.saveConfig({ serverUrl, enterpriseToken });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: '隧道服务配置已保存',
              server_url: serverUrl,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error configuring tunnel: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Create a new tunnel
 */
export const createTunnelTool: ToolDefinition = {
  tool: {
    name: 'create_tunnel',
    description:
      'Create a new WebSocket tunnel via as-dispatch. ' +
      'Returns the tunnel domain and connection token. ' +
      'Requires enterprise token to be configured (via configure_tunnel or UI settings). ' +
      'The returned tunnel_token is used by the tunely client to establish the WebSocket connection.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Tunnel subdomain name, e.g. "my-agent". Must be unique across the server. ' +
            'The full domain will be <name>.<domain_suffix>.',
        },
        auto_connect: {
          type: 'boolean',
          description: 'Whether to auto-connect this tunnel on AgentStudio startup. Default: false.',
        },
      },
      required: ['name'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const autoConnect = (params.auto_connect as boolean) ?? false;

      const config = tunnelService.getConfig();
      if (!config.serverUrl) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: '未配置隧道服务器地址，请先调用 configure_tunnel 完成初始化配置',
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await tunnelService.createAndSave(
        name,
        autoConnect,
        config.protocol ?? 'https',
        config.websocketUrl,
        config.domainSuffix,
      );

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                tunnel_token: result.token,
                domain: result.domain,
                message: `隧道 ${result.domain} 创建成功`,
                next_step:
                  '使用以下命令在本地启动隧道客户端：\n' +
                  `tunely connect --server wss://<server>/ws/tunnel --token ${result.token} --target http://localhost:<port>`,
              }),
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: false, error: result.error }),
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating tunnel: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Get current tunnel status
 */
export const getTunnelStatusTool: ToolDefinition = {
  tool: {
    name: 'get_tunnel_status',
    description:
      'Get the current WebSocket tunnel connection status, including whether it is connected, ' +
      'the assigned domain, and any errors.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const status = tunnelService.getStatus();
      const config = tunnelService.getConfig();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              connected: status.connected,
              enabled: status.enabled,
              domain: status.domain,
              tunnel_name: config.tunnelName,
              server_url: config.serverUrl,
              last_error: status.lastError,
              connected_at: status.connectedAt,
              reconnect_count: status.reconnectCount,
              enterprise_token_configured: !!config.token,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting tunnel status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * Connect to the configured tunnel
 */
export const connectTunnelTool: ToolDefinition = {
  tool: {
    name: 'connect_tunnel',
    description:
      'Establish (or re-establish) the WebSocket tunnel connection using the saved configuration. ' +
      'Requires a tunnel token to have been saved previously (via create_tunnel or UI settings).',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description:
            'Force takeover an existing connection from another client. Default: false.',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const force = (params.force as boolean) ?? false;
      await tunnelService.connect(force);
      const status = tunnelService.getStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              connected: status.connected,
              domain: status.domain,
              message: status.connected
                ? `隧道已连接：${status.domain}`
                : '连接已发起，等待建立中（可再次调用 get_tunnel_status 确认）',
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error connecting tunnel: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Disconnect the current tunnel
 */
export const disconnectTunnelTool: ToolDefinition = {
  tool: {
    name: 'disconnect_tunnel',
    description: 'Disconnect the current WebSocket tunnel connection.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      tunnelService.disconnect();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, message: '隧道已断开连接' }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error disconnecting tunnel: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const tunnelTools: ToolDefinition[] = [
  configureTunnelTool,
  createTunnelTool,
  getTunnelStatusTool,
  connectTunnelTool,
  disconnectTunnelTool,
];
