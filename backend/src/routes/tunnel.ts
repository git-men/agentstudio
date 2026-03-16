/**
 * Tunnel Routes — Multi-Tunnel API
 *
 * API endpoints for managing multiple WebSocket tunnel connections.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { tunnelService, TunnelConfig } from '../services/tunnelService.js';

const router: RouterType = Router();

// =============================================================================
// List / aggregate
// =============================================================================

/**
 * GET /api/tunnel/list
 * List all tunnels with their config and status
 */
router.get('/list', async (_req: Request, res: Response): Promise<any> => {
  try {
    const configs = tunnelService.getAllConfigs();
    const statuses = tunnelService.getAllStatuses();

    const tunnels = configs.map((cfg) => {
      const st = statuses.find((s) => s.id === cfg.id);
      return { config: cfg, status: st };
    });

    res.json({ tunnels });
  } catch (error) {
    console.error('[Tunnel API] Error listing tunnels:', error);
    res.status(500).json({
      error: 'Failed to list tunnels',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// Batch operations
// =============================================================================

/**
 * POST /api/tunnel/connect-all
 * Connect all configured tunnels
 */
router.post('/connect-all', async (_req: Request, res: Response): Promise<any> => {
  try {
    const results = await tunnelService.connectAll();
    res.json({ success: true, results, statuses: tunnelService.getAllStatuses() });
  } catch (error) {
    console.error('[Tunnel API] Error connecting all:', error);
    res.status(500).json({
      error: 'Failed to connect all tunnels',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/tunnel/disconnect-all
 * Disconnect all tunnels
 */
router.post('/disconnect-all', async (_req: Request, res: Response): Promise<any> => {
  try {
    tunnelService.disconnectAll();
    res.json({ success: true, statuses: tunnelService.getAllStatuses() });
  } catch (error) {
    console.error('[Tunnel API] Error disconnecting all:', error);
    res.status(500).json({
      error: 'Failed to disconnect all tunnels',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// Tunnel add / creation
// =============================================================================

/**
 * POST /api/tunnel/add
 * Manually add a tunnel config (when you already have a token, e.g. created externally)
 *
 * Body: { label, serverUrl, token, tunnelName, protocol?, websocketUrl?, domainSuffix?, enabled? }
 */
router.post('/add', async (req: Request, res: Response): Promise<any> => {
  try {
    const { label, serverUrl, token, tunnelName, protocol, websocketUrl, domainSuffix, enabled } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: '请提供隧道 Token' });
    }
    if (!serverUrl || typeof serverUrl !== 'string') {
      return res.status(400).json({ success: false, error: '请提供服务器地址' });
    }

    const cfg = await tunnelService.addTunnel({
      label: label || tunnelName || '新隧道',
      serverUrl: serverUrl.trim(),
      token: token.trim(),
      tunnelName: tunnelName?.trim(),
      protocol: protocol === 'http' ? 'http' : 'https',
      websocketUrl: websocketUrl?.trim(),
      domainSuffix: domainSuffix?.trim(),
      enabled: enabled === true,
    });

    if (enabled) {
      try { await tunnelService.connect(cfg.id); } catch { /* auto-connect best effort */ }
    }

    res.json({
      success: true,
      config: tunnelService.getConfig(cfg.id),
      status: tunnelService.getStatus(cfg.id),
    });
  } catch (error) {
    console.error('[Tunnel API] Error adding tunnel:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/tunnel/create-tunnel
 * Create a new tunnel on the remote server, persist config, optionally connect
 *
 * Body: { name, serverUrl, label?, autoConnect?, protocol?, websocketUrl?, domainSuffix?, accessToken? }
 */
router.post('/create-tunnel', async (req: Request, res: Response): Promise<any> => {
  try {
    const { name, serverUrl, label, autoConnect, protocol, websocketUrl, domainSuffix, accessToken } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: '请提供隧道名称' });
    }
    if (!serverUrl || typeof serverUrl !== 'string') {
      return res.status(400).json({ success: false, error: '请提供服务器地址' });
    }

    const validProtocol = protocol === 'http' ? 'http' : 'https';

    const result = await tunnelService.createAndSave({
      name: name.trim(),
      serverUrl: serverUrl.trim(),
      label: label?.trim(),
      autoConnect: autoConnect === true,
      protocol: validProtocol,
      websocketUrl,
      domainSuffix,
      accessToken,
    });

    if (result.success) {
      res.json({
        ...result,
        config: result.tunnelId ? tunnelService.getConfig(result.tunnelId) : undefined,
        status: result.tunnelId ? tunnelService.getStatus(result.tunnelId) : undefined,
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('[Tunnel API] Error creating tunnel:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/tunnel/server-info
 * Proxy fetch of tunnel server info (avoids CORS)
 */
router.post('/server-info', async (req: Request, res: Response): Promise<any> => {
  try {
    const { serverUrl } = req.body;
    if (!serverUrl || typeof serverUrl !== 'string') {
      return res.status(400).json({ success: false, error: '请提供服务器地址' });
    }

    const baseUrl = serverUrl.replace(/\/+$/, '');
    const infoUrl = `${baseUrl}/api/info`;
    console.log(`[Tunnel API] Fetching server info from: ${infoUrl}`);

    const response = await fetch(infoUrl);
    if (!response.ok) throw new Error(`服务器返回错误: HTTP ${response.status}`);

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('[Tunnel API] Error fetching server info:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/tunnel/check-name
 * Check if a tunnel name is available on a given server
 *
 * Query: { name, serverUrl }
 */
router.get('/check-name', async (req: Request, res: Response): Promise<any> => {
  try {
    const name = req.query.name as string;
    const serverUrl = req.query.serverUrl as string;

    if (!name) {
      return res.status(400).json({ available: false, reason: '请提供隧道名称' });
    }
    if (!serverUrl) {
      return res.status(400).json({ available: false, reason: '请提供服务器地址' });
    }

    const result = await tunnelService.checkTunnelName(name, serverUrl);
    res.json(result);
  } catch (error) {
    console.error('[Tunnel API] Error checking name:', error);
    res.status(500).json({
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// Per-tunnel operations (by :id)
// =============================================================================

/**
 * GET /api/tunnel/:id/status
 */
router.get('/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const status = tunnelService.getStatus(req.params.id);
    if (!status) return res.status(404).json({ error: '隧道不存在' });
    res.json(status);
  } catch (error) {
    console.error('[Tunnel API] Error getting status:', error);
    res.status(500).json({ error: 'Failed to get tunnel status' });
  }
});

/**
 * GET /api/tunnel/:id/config
 */
router.get('/:id/config', async (req: Request, res: Response): Promise<any> => {
  try {
    const config = tunnelService.getConfig(req.params.id);
    if (!config) return res.status(404).json({ error: '隧道不存在' });
    res.json(config);
  } catch (error) {
    console.error('[Tunnel API] Error getting config:', error);
    res.status(500).json({ error: 'Failed to get tunnel config' });
  }
});

/**
 * PUT /api/tunnel/:id/config
 * Update tunnel configuration
 */
router.put('/:id/config', async (req: Request, res: Response): Promise<any> => {
  try {
    const tunnelId = req.params.id;
    const partial: Partial<TunnelConfig> = {};

    if (typeof req.body.label === 'string') partial.label = req.body.label.trim();
    if (typeof req.body.enabled === 'boolean') partial.enabled = req.body.enabled;
    if (typeof req.body.serverUrl === 'string' && req.body.serverUrl.trim()) {
      partial.serverUrl = req.body.serverUrl.trim();
    }
    if (typeof req.body.token === 'string') partial.token = req.body.token.trim();
    if (typeof req.body.reconnectInterval === 'number' && req.body.reconnectInterval > 0) {
      partial.reconnectInterval = req.body.reconnectInterval;
    }
    if (typeof req.body.maxReconnectAttempts === 'number' && req.body.maxReconnectAttempts >= 0) {
      partial.maxReconnectAttempts = req.body.maxReconnectAttempts;
    }
    if (req.body.protocol === 'https' || req.body.protocol === 'http') {
      partial.protocol = req.body.protocol;
    }
    if (typeof req.body.tunnelName === 'string') partial.tunnelName = req.body.tunnelName.trim();
    if (typeof req.body.websocketUrl === 'string') partial.websocketUrl = req.body.websocketUrl.trim();
    if (typeof req.body.domainSuffix === 'string') partial.domainSuffix = req.body.domainSuffix.trim();

    await tunnelService.saveConfig(tunnelId, partial);

    const shouldReconnect = 'token' in partial || 'serverUrl' in partial;
    const cfg = tunnelService.getConfig(tunnelId)!;
    if (shouldReconnect && cfg.enabled && cfg.token) {
      await tunnelService.connect(tunnelId);
    } else if (partial.enabled === false) {
      tunnelService.disconnect(tunnelId);
    }

    res.json({
      success: true,
      config: tunnelService.getConfig(tunnelId),
      status: tunnelService.getStatus(tunnelId),
    });
  } catch (error) {
    console.error('[Tunnel API] Error updating config:', error);
    res.status(500).json({
      error: 'Failed to update tunnel config',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/tunnel/:id/connect
 */
router.post('/:id/connect', async (req: Request, res: Response): Promise<any> => {
  try {
    const force = req.body?.force === true;
    await tunnelService.connect(req.params.id, force);
    res.json({ success: true, status: tunnelService.getStatus(req.params.id) });
  } catch (error) {
    console.error('[Tunnel API] Error connecting:', error);
    res.status(500).json({
      error: 'Failed to connect tunnel',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/tunnel/:id/disconnect
 */
router.post('/:id/disconnect', async (_req: Request, res: Response): Promise<any> => {
  try {
    tunnelService.disconnect(_req.params.id);
    res.json({ success: true, status: tunnelService.getStatus(_req.params.id) });
  } catch (error) {
    console.error('[Tunnel API] Error disconnecting:', error);
    res.status(500).json({
      error: 'Failed to disconnect tunnel',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * DELETE /api/tunnel/:id
 * Remove tunnel configuration and disconnect if connected
 */
router.delete('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const tunnelId = req.params.id;
    const exists = tunnelService.getStatus(tunnelId);
    if (!exists) return res.status(404).json({ error: '隧道不存在' });

    await tunnelService.removeTunnel(tunnelId);
    res.json({ success: true, message: '隧道已删除' });
  } catch (error) {
    console.error('[Tunnel API] Error deleting tunnel:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// Backward compatibility: old single-tunnel endpoints → first tunnel
// =============================================================================

router.get('/status', async (_req: Request, res: Response): Promise<any> => {
  try {
    const statuses = tunnelService.getAllStatuses();
    if (statuses.length === 0) {
      return res.json({
        enabled: false,
        connected: false,
        domain: null,
        lastError: null,
        connectedAt: null,
        reconnectCount: 0,
        configSource: 'none',
        localPort: 4936,
      });
    }
    const st = statuses[0];
    res.json({ ...st, configSource: 'port-specific' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tunnel status' });
  }
});

router.get('/config', async (_req: Request, res: Response): Promise<any> => {
  try {
    const configs = tunnelService.getAllConfigs();
    if (configs.length === 0) {
      return res.json({
        enabled: false,
        serverUrl: 'https://agentstudio.woa.com',
        token: '',
        tunnelName: '',
        protocol: 'https',
      });
    }
    res.json(configs[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get tunnel config' });
  }
});

router.post('/connect', async (req: Request, res: Response): Promise<any> => {
  try {
    const statuses = tunnelService.getAllStatuses();
    if (statuses.length === 0) return res.status(404).json({ error: '无隧道配置' });
    const force = req.body?.force === true;
    await tunnelService.connect(statuses[0].id, force);
    res.json({ success: true, status: tunnelService.getStatus(statuses[0].id) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect tunnel' });
  }
});

router.post('/disconnect', async (_req: Request, res: Response): Promise<any> => {
  try {
    const statuses = tunnelService.getAllStatuses();
    if (statuses.length === 0) return res.status(404).json({ error: '无隧道配置' });
    tunnelService.disconnect(statuses[0].id);
    res.json({ success: true, status: tunnelService.getStatus(statuses[0].id) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect tunnel' });
  }
});

router.put('/config', async (req: Request, res: Response): Promise<any> => {
  try {
    const configs = tunnelService.getAllConfigs();
    if (configs.length === 0) return res.status(404).json({ error: '无隧道配置' });
    const tunnelId = configs[0].id;

    const partial: Partial<TunnelConfig> = {};
    if (typeof req.body.enabled === 'boolean') partial.enabled = req.body.enabled;
    if (typeof req.body.serverUrl === 'string' && req.body.serverUrl.trim()) {
      partial.serverUrl = req.body.serverUrl.trim();
    }
    if (req.body.protocol === 'https' || req.body.protocol === 'http') {
      partial.protocol = req.body.protocol;
    }

    await tunnelService.saveConfig(tunnelId, partial);

    res.json({
      success: true,
      config: tunnelService.getConfig(tunnelId),
      status: tunnelService.getStatus(tunnelId),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update tunnel config' });
  }
});

router.delete('/config', async (_req: Request, res: Response): Promise<any> => {
  try {
    const configs = tunnelService.getAllConfigs();
    if (configs.length === 0) return res.status(404).json({ error: '无隧道配置' });
    await tunnelService.removeTunnel(configs[0].id);
    res.json({ success: true, message: '隧道配置已删除' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete tunnel config' });
  }
});

export default router;
