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
 * GET /api/qqbot/preflight
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
      return res.status(502).json({
        error: `as-dispatch Bot ${botExists ? '更新' : '注册'}失败`,
        details: err,
      });
    }

    // Step 4: Start QQ Bot WebSocket connection
    // Use /admin endpoint for qqbot start (this is a server-side control action)
    let connectionStatus: any = { connected: false };
    try {
      const startResp = await fetch(`${dispatchUrl}/admin/qqbot/${botKey}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (startResp.ok) {
        connectionStatus = await startResp.json();
      }
    } catch (e) {
      connectionStatus = { connected: false, error: String(e) };
    }

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
