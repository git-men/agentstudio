/**
 * AS Enterprise Authentication Tools
 *
 * MCP tools that allow agents to authenticate with as-enterprise
 * and automatically store the JWT token for tunnel/wecom operations.
 *
 * Supports two authentication flows:
 *   1. Email login: Direct API call with email + password
 *   2. OAuth redirect: Generate auth URL, user visits it, callback stores token
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { tunnelService } from '../../tunnelService.js';

/** In-memory pending auth state for OAuth flow */
const pendingAuthStates = new Map<string, { enterpriseUrl: string; createdAt: number }>();

function generateState(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [key, value] of pendingAuthStates.entries()) {
    if (now - value.createdAt > 10 * 60 * 1000) {
      pendingAuthStates.delete(key);
    }
  }
}

async function storeEnterpriseToken(
  enterpriseUrl: string,
  token: string,
): Promise<{ tunnelId: string }> {
  const configs = tunnelService.getAllConfigs();
  const existing = configs[0];

  if (existing) {
    await tunnelService.saveConfig(existing.id, {
      enterpriseToken: token,
      enterpriseUrl: enterpriseUrl,
    });
    return { tunnelId: existing.id };
  }

  const defaultTunnelServer = process.env.TUNNEL_SERVER_URL || 'https://agentstudio.woa.com';
  const newConfig = await tunnelService.addTunnel({
    label: '默认隧道',
    serverUrl: defaultTunnelServer,
    enterpriseToken: token,
    enterpriseUrl: enterpriseUrl,
    enabled: false,
    token: '',
  });
  return { tunnelId: newConfig.id };
}

function checkStoredToken(): {
  hasToken: boolean;
  enterpriseUrl?: string;
  serverUrl?: string;
  tunnelId?: string;
  tokenPreview?: string;
} {
  const rawConfigs = (tunnelService as any).configs as Map<string, any> | undefined;
  if (!rawConfigs || rawConfigs.size === 0) {
    return { hasToken: false };
  }

  const first = rawConfigs.values().next().value;
  if (!first?.enterpriseToken) {
    return { hasToken: false, serverUrl: first?.serverUrl, tunnelId: first?.id };
  }

  return {
    hasToken: true,
    enterpriseUrl: first.enterpriseUrl,
    serverUrl: first.serverUrl,
    tunnelId: first.id,
    tokenPreview: first.enterpriseToken.slice(0, 20) + '...',
  };
}

// ---------------------------------------------------------------------------
// Tool: login_enterprise
// ---------------------------------------------------------------------------

export const loginEnterpriseTool: ToolDefinition = {
  tool: {
    name: 'login_enterprise',
    description:
      'Authenticate with AS Enterprise to obtain a JWT token for tunnel and WeChat bot operations. ' +
      'Supports two modes:\n' +
      '1. Email login: provide enterprise_url + email + password\n' +
      '2. OAuth (iOA/TOF): provide enterprise_url + auth_method=oauth (returns URL for user to visit)\n' +
      'On success the token is automatically stored for subsequent tunnel/wecom tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        enterprise_url: {
          type: 'string',
          description:
            'AS Enterprise server URL, e.g. https://tas.woa.com or https://agentstudio.woa.com',
        },
        auth_method: {
          type: 'string',
          enum: ['email', 'oauth'],
          description:
            'Authentication method. "email" for direct login, "oauth" for iOA/TOF browser-based login.',
        },
        email: {
          type: 'string',
          description: 'Email address (required for email auth method)',
        },
        password: {
          type: 'string',
          description: 'Password (required for email auth method)',
        },
      },
      required: ['enterprise_url', 'auth_method'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    const enterpriseUrl = (params.enterprise_url as string).replace(/\/+$/, '');
    const authMethod = params.auth_method as string;

    try {
      if (authMethod === 'email') {
        const email = params.email as string;
        const password = params.password as string;

        if (!email || !password) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'email 和 password 是 email 登录方式的必填参数',
                }),
              },
            ],
            isError: true,
          };
        }

        const response = await fetch(`${enterpriseUrl}/api/v1/auth/email/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: data.error || `登录失败: HTTP ${response.status}`,
                }),
              },
            ],
            isError: true,
          };
        }

        const accessToken = data.data?.access_token;
        if (!accessToken) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: '登录成功但未返回 access_token',
                }),
              },
            ],
            isError: true,
          };
        }

        const { tunnelId } = await storeEnterpriseToken(enterpriseUrl, accessToken);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `已成功登录 AS Enterprise 并保存令牌`,
                tunnel_id: tunnelId,
                enterprise_url: enterpriseUrl,
                user: data.data?.user?.name || data.data?.user?.email || email,
                token_preview: accessToken.slice(0, 20) + '...',
              }),
            },
          ],
        };
      }

      if (authMethod === 'oauth') {
        cleanupExpiredStates();
        const state = generateState();
        pendingAuthStates.set(state, { enterpriseUrl, createdAt: Date.now() });

        const publicUrl = process.env.PUBLIC_URL;
        const callbackUrl = publicUrl
          ? `${publicUrl.replace(/\/+$/, '')}/api/auth/enterprise/callback`
          : `http://localhost:${(tunnelService as any).localPort || process.env.PORT || 4936}/api/auth/enterprise/callback`;

        const authUrl =
          `${enterpriseUrl}/api/v1/auth/tof/grant` +
          `?redirect_uri=${encodeURIComponent(callbackUrl)}` +
          `&state=${state}`;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                action: 'redirect',
                message:
                  '正在通过 iOA 登录 AS Enterprise，完成后令牌将自动保存。',
                auth_url: authUrl,
                state,
                callback_url: callbackUrl,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `不支持的认证方式: ${authMethod}，请使用 "email" 或 "oauth"`,
            }),
          },
        ],
        isError: true,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error during enterprise login: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

// ---------------------------------------------------------------------------
// Tool: check_enterprise_auth
// ---------------------------------------------------------------------------

export const checkEnterpriseAuthTool: ToolDefinition = {
  tool: {
    name: 'check_enterprise_auth',
    description:
      'Check whether an AS Enterprise token is configured and optionally verify it is still valid. ' +
      'Use before tunnel/wecom operations to see if login_enterprise is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        verify: {
          type: 'boolean',
          description:
            'If true, makes a test API call to verify the token is still valid. Default: false.',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const stored = checkStoredToken();

      if (!stored.hasToken) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                authenticated: false,
                message:
                  '未配置 AS Enterprise 令牌。请使用 login_enterprise 进行登录。',
                server_url: stored.serverUrl || null,
              }),
            },
          ],
        };
      }

      if (params.verify) {
        const rawConfigs = (tunnelService as any).configs as Map<string, any>;
        const first = rawConfigs.values().next().value;
        const enterpriseUrl = (first.enterpriseUrl || first.serverUrl)?.replace(/\/+$/, '');
        const token = first.enterpriseToken;

        if (!enterpriseUrl || !token) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  authenticated: false,
                  message: '令牌或 Enterprise 服务器地址缺失',
                }),
              },
            ],
          };
        }

        try {
          const resp = await fetch(`${enterpriseUrl}/api/v1/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (resp.ok) {
            const data = await resp.json();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    authenticated: true,
                    valid: true,
                    enterprise_url: enterpriseUrl,
                    tunnel_id: stored.tunnelId,
                    user: data.data?.name || data.data?.email || 'unknown',
                    token_preview: stored.tokenPreview,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  authenticated: true,
                  valid: false,
                  message: `令牌已过期或无效 (HTTP ${resp.status})，请重新执行 login_enterprise`,
                  enterprise_url: enterpriseUrl,
                }),
              },
            ],
          };
        } catch (fetchError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  authenticated: true,
                  valid: false,
                  message: `无法连接到服务器验证令牌: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
                  enterprise_url: enterpriseUrl,
                }),
              },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              authenticated: true,
              enterprise_url: stored.enterpriseUrl || stored.serverUrl,
              tunnel_id: stored.tunnelId,
              token_preview: stored.tokenPreview,
              message: '已配置 AS Enterprise 令牌（未在线验证有效性）',
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking enterprise auth: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

// ---------------------------------------------------------------------------
// Tool: refresh_enterprise_token
// ---------------------------------------------------------------------------

export const refreshEnterpriseTokenTool: ToolDefinition = {
  tool: {
    name: 'refresh_enterprise_token',
    description:
      'Refresh the stored AS Enterprise JWT token before it expires. ' +
      'Requires an existing valid token. The new token replaces the old one automatically.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const rawConfigs = (tunnelService as any).configs as Map<string, any>;
      if (!rawConfigs || rawConfigs.size === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: '无已存储的令牌，请先使用 login_enterprise 登录',
              }),
            },
          ],
          isError: true,
        };
      }

      const first = rawConfigs.values().next().value;
      const enterpriseUrl = (first.enterpriseUrl || first.serverUrl)?.replace(/\/+$/, '');
      const oldToken = first.enterpriseToken;

      if (!enterpriseUrl || !oldToken) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: '服务器地址或令牌缺失，请重新执行 login_enterprise',
              }),
            },
          ],
          isError: true,
        };
      }

      const resp = await fetch(`${enterpriseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldToken}` },
      });

      if (!resp.ok) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `刷新失败 (HTTP ${resp.status})，令牌可能已过期，请重新执行 login_enterprise`,
              }),
            },
          ],
          isError: true,
        };
      }

      const data = await resp.json();
      const newToken = data.data?.access_token;

      if (!newToken) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: '刷新请求成功但未返回新令牌',
              }),
            },
          ],
          isError: true,
        };
      }

      await tunnelService.saveConfig(first.id, { enterpriseToken: newToken });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'AS Enterprise 令牌已刷新',
              token_preview: newToken.slice(0, 20) + '...',
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error refreshing token: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const enterpriseAuthTools: ToolDefinition[] = [
  loginEnterpriseTool,
  checkEnterpriseAuthTool,
  refreshEnterpriseTokenTool,
];

/**
 * Used by the OAuth callback route to resolve a pending auth state.
 */
export function resolvePendingAuth(state: string): { enterpriseUrl: string } | null {
  const pending = pendingAuthStates.get(state);
  if (!pending) return null;
  pendingAuthStates.delete(state);
  return { enterpriseUrl: pending.enterpriseUrl };
}

export function registerPendingAuth(state: string, enterpriseUrl: string): void {
  cleanupExpiredStates();
  pendingAuthStates.set(state, { enterpriseUrl, createdAt: Date.now() });
}

export { storeEnterpriseToken };
