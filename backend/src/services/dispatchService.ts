/**
 * as-dispatch API Client
 *
 * Sends messages to IM channels via as-dispatch's POST /api/im/send endpoint.
 * Reuses tunnel config for dispatch server URL and enterpriseToken (consistent
 * with wecomBotTools.ts), with env var fallback for standalone deployments.
 *
 * Auth: uses enterpriseToken from tunnel config (issued by as-enterprise login).
 * When token is invalid/expired, returns actionable error guiding user to re-login.
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

function resolveAuthHeader(): string | null {
  const rawConfigs = (tunnelService as any).configs as Map<string, { enterpriseToken?: string }> | undefined;
  const configs = tunnelService.getAllConfigs();
  const rawConfig = rawConfigs?.get(configs[0]?.id);
  if (rawConfig?.enterpriseToken) {
    return `Bearer ${rawConfig.enterpriseToken}`;
  }

  return null;
}

function getDispatchConnection(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  if (config?.serverUrl) {
    // Keep the URL as-is (HTTP). HTTPS goes through IAS/STGW gateway
    // which does NOT forward /api/im/* routes, causing 404.
    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = resolveAuthHeader();
    if (auth) headers['Authorization'] = auth;
    return { baseUrl, headers };
  }

  const envUrl = process.env.AS_DISPATCH_URL;
  if (!envUrl) return null;

  const baseUrl = envUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = resolveAuthHeader();
  if (auth) headers['Authorization'] = auth;
  return { baseUrl, headers };
}

export async function sendToIM(params: DispatchIMParams): Promise<DispatchIMResult> {
  const conn = getDispatchConnection();
  if (!conn) {
    return { success: false, error: '未配置 as-dispatch 连接（隧道配置或 AS_DISPATCH_URL 环境变量）' };
  }

  const { baseUrl, headers } = conn;
  const url = `${baseUrl}/api/im/send`;

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

    console.log(`[DispatchService] POST ${url} (auth: ${headers['Authorization'] ? 'yes' : 'no'})`);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (data.success) {
      return {
        success: true,
        shortId: data.short_id as string | undefined,
      };
    }

    if (response.status === 401) {
      const detail = (data.detail as string) || '';
      const isExpired = detail.includes('过期') || detail.includes('expired');
      const isBadSig = detail.includes('Signature') || detail.includes('签名');
      const hint = isExpired
        ? '企业认证已过期，请在设置页重新登录 as-enterprise'
        : isBadSig
          ? '企业认证签名无效，请在设置页重新登录 as-enterprise'
          : '企业认证失败，请在设置页重新登录 as-enterprise';
      console.warn(`[DispatchService] Auth failed (401): ${detail}`);
      return { success: false, error: hint };
    }

    const detail = (data.detail as string) || (data.error as string) || '';
    const errorMsg = detail || `as-dispatch 返回失败 (HTTP ${response.status})`;
    console.warn(`[DispatchService] Failed: HTTP ${response.status} — ${errorMsg}`);

    return { success: false, error: errorMsg };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('abort')) {
      return { success: false, error: 'as-dispatch 请求超时 (10s)' };
    }
    return { success: false, error: `as-dispatch 网络错误: ${message}` };
  }
}
