/**
 * QQ Bot Binding API
 *
 * REST endpoints for the QQ Bot binding wizard.
 * Orchestrates A2A endpoint setup, API key generation, bot registration,
 * and WebSocket connection startup into a single user-facing flow.
 *
 * Now unified with the same auth model as WeChat Work binding:
 * - Requires Enterprise auth (JWT) for as-dispatch API access
 * - Uses tunnel domain for target_url (so remote as-dispatch can reach local AgentStudio)
 * - Calls /api/bots (JWT Bearer) instead of /admin/bots
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { enterpriseAuthService } from '../services/enterpriseAuthService.js';
import { tunnelService } from '../services/tunnelService.js';
import { getOrCreateA2AId } from '../services/a2a/agentMappingService.js';
import { generateApiKey } from '../services/a2a/apiKeyService.js';
import { imBindingService } from '../services/imBindingService.js';

const router: RouterType = Router();

const DEFAULT_DISPATCH_DIRECT = 'http://21.6.243.90:8083';

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
 * GET /api/qqbot/preflight
 * Check prerequisites: enterprise auth, tunnel, as-dispatch connectivity.
 */
router.get('/preflight', async (_req: Request, res: Response) => {
  try {
    const isAuth = enterpriseAuthService.isAuthenticated();
    const profile = enterpriseAuthService.getProfile();
    const tunnel = getConnectedTunnel();

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
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/qqbot/bind
 * One-click binding: creates A2A endpoint, API key, registers QQ Bot
 * in as-dispatch via JWT-authenticated /api/bots, and starts the WebSocket connection.
 */
router.post('/bind', async (req: Request, res: Response) => {
  const { project_path, app_id, client_secret, bot_name } = req.body;

  if (!project_path || !app_id || !client_secret) {
    return res.status(400).json({
      error: '缺少必要参数: project_path, app_id, client_secret',
    });
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
    // Step 1: Get or create A2A agent ID
    const projectId = `proj_${Buffer.from(project_path)
      .toString('base64')
      .replace(/[+/=]/g, '')
      .slice(-12)}`;
    const a2aAgentId = await getOrCreateA2AId(projectId, 'claude-code', project_path);

    const projectName = project_path.split('/').pop() || 'project';

    // Use tunnel domain for target_url (not localhost)
    const protocol = tunnel.protocol || 'https';
    const tunnelDomain = tunnel.domain.endsWith('.tunnel') ? tunnel.domain : `${tunnel.domain}.tunnel`;
    const a2aEndpoint = `${protocol}://${tunnelDomain}/a2a/${a2aAgentId}/messages`;

    // Step 2: Generate API key
    const { key: apiKey } = await generateApiKey(
      project_path,
      `QQ Bot - ${projectName}`,
    );

    // Step 3: Register bot in as-dispatch via /api/bots (JWT auth)
    const botKey = `qqbot-${projectId}`;
    const name = bot_name || `${projectName} QQ Bot`;
    const { baseUrl: dispatchUrl, headers } = client;

    const tlsOpt = dispatchUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {};

    const botPayload = {
      bot_key: botKey,
      name,
      platform: 'qqbot',
      platform_config: { app_id, client_secret },
      target_url: a2aEndpoint,
      api_key: apiKey,
      owner_id: 'qqbot-wizard',
      description: `由 QQ Bot 绑定向导自动创建`,
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
      console.error(`[QQBot Bind] as-dispatch Bot ${botExists ? '更新' : '注册'}失败`, {
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

    // Step 4: Start QQ Bot WebSocket connection
    // Use /admin endpoint for qqbot start (this is a server-side control action)
    let connectionStatus: any = { connected: false };
    try {
      const adminClient = getDispatchAdminClient();
      const adminUrl = adminClient?.baseUrl || dispatchUrl;
      const startResp = await fetch(`${adminUrl}/admin/qqbot/${botKey}/start`, {
        method: 'POST',
        headers: adminClient?.headers || { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (startResp.ok) {
        connectionStatus = await startResp.json();
      }
    } catch (e) {
      connectionStatus = { connected: false, error: String(e) };
    }

    imBindingService.upsert({
      platform: 'qqbot',
      name: bot_name || name,
      project_path,
      project_name: projectName,
      bot_key: botKey,
      a2a_endpoint: a2aEndpoint,
      platform_config: { app_id },
    });

    res.json({
      success: true,
      bot_key: botKey,
      bot_name: name,
      project_name: projectName,
      a2a_endpoint: a2aEndpoint,
      app_id,
      connection: connectionStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
