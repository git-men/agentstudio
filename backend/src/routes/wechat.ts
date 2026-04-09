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
import { imBindingService } from '../services/imBindingService.js';

const router: RouterType = Router();

/**
 * Direct as-dispatch URL (bypasses NGINX reverse proxy which applies SSO to /admin/* paths).
 * Port 8083 is the FastAPI application port; port 80 is NGINX.
 */
const DEFAULT_DISPATCH_DIRECT = 'http://21.6.243.90:8083';
const DEFAULT_DISPATCH_SERVER = 'https://agentstudio.woa.com';
const DEFAULT_DISPATCH_WS = 'ws://21.6.243.90:8083/ws/tunnel';

function getDispatchClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  const serverUrl = config?.serverUrl;
  if (!serverUrl) return null;

  // Force HTTPS to prevent HTTP→HTTPS 307 redirect which strips Authorization header
  const baseUrl = serverUrl.replace(/\/+$/, '').replace(/^http:\/\//i, 'https://');
  const headers = enterpriseAuthService.getAuthHeaders();

  return { baseUrl, headers };
}

/**
 * For /admin/* routes, use direct as-dispatch URL to bypass NGINX SSO.
 * Derives from websocketUrl (port != 80/443) or falls back to DEFAULT_DISPATCH_DIRECT.
 */
function getDispatchAdminClient(): { baseUrl: string; headers: Record<string, string> } | null {
  const configs = tunnelService.getAllConfigs();
  const config = configs[0];
  const wsUrl = config?.websocketUrl;

  let baseUrl = DEFAULT_DISPATCH_DIRECT;

  if (wsUrl) {
    try {
      const url = new URL(wsUrl);
      const port = url.port;
      if (port && port !== '80' && port !== '443') {
        const httpProto = url.protocol === 'wss:' ? 'https:' : 'http:';
        baseUrl = `${httpProto}//${url.hostname}:${port}`;
      }
    } catch {
      // use default
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  return { baseUrl, headers };
}

async function ensureTunnelConnected(): Promise<{ domain: string; protocol: string } | null> {
  const statuses = tunnelService.getAllStatuses();
  const tunnelConfigs = tunnelService.getAllConfigs();
  const status = statuses[0];
  const config = tunnelConfigs[0];

  if (status?.connected && status.domain) {
    return { domain: status.domain, protocol: (config as any)?.protocol || 'https' };
  }

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

  const enterpriseToken = enterpriseAuthService.getToken();
  if (!enterpriseToken) return null;

  const serverUrl = config?.serverUrl || DEFAULT_DISPATCH_SERVER;
  const tunnelName = `wechat-auto-${Date.now().toString(36)}`;

  const result = await tunnelService.createAndSave({
    name: tunnelName,
    serverUrl,
    label: '微信自动隧道',
    autoConnect: true,
    protocol: 'https',
    websocketUrl: (config as any)?.websocketUrl || DEFAULT_DISPATCH_WS,
    accessToken: enterpriseToken,
  });

  if (!result.success || !result.tunnelId) {
    console.warn('[WeChat] Tunnel auto-create failed:', result.error);
    return null;
  }

  const maxWaitMs = 15_000;
  const pollInterval = 500;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const newStatus = tunnelService.getStatus(result.tunnelId!);
    if (newStatus?.connected && newStatus.domain) {
      return { domain: newStatus.domain, protocol: 'https' };
    }
    if (newStatus?.lastError) {
      console.warn(`[WeChat] Tunnel connection error: ${newStatus.lastError}`);
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  const finalStatus = tunnelService.getStatus(result.tunnelId!);
  console.warn(
    `[WeChat] Tunnel did not connect within ${maxWaitMs / 1000}s.`,
    `Status: connected=${finalStatus?.connected}, lastError=${finalStatus?.lastError}`,
  );
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
    const configs = tunnelService.getAllConfigs();
    const serverUrl = configs[0]?.serverUrl || '';
    const hasToken = !!configs[0]?.token;

    const statuses = tunnelService.getAllStatuses();
    const tunnelConnected = statuses.length > 0 && statuses[0].connected;
    const tunnelDomain = statuses[0]?.domain || null;

    res.json({
      auth: {
        ready: isAuth,
        name: profile?.name,
        email: profile?.email,
      },
      tunnel: {
        configured: !!serverUrl,
        connected: tunnelConnected,
        domain: tunnelDomain,
        server_url: serverUrl,
        has_token: hasToken,
        can_auto_provision: isAuth && !!(serverUrl || DEFAULT_DISPATCH_SERVER),
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

  try {
    // --- Ensure tunnel is connected (auto-provision if needed) ---
    const tunnel = await ensureTunnelConnected();
    if (!tunnel) {
      const statuses = tunnelService.getAllStatuses();
      const lastError = statuses.find(s => s.lastError)?.lastError;
      return res.status(400).json({
        error: 'tunnel_required',
        message: lastError
          ? `隧道连接失败: ${lastError}`
          : '无法建立隧道连接。请先完成 AS Enterprise 登录，程序将自动创建并连接隧道。',
      });
    }
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
      console.error(`[WeChat Bind] as-dispatch Bot ${botExists ? '更新' : '注册'}失败`, {
        status: botResp.status,
        url: botExists ? `${dispatchUrl}/api/bots/${botKey}` : `${dispatchUrl}/api/bots`,
        response: err,
      });

      if (botResp.status === 401) {
        return res.status(401).json({
          error: 'enterprise_token_expired',
          message: 'Enterprise 登录已过期，请重新登录',
        });
      }

      return res.status(502).json({
        error: `as-dispatch Bot ${botExists ? '更新' : '注册'}失败 (${botResp.status})`,
        message: err.detail || err.error || err.message || JSON.stringify(err),
        details: err,
      });
    }

    imBindingService.upsert({
      platform: 'weixin',
      name: `${projectName} 微信`,
      project_path,
      project_name: projectName,
      bot_key: botKey,
      a2a_endpoint: a2aEndpoint,
    });

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

  const client = getDispatchAdminClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;

    const resp = await fetch(`${baseUrl}/admin/weixin/${bot_key}/qr-login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

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

  const client = getDispatchAdminClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;

    const resp = await fetch(`${baseUrl}/admin/weixin/${botKey}/qr-status`, {
      method: 'GET',
      headers,
    });

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

  const client = getDispatchAdminClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;

    const resp = await fetch(`${baseUrl}/admin/weixin/${bot_key}/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

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

  const client = getDispatchAdminClient();
  if (!client) {
    return res.status(400).json({ error: '未配置 as-dispatch 服务器' });
  }

  try {
    const { baseUrl, headers } = client;

    const resp = await fetch(`${baseUrl}/admin/weixin/${botKey}/status`, {
      method: 'GET',
      headers,
    });

    const data = await resp.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
