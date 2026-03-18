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
import { getOrCreateA2AId } from '../services/a2a/agentMappingService.js';
import { generateApiKey } from '../services/a2a/apiKeyService.js';
import { registerPendingAuth } from '../services/mcpAdmin/tools/enterpriseAuthTools.js';

const router: RouterType = Router();

const PIGEON_RELAY = 'http://npd-sre.tencent-cloud.com/pigeon/relay/wecom/bot';
const DEFAULT_DISPATCH_CALLBACK = 'http://agentstudio.woa.com/callback';

function getDispatchClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  if (!config?.serverUrl) return null;

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
    const rawConfigs = (tunnelService as any).configs as Map<string, any> | undefined;
    const firstConfig = rawConfigs && rawConfigs.size > 0 ? rawConfigs.values().next().value : null;
    const hasAuth = !!firstConfig?.enterpriseToken;
    const serverUrl = firstConfig?.serverUrl || '';

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
    registerPendingAuth(state, enterpriseUrl);

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host || `localhost:${process.env.PORT || '4936'}`;
    const callbackUrl = `${protocol}://${host}/api/auth/enterprise/callback`;

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
    // --- Step 1: Resolve A2A endpoint (tunnel required) ---
    const allStatuses = tunnelService.getAllStatuses();
    const allConfigs = tunnelService.getAllConfigs();
    const tunnelStatus = allStatuses[0] ?? { connected: false, domain: null };
    const tunnelConfig = allConfigs[0] ?? ({} as any);

    if (!tunnelStatus.connected || !tunnelStatus.domain) {
      return res.status(400).json({
        error: 'tunnel_required',
        message: '需要先连接隧道，否则 as-dispatch 无法访问本地 Agent。请在设置中配置并连接隧道。',
      });
    }

    const projectId = `proj_${Buffer.from(project_path)
      .toString('base64')
      .replace(/[+/=]/g, '')
      .slice(-12)}`;
    const a2aAgentId = await getOrCreateA2AId(projectId, 'claude-code', project_path);

    const protocol = (tunnelConfig.protocol as string) || 'https';
    const tunnelDomain = `${tunnelStatus.domain}.tunnel`;
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
