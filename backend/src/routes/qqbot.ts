/**
 * QQ Bot Binding API
 *
 * REST endpoints for the QQ Bot binding wizard.
 * Orchestrates A2A endpoint setup, API key generation, bot registration,
 * and WebSocket connection startup into a single user-facing flow.
 *
 * Unlike WeChat Work which requires pigeon relay and callback URLs,
 * QQ Bot uses outbound WebSocket connections — no inbound access needed.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getOrCreateA2AId } from '../services/a2a/agentMappingService.js';
import { generateApiKey } from '../services/a2a/apiKeyService.js';

const router: RouterType = Router();

const DEFAULT_DISPATCH_URL = 'http://localhost:8085';
const LOCAL_AGENTSTUDIO_PORT = process.env.PORT || '4936';

function getDispatchUrl(): string {
  return process.env.QQBOT_DISPATCH_URL || DEFAULT_DISPATCH_URL;
}

async function checkDispatchHealth(baseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${baseUrl}/admin/bots`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * GET /api/qqbot/preflight
 * Check prerequisites: as-dispatch connectivity.
 */
router.get('/preflight', async (_req: Request, res: Response) => {
  try {
    const dispatchUrl = getDispatchUrl();
    const reachable = await checkDispatchHealth(dispatchUrl);

    res.json({
      dispatch: {
        reachable,
        url: dispatchUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/qqbot/bind
 * One-click binding: creates A2A endpoint, API key, registers QQ Bot
 * in as-dispatch, and starts the WebSocket connection.
 */
router.post('/bind', async (req: Request, res: Response) => {
  const { project_path, app_id, client_secret, bot_name } = req.body;

  if (!project_path || !app_id || !client_secret) {
    return res.status(400).json({
      error: '缺少必要参数: project_path, app_id, client_secret',
    });
  }

  const dispatchUrl = getDispatchUrl();
  const reachable = await checkDispatchHealth(dispatchUrl);
  if (!reachable) {
    return res.status(502).json({
      error: 'as-dispatch 服务不可达',
      message: `无法连接 ${dispatchUrl}，请确保 as-dispatch 正在运行`,
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
    const targetUrl = `http://localhost:${LOCAL_AGENTSTUDIO_PORT}/a2a/${a2aAgentId}/messages`;

    // Step 2: Generate API key
    const { key: apiKey } = await generateApiKey(
      project_path,
      `QQ Bot - ${projectName}`,
    );

    // Step 3: Register bot in as-dispatch
    const botKey = `qqbot-${projectId}`;
    const name = bot_name || `${projectName} QQ Bot`;

    const checkResp = await fetch(`${dispatchUrl}/admin/bots/${botKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const botExists = checkResp.ok && (await checkResp.json().catch(() => ({ success: false }))).success;

    const botPayload = {
      bot_key: botKey,
      name,
      platform: 'qqbot',
      platform_config: { app_id, client_secret },
      target_url: targetUrl,
      api_key: apiKey,
      owner_id: 'qqbot-wizard',
      description: `由 QQ Bot 绑定向导自动创建`,
      timeout: 300,
      enabled: true,
    };

    const botResp = await fetch(
      botExists ? `${dispatchUrl}/admin/bots/${botKey}` : `${dispatchUrl}/admin/bots`,
      {
        method: botExists ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(botPayload),
      },
    );

    if (!botResp.ok) {
      const err = await botResp.json().catch(() => ({}));
      return res.status(502).json({
        error: `as-dispatch Bot ${botExists ? '更新' : '注册'}失败`,
        details: err,
      });
    }

    // Step 4: Start QQ Bot WebSocket connection
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
      a2a_endpoint: targetUrl,
      app_id,
      connection: connectionStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
