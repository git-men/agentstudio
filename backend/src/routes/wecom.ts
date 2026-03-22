/**
 * WeChat Work (WeCom) Binding API
 *
 * REST endpoints for the one-click WeChat Work bot binding wizard.
 * Orchestrates enterprise auth, A2A endpoint setup, bot registration,
 * and callback config generation into a single user-facing flow.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import crypto from 'crypto';
import { tunnelService } from '../services/tunnelService.js';
import { enterpriseAuthService } from '../services/enterpriseAuthService.js';
import { getOrCreateA2AId } from '../services/a2a/agentMappingService.js';
import { generateApiKey } from '../services/a2a/apiKeyService.js';

const router: RouterType = Router();

const PIGEON_RELAY = 'http://npd-sre.tencent-cloud.com/pigeon/relay/wecom/bot';
const DEFAULT_DISPATCH_CALLBACK = 'http://agentstudio.woa.com/callback';
const DEFAULT_DISPATCH_SERVER = 'https://agentstudio.woa.com';
const DEFAULT_DISPATCH_WS = 'ws://21.6.243.90:8083/ws/tunnel';

function getDispatchClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  const serverUrl = config?.serverUrl;
  if (!serverUrl) return null;

  const baseUrl = serverUrl.replace(/\/+$/, '');
  const headers = enterpriseAuthService.getAuthHeaders();

  return { baseUrl, headers };
}

/**
 * Ensure a tunnel is connected. If not, try to auto-provision one using
 * the enterprise token on hand. Returns the connected tunnel status or null.
 */
async function ensureTunnelConnected(): Promise<{ domain: string; protocol: string } | null> {
  const statuses = tunnelService.getAllStatuses();
  const tunnelConfigs = tunnelService.getAllConfigs();
  const status = statuses[0];
  const config = tunnelConfigs[0];

  if (status?.connected && status.domain) {
    return { domain: status.domain, protocol: (config as any)?.protocol || 'https' };
  }

  // Tunnel exists with a token but disconnected — try reconnecting
  const existingCfg = tunnelConfigs.find(c => c.token);
  if (existingCfg) {
    try {
      await tunnelService.connect(existingCfg.id, true);
      const refreshed = tunnelService.getStatus(existingCfg.id);
      if (refreshed?.connected && refreshed.domain) {
        return { domain: refreshed.domain, protocol: existingCfg.protocol || 'https' };
      }
    } catch {
      // fall through to auto-create
    }
  }

  // No usable tunnel token — auto-create one if we have enterprise credentials
  const enterpriseToken = enterpriseAuthService.getToken();
  if (!enterpriseToken) return null;

  const serverUrl = config?.serverUrl || DEFAULT_DISPATCH_SERVER;
  const tunnelName = `wecom-auto-${Date.now().toString(36)}`;

  const result = await tunnelService.createAndSave({
    name: tunnelName,
    serverUrl,
    label: '企微自动隧道',
    autoConnect: true,
    protocol: 'https',
    websocketUrl: (config as any)?.websocketUrl || DEFAULT_DISPATCH_WS,
    accessToken: enterpriseToken,
  });

  if (!result.success || !result.tunnelId) return null;

  const newStatus = tunnelService.getStatus(result.tunnelId!);
  if (newStatus?.connected && newStatus.domain) {
    return { domain: newStatus.domain, protocol: 'https' };
  }

  return null;
}

function generateAlphanumeric(byteLen: number, outputLen: number): string {
  return crypto
    .randomBytes(byteLen)
    .toString('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, outputLen);
}

/**
 * GET /api/wecom/preflight
 * Check prerequisites: enterprise auth, tunnel, project availability.
 */
router.get('/preflight', async (_req: Request, res: Response) => {
  try {
    const hasAuth = enterpriseAuthService.isAuthenticated();
    const configs = tunnelService.getAllConfigs();
    const serverUrl = configs[0]?.serverUrl || '';
    const hasToken = !!configs[0]?.token;

    const statuses = tunnelService.getAllStatuses();
    const tunnelConnected = statuses.length > 0 && statuses[0].connected;
    const tunnelDomain = statuses[0]?.domain || null;

    res.json({
      auth: { ready: hasAuth },
      tunnel: {
        configured: !!serverUrl,
        connected: tunnelConnected,
        domain: tunnelDomain,
        server_url: serverUrl,
        has_token: hasToken,
        can_auto_provision: hasAuth && !!serverUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/wecom/auth/start
 * Initiate enterprise auth via TOF (iOA) one-step login.
 * Opens the AS Enterprise tof/grant endpoint which reads TOF headers,
 * generates a JWT, and redirects back to AgentStudio with the token.
 */
router.post('/auth/start', async (req: Request, res: Response) => {
  try {
    const enterpriseUrl = (req.body.enterprise_url as string || 'https://tas.woa.com').replace(
      /\/+$/,
      '',
    );

    const state =
      Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    // Import registerPendingAuth lazily for backward compat with auth callback
    const { registerPendingAuth } = await import('../services/mcpAdmin/tools/enterpriseAuthTools.js');
    registerPendingAuth(state, enterpriseUrl);

    // Build callback URL. Priority:
    // 1. AGENTSTUDIO_PUBLIC_URL env var (explicit, most reliable for reverse-proxy deployments)
    // 2. x-forwarded-host header (nginx should set this with the *original* Host including port)
    // 3. Host header (works when Express is accessed directly without a proxy)
    const publicUrl = process.env.AGENTSTUDIO_PUBLIC_URL;
    let callbackUrl: string;
    if (publicUrl) {
      callbackUrl = `${publicUrl.replace(/\/+$/, '')}/api/auth/enterprise/callback`;
    } else {
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
      // x-forwarded-host preserves the original host:port; fall back to Host header
      const host =
        (req.headers['x-forwarded-host'] as string) ||
        req.headers.host ||
        `localhost:${process.env.PORT || '4936'}`;
      callbackUrl = `${proto}://${host}/api/auth/enterprise/callback`;
    }

    const authUrl =
      `${enterpriseUrl}/api/v1/auth/tof/grant` +
      `?redirect_uri=${encodeURIComponent(callbackUrl)}` +
      `&state=${state}`;

    res.json({ auth_url: authUrl, state });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/wecom/bind
 * One-click binding: creates A2A endpoint, API key, registers bot,
 * generates pigeon callback config.
 */
router.post('/bind', async (req: Request, res: Response) => {
  const { project_path, webhook_url } = req.body;

  if (!project_path || !webhook_url) {
    return res.status(400).json({ error: '缺少必要参数: project_path, webhook_url' });
  }

  const keyMatch = webhook_url.match(/key=([a-f0-9-]+)/i);
  if (!keyMatch) {
    return res.status(400).json({
      error: '无效的 Webhook 地址，未找到 key 参数。格式应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
    });
  }
  const botKey = keyMatch[1];

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({
      error: 'enterprise_auth_required',
      message: '未配置 Enterprise 认证，请先完成 OAuth 登录',
    });
  }

  try {
    // --- Step 1: Ensure tunnel is connected (auto-provision if needed) ---
    const tunnel = await ensureTunnelConnected();
    if (!tunnel) {
      return res.status(400).json({
        error: 'tunnel_required',
        message: '无法建立隧道连接。请先完成 AS Enterprise 登录，程序将自动创建并连接隧道。',
      });
    }

    const projectId = `proj_${Buffer.from(project_path)
      .toString('base64')
      .replace(/[+/=]/g, '')
      .slice(-12)}`;
    const a2aAgentId = await getOrCreateA2AId(projectId, 'claude-code', project_path);

    const protocol = tunnel.protocol || 'https';
    const tunnelDomain = tunnel.domain.endsWith('.tunnel') ? tunnel.domain : `${tunnel.domain}.tunnel`;
    const baseUrl = `${protocol}://${tunnelDomain}`;
    const accessMode = 'tunnel';

    const a2aEndpoint = `${baseUrl}/a2a/${a2aAgentId}/messages`;

    // --- Step 2: Create A2A API key ---
    const projectName = project_path.split('/').pop() || 'project';
    const { key: apiKey } = await generateApiKey(
      project_path,
      `企微机器人 - ${projectName}`,
    );

    // --- Step 3: Register or update bot in as-dispatch ---
    const { baseUrl: dispatchUrl, headers } = client;
    const tlsOpt = dispatchUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const botPayload = {
      bot_key: botKey,
      name: `${projectName}-agent`,
      target_url: a2aEndpoint,
      api_key: apiKey,
      owner_id: 'wecom-wizard',
      description: `由企微绑定向导自动创建`,
      timeout: 300,
      enabled: true,
    };

    // Check if bot already exists — if so, update (PUT); otherwise create (POST)
    const checkResp = await fetch(`${dispatchUrl}/api/bots/${botKey}`, {
      method: 'GET',
      headers,
      ...tlsOpt,
    } as any);
    const botExists = checkResp.ok && (await checkResp.json().catch(() => ({ success: false }))).success;

    const botResponse = await fetch(
      botExists ? `${dispatchUrl}/api/bots/${botKey}` : `${dispatchUrl}/api/bots`,
      {
        method: botExists ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(botPayload),
        ...tlsOpt,
      } as any,
    );
    if (!botResponse.ok) {
      const err = await botResponse.json().catch(() => ({}));
      return res.status(502).json({
        error: `as-dispatch ${botExists ? '更新' : '注册'}失败`,
        details: err,
        status: botResponse.status,
      });
    }

    // --- Step 4: Generate callback config ---
    const token = generateAlphanumeric(24, 32);
    const encodingAESKey = generateAlphanumeric(48, 43);

    const dispatchCallbackUrl = DEFAULT_DISPATCH_CALLBACK;

    const callbackUrl =
      `${PIGEON_RELAY}?url=${encodeURIComponent(dispatchCallbackUrl)}` +
      `&env=devcloud&token=${token}&aeskey=${encodingAESKey}&robot_callback_format=json`;

    res.json({
      success: true,
      callback_url: callbackUrl,
      token,
      encoding_aes_key: encodingAESKey,
      bot_key: botKey,
      project_name: projectName,
      a2a_endpoint: a2aEndpoint,
      access_mode: accessMode,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
