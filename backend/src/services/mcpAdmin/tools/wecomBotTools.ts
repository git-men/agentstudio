/**
 * WeChat Work (WeCom) Bot Management Tools
 *
 * Built-in MCP tools for managing WeChat Work bots via as-dispatch.
 * Calls the JWT-authenticated /api/bots/* endpoints so agents don't need
 * a separate as-dispatch MCP server configuration.
 *
 * Prerequisites:
 *   - configure_tunnel (or UI settings) must have been called with the
 *     as-dispatch server URL and enterprise token.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { tunnelService } from '../../tunnelService.js';

/**
 * Build base URL and auth headers from stored tunnel config.
 */
function getDispatchClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  if (!config?.serverUrl) return null;

  const baseUrl = config.serverUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // enterpriseToken is stored masked in getAllConfigs(), so we need raw access
  // tunnelService exposes it via the saved config — read from disk lazily via service
  const raw = (tunnelService as any).configs?.values()?.next()?.value as { enterpriseToken?: string } | undefined;
  if (raw?.enterpriseToken) {
    headers['Authorization'] = `Bearer ${raw.enterpriseToken}`;
  }

  return { baseUrl, headers };
}

async function dispatchFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  const client = getDispatchClient();
  if (!client) {
    return { ok: false, data: { error: '未配置隧道服务器地址，请先调用 configure_tunnel' } };
  }

  const { baseUrl, headers } = client;
  const url = `${baseUrl}${path}`;
  const fetchOptions: any = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  // Internal/corporate HTTPS endpoints may use certs whose SAN doesn't match
  // the hostname. Skip TLS verification for the dispatch server only.
  if (url.startsWith('https://')) {
    fetchOptions.tls = { rejectUnauthorized: false };
  }

  const response = await fetch(url, fetchOptions);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function toResult(data: unknown, isError = false): McpToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

// ---------------------------------------------------------------------------

export const listWecomBotsTool: ToolDefinition = {
  tool: {
    name: 'list_wecom_bots',
    description: 'List all registered WeChat Work bots in as-dispatch.',
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const { ok, data } = await dispatchFetch('GET', '/api/bots');
      return toResult(data, !ok);
    } catch (error) {
      return toResult({ error: String(error) }, true);
    }
  },
  requiredPermissions: ['system:read'],
};

export const getWecomBotTool: ToolDefinition = {
  tool: {
    name: 'get_wecom_bot',
    description: 'Get details of a specific WeChat Work bot by its bot_key (the UUID from the Webhook URL).',
    inputSchema: {
      type: 'object',
      properties: {
        bot_key: { type: 'string', description: 'Bot key (UUID from WeChat Work Webhook URL)' },
      },
      required: ['bot_key'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const { ok, data } = await dispatchFetch('GET', `/api/bots/${params.bot_key}`);
      return toResult(data, !ok);
    } catch (error) {
      return toResult({ error: String(error) }, true);
    }
  },
  requiredPermissions: ['system:read'],
};

export const createWecomBotTool: ToolDefinition = {
  tool: {
    name: 'create_wecom_bot',
    description:
      'Register a WeChat Work group bot in as-dispatch to forward messages to an AgentStudio agent. ' +
      'bot_key is the UUID extracted from the Webhook URL ' +
      '(https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<bot_key>).',
    inputSchema: {
      type: 'object',
      properties: {
        bot_key: {
          type: 'string',
          description: 'UUID from the WeChat Work Webhook URL (key= parameter)',
        },
        name: {
          type: 'string',
          description: 'Human-readable bot name, e.g. "my-project-agent"',
        },
        target_url: {
          type: 'string',
          description: 'Full A2A endpoint URL of the AgentStudio agent',
        },
        api_key: {
          type: 'string',
          description: 'A2A API Key for authenticating requests to the agent',
        },
        description: {
          type: 'string',
          description: 'Optional description of this bot',
        },
        owner_id: {
          type: 'string',
          description: 'Owner identifier, e.g. "meta-agent" or a user ID',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in seconds (default: 300)',
        },
      },
      required: ['bot_key', 'name', 'target_url', 'api_key'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const { ok, data } = await dispatchFetch('POST', '/api/bots', {
        bot_key: params.bot_key,
        name: params.name,
        target_url: params.target_url,
        api_key: params.api_key,
        description: params.description,
        owner_id: params.owner_id ?? 'agentstudio',
        timeout: params.timeout ?? 300,
        enabled: true,
      });
      return toResult(data, !ok);
    } catch (error) {
      return toResult({ error: String(error) }, true);
    }
  },
  requiredPermissions: ['system:write'],
};

export const updateWecomBotTool: ToolDefinition = {
  tool: {
    name: 'update_wecom_bot',
    description:
      'Update an existing WeChat Work bot configuration. ' +
      'Use enabled=false to disable the bot without deleting it.',
    inputSchema: {
      type: 'object',
      properties: {
        bot_key: { type: 'string', description: 'Bot key to update' },
        name: { type: 'string' },
        target_url: { type: 'string' },
        api_key: { type: 'string' },
        description: { type: 'string' },
        enabled: { type: 'boolean', description: 'Set false to disable the bot' },
        timeout: { type: 'number' },
      },
      required: ['bot_key'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const { bot_key, ...rest } = params;
      const { ok, data } = await dispatchFetch('PUT', `/api/bots/${bot_key}`, rest);
      return toResult(data, !ok);
    } catch (error) {
      return toResult({ error: String(error) }, true);
    }
  },
  requiredPermissions: ['system:write'],
};

export const wecomBotTools: ToolDefinition[] = [
  listWecomBotsTool,
  getWecomBotTool,
  createWecomBotTool,
  updateWecomBotTool,
];
