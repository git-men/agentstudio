/**
 * as-dispatch API Client
 *
 * Sends messages to IM channels via as-dispatch's POST /api/im/send endpoint.
 * Reuses tunnel config for dispatch server URL and auth token (consistent
 * with wecomBotTools.ts), with env var fallback for standalone deployments.
 */

import { tunnelService } from './tunnelService.js';

const DISPATCH_TIMEOUT_MS = 10_000;

interface DispatchIMParams {
  sessionId: string;
  messageContent: string;
  botKey: string;
  chatId: string;
  projectName?: string;
  agentId?: string;
}

interface DispatchIMResult {
  success: boolean;
  shortId?: string;
  error?: string;
}

function getDispatchConnection(): { baseUrl: string; headers: Record<string, string> } | null {
  // Primary: tunnel config (same source as wecomBotTools)
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  if (config?.serverUrl) {
    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const raw = (tunnelService as any).configs?.values()?.next()?.value as
      | { enterpriseToken?: string }
      | undefined;
    if (raw?.enterpriseToken) {
      headers['Authorization'] = `Bearer ${raw.enterpriseToken}`;
    }
    return { baseUrl, headers };
  }

  // Fallback: env vars
  const envUrl = process.env.AS_DISPATCH_URL;
  if (!envUrl) return null;

  const baseUrl = envUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const jwtSecret = process.env.JWT_SECRET_KEY;
  if (jwtSecret) {
    try {
      // Lazy import — jsonwebtoken is an optional dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ service: 'agentstudio' }, jwtSecret, { expiresIn: '5m' });
      headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // jsonwebtoken not available; proceed without auth
    }
  }

  return { baseUrl, headers };
}

export async function sendToIM(params: DispatchIMParams): Promise<DispatchIMResult> {
  const conn = getDispatchConnection();
  if (!conn) {
    return { success: false, error: '未配置 as-dispatch 连接（隧道配置或 AS_DISPATCH_URL 环境变量）' };
  }

  const { baseUrl, headers } = conn;
  // Upgrade HTTP to HTTPS to avoid 307 redirect stripping Authorization headers
  const effectiveBaseUrl = baseUrl.replace(/^http:\/\//, 'https://');
  const url = `${effectiveBaseUrl}/api/im/send`;

  const body = {
    message_content: params.messageContent,
    bot_key: params.botKey,
    chat_id: params.chatId,
    session_id: params.sessionId,
    agent_id: params.agentId,
    project_name: params.projectName,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

    const fetchOptions: any = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      tls: { rejectUnauthorized: false },
    };

    const response = await fetch(url, fetchOptions);
    clearTimeout(timeout);

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (data.success) {
      return {
        success: true,
        shortId: data.short_id as string | undefined,
      };
    }

    return {
      success: false,
      error: (data.error as string) || `as-dispatch 返回失败 (HTTP ${response.status})`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      return { success: false, error: 'as-dispatch 请求超时 (10s)' };
    }
    return { success: false, error: `as-dispatch 网络错误: ${message}` };
  }
}
