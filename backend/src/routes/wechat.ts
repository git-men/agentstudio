/**
 * WeChat Personal Account Binding API
 *
 * REST endpoints for the WeChat personal bot binding wizard.
 * Unlike WeCom/QQBot which use webhook/AppID credentials,
 * WeChat uses QR code scanning via the iLinkAI protocol.
 *
 * Flow: preflight → register bot → QR login → poll status → start polling
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { enterpriseAuthService } from '../services/enterpriseAuthService.js';
import { tunnelService } from '../services/tunnelService.js';
import { getOrCreateA2AId } from '../services/a2a/agentMappingService.js';
import { generateApiKey } from '../services/a2a/apiKeyService.js';

const router: RouterType = Router();

function getDispatchClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const token = enterpriseAuthService.getToken();
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  const serverUrl = config?.serverUrl;

  if (!serverUrl) return null;

  const baseUrl = serverUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return { baseUrl, headers };
}

function getConnectedTunnel(): { domain: string; protocol: string } | null {
  const statuses = tunnelService.getAllStatuses();
  const configs = tunnelService.getAllConfigs();
  const status = statuses[0];
  const config = configs[0];

  if (status?.connected && status.domain) {
    return { domain: status.domain, protocol: (config as any)?.protocol || 'https' };
  }
  return null;
}

/**
 * GET /api/wechat/preflight
 * Check prerequisites: enterprise auth, tunnel, as-dispatch connectivity.
 */
router.get('/preflight', async (_req: Request, res: Response) => {
  try {
    const isAuth = enterpriseAuthService.isAuthenticated();
    const profile = enterpriseAuthService.getProfile();
    const tunnel = getConnectedTunnel();
    const client = getDispatchClient();

    let dispatchReachable = false;
    if (client) {
      try {
        const resp = await fetch(`${client.baseUrl}/api/bots`, {
          method: 'GET',
          headers: client.headers,
          signal: AbortSignal.timeout(3000),
        });
        dispatchReachable = resp.ok;
      } catch {
        // not reachable
      }
    }

    res.json({
      auth: {
        ready: isAuth,
        name: profile?.name,
        email: profile?.email,
      },
      tunnel: {
        connected: !!tunnel,
        domain: tunnel?.domain || null,
      },
      dispatch: {
        reachable: dispatchReachable,
        url: client?.baseUrl || null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/wechat/bind
 * Step 1: Register bot in as-dispatch, create A2A endpoint and API key.
 * Returns bot_key for subsequent QR login flow.
 */
router.post('/bind', async (req: Request, res: Response) => {
  const { project_path } = req.body;

  if (!project_path) {
    return res.status(400).json({ error: '缺少必要参数: project_path' });
  }

  if (!enterpriseAuthService.isAuthenticated()) {
    return res.status(400).json({
      error: 'enterprise_auth_required',
      message: '未登录企业版，请先完成 Enterprise 登录',
    });
  }

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({
      error: '未配置 as-dispatch 服务器',
      message: '请先配置隧道连接',
    });
  }

  const tunnel = getConnectedTunnel();
  if (!tunnel) {
    return res.status(400).json({
      error: 'tunnel_required',
      message: '隧道未连接，请确保隧道已建立',
    });
  }

  try {
    const projectId = `proj_${Buffer.from(project_path)
      .toString('base64')
      .replace(/[+/=]/g, '')
      .slice(-12)}`;
    const a2aAgentId = await getOrCreateA2AId(projectId, 'claude-code', project_path);

    const projectName = project_path.split('/').pop() || 'project';

    const protocol = tunnel.protocol || 'https';
    const tunnelDomain = tunnel.domain.endsWith('.tunnel') ? tunnel.domain : `${tunnel.domain}.tunnel`;
    const a2aEndpoint = `${protocol}://${tunnelDomain}/a2a/${a2aAgentId}/messages`;

    const { key: apiKey } = await generateApiKey(
      project_path,
      `微信机器人 - ${projectName}`,
    );

    const botKey = `weixin-${projectId}`;
    const name = `${projectName} 微信`;
    const { baseUrl: dispatchUrl, headers } = client;

    const tlsOpt = dispatchUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const botPayload = {
      bot_key: botKey,
      name,
      platform: 'weixin',
      platform_config: {},
      target_url: a2aEndpoint,
      api_key: apiKey,
      owner_id: 'wechat-wizard',
      description: `由微信绑定向导自动创建`,
      timeout: 300,
      enabled: true,
    };

    const checkResp = await fetch(`${dispatchUrl}/api/bots/${botKey}`, {
      method: 'GET',
      headers,
      ...tlsOpt,
    } as any);
    const botExists = checkResp.ok && (await checkResp.json().catch(() => ({ success: false }))).success;

    const botResp = await fetch(
      botExists ? `${dispatchUrl}/api/bots/${botKey}` : `${dispatchUrl}/api/bots`,
      {
        method: botExists ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(botPayload),
        ...tlsOpt,
      } as any,
    );

    if (!botResp.ok) {
      const err = await botResp.json().catch(() => ({}));
      return res.status(502).json({
        error: `as-dispatch Bot ${botExists ? '更新' : '注册'}失败`,
        details: err,
      });
    }

    res.json({
      success: true,
      bot_key: botKey,
      bot_name: name,
      project_name: projectName,
      a2a_endpoint: a2aEndpoint,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/wechat/qr-login
 * Step 2: Trigger QR code login via as-dispatch admin API.
 * Returns QR code URL for the user to scan with WeChat.
 */
router.post('/qr-login', async (req: Request, res: Response) => {
  const { bot_key } = req.body;

  if (!bot_key) {
    return res.status(400).json({ error: '缺少 bot_key 参数' });
  }

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;
    const tlsOpt = baseUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const resp = await fetch(`${baseUrl}/admin/weixin/${bot_key}/qr-login`, {
      method: 'POST',
      headers,
      ...tlsOpt,
    } as any);

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      return res.status(resp.status || 502).json({
        error: data.error || data.detail || 'QR 码获取失败',
        details: data,
      });
    }

    res.json({
      success: true,
      qrcode_url: data.qrcode_url,
      message: data.message || '请使用微信扫描二维码',
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/wechat/qr-status
 * Step 3: Poll QR code scan status.
 * Returns: wait | scaned | confirmed | expired
 */
router.get('/qr-status', async (req: Request, res: Response) => {
  const botKey = req.query.bot_key as string;

  if (!botKey) {
    return res.status(400).json({ error: '缺少 bot_key 参数' });
  }

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;
    const tlsOpt = baseUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const resp = await fetch(`${baseUrl}/admin/weixin/${botKey}/qr-status`, {
      method: 'GET',
      headers,
      ...tlsOpt,
    } as any);

    const data = await resp.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/wechat/start
 * Step 4: Start the WeChat bot's long-polling loop after QR login succeeds.
 */
router.post('/start', async (req: Request, res: Response) => {
  const { bot_key } = req.body;

  if (!bot_key) {
    return res.status(400).json({ error: '缺少 bot_key 参数' });
  }

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;
    const tlsOpt = baseUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const resp = await fetch(`${baseUrl}/admin/weixin/${bot_key}/start`, {
      method: 'POST',
      headers,
      ...tlsOpt,
    } as any);

    const data = await resp.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/wechat/status
 * Check a specific WeChat bot's status.
 */
router.get('/status', async (req: Request, res: Response) => {
  const botKey = req.query.bot_key as string;

  if (!botKey) {
    return res.status(400).json({ error: '缺少 bot_key 参数' });
  }

  const client = getDispatchClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;
    const tlsOpt = baseUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const resp = await fetch(`${baseUrl}/admin/weixin/${botKey}/status`, {
      method: 'GET',
      headers,
      ...tlsOpt,
    } as any);

    const data = await resp.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
