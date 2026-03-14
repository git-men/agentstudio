/**
 * Tunnel Management Tools
 *
 * Built-in MCP tools for managing WebSocket tunnels.
 * These tools wrap tunnelService so agents don't need to configure
 * a separate tunnel MCP server.
 *
 * All tools operate on the first tunnel by default, with an optional
 * tunnel_id parameter for multi-tunnel scenarios.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { tunnelService } from '../../tunnelService.js';

function firstTunnelId(): string | null {
  const statuses = tunnelService.getAllStatuses();
  return statuses.length > 0 ? statuses[0].id : null;
}

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
        tunnel_id: {
          type: 'string',
          description: 'Optional: ID of existing tunnel to update. If omitted, creates a placeholder config.',
        },
      },
      required: ['server_url', 'enterprise_token'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const serverUrl = params.server_url as string;
      const enterpriseToken = params.enterprise_token as string;
      const tunnelId = (params.tunnel_id as string) || firstTunnelId();

      if (tunnelId) {
        await tunnelService.saveConfig(tunnelId, { serverUrl, enterpriseToken });
      } else {
        await tunnelService.addTunnel({
          label: '默认隧道',
          serverUrl,
          enterpriseToken,
          enabled: false,
          token: '',
        });
      }

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
          { type: 'text', text: `Error configuring tunnel: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const createTunnelTool: ToolDefinition = {
  tool: {
    name: 'create_tunnel',
    description:
      'Create a new WebSocket tunnel. Returns the tunnel domain and connection token. ' +
      'Requires enterprise token to be configured (via configure_tunnel or UI settings).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Tunnel subdomain name, e.g. "my-agent". Must be unique across the server.',
        },
        server_url: {
          type: 'string',
          description: 'Tunnel server URL. If omitted, uses the first configured tunnel\'s server URL.',
        },
        auto_connect: {
          type: 'boolean',
          description: 'Whether to auto-connect this tunnel on startup. Default: false.',
        },
      },
      required: ['name'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const autoConnect = (params.auto_connect as boolean) ?? false;

      let serverUrl = params.server_url as string | undefined;
      if (!serverUrl) {
        const configs = tunnelService.getAllConfigs();
        serverUrl = configs[0]?.serverUrl;
      }
      if (!serverUrl) {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ success: false, error: '未配置隧道服务器地址，请先调用 configure_tunnel 完成初始化配置' }) },
          ],
          isError: true,
        };
      }

      const result = await tunnelService.createAndSave({
        name,
        serverUrl,
        autoConnect,
        protocol: 'https',
      });

      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                tunnel_id: result.tunnelId,
                tunnel_token: result.token,
                domain: result.domain,
                message: `隧道 ${result.domain} 创建成功`,
              }),
            },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: false, error: result.error }) },
        ],
        isError: true,
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error creating tunnel: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const getTunnelStatusTool: ToolDefinition = {
  tool: {
    name: 'get_tunnel_status',
    description:
      'Get the current WebSocket tunnel connection status. ' +
      'Returns all tunnels when no tunnel_id is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        tunnel_id: {
          type: 'string',
          description: 'Optional: specific tunnel ID. If omitted, returns all tunnels.',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const tunnelId = params.tunnel_id as string | undefined;

      if (tunnelId) {
        const status = tunnelService.getStatus(tunnelId);
        const config = tunnelService.getConfig(tunnelId);
        if (!status) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `隧道 ${tunnelId} 不存在` }) }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: status.id,
                label: status.label,
                connected: status.connected,
                enabled: status.enabled,
                domain: status.domain,
                tunnel_name: config?.tunnelName,
                server_url: status.serverUrl,
                last_error: status.lastError,
                connected_at: status.connectedAt,
              }),
            },
          ],
        };
      }

      const allStatuses = tunnelService.getAllStatuses();
      const allConfigs = tunnelService.getAllConfigs();

      const tunnels = allStatuses.map((st) => {
        const cfg = allConfigs.find((c) => c.id === st.id);
        return {
          id: st.id,
          label: st.label,
          connected: st.connected,
          enabled: st.enabled,
          domain: st.domain,
          tunnel_name: cfg?.tunnelName,
          server_url: st.serverUrl,
          last_error: st.lastError,
        };
      });

      return {
        content: [
          { type: 'text', text: JSON.stringify({ tunnel_count: tunnels.length, tunnels }) },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error getting tunnel status: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

export const connectTunnelTool: ToolDefinition = {
  tool: {
    name: 'connect_tunnel',
    description:
      'Establish (or re-establish) a WebSocket tunnel connection. ' +
      'If no tunnel_id is given, connects the first tunnel.',
    inputSchema: {
      type: 'object',
      properties: {
        tunnel_id: {
          type: 'string',
          description: 'Optional: specific tunnel ID to connect.',
        },
        force: {
          type: 'boolean',
          description: 'Force takeover an existing connection. Default: false.',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const tunnelId = (params.tunnel_id as string) || firstTunnelId();
      if (!tunnelId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: '无隧道配置' }) }],
          isError: true,
        };
      }

      const force = (params.force as boolean) ?? false;
      await tunnelService.connect(tunnelId, force);
      const status = tunnelService.getStatus(tunnelId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              connected: status?.connected,
              domain: status?.domain,
              message: status?.connected
                ? `隧道已连接：${status.domain}`
                : '连接已发起，等待建立中（可再次调用 get_tunnel_status 确认）',
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error connecting tunnel: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const disconnectTunnelTool: ToolDefinition = {
  tool: {
    name: 'disconnect_tunnel',
    description:
      'Disconnect a WebSocket tunnel. If no tunnel_id is given, disconnects the first tunnel.',
    inputSchema: {
      type: 'object',
      properties: {
        tunnel_id: {
          type: 'string',
          description: 'Optional: specific tunnel ID to disconnect.',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const tunnelId = (params.tunnel_id as string) || firstTunnelId();
      if (!tunnelId) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: '无隧道配置' }) }],
          isError: true,
        };
      }

      tunnelService.disconnect(tunnelId);

      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: true, message: '隧道已断开连接' }) },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error disconnecting tunnel: ${error instanceof Error ? error.message : String(error)}` },
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
