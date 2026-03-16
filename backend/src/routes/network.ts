/**
 * Network Routes
 * 
 * API endpoints for network information (local IP, tunnel status, etc.)
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { getNetworkInfo } from '../utils/networkUtils.js';
import { tunnelService } from '../services/tunnelService.js';

const router: RouterType = Router();

/**
 * GET /api/network-info
 * Get network information including tunnel status and local IPs
 */
router.get('/', async (_req: Request, res: Response): Promise<any> => {
  try {
    // Get first tunnel's status and config (backward compat)
    const allStatuses = tunnelService.getAllStatuses();
    const allConfigs = tunnelService.getAllConfigs();
    const tunnelStatus = allStatuses[0] ?? { enabled: false, connected: false, domain: null };
    const tunnelConfig = allConfigs[0] ?? { serverUrl: '', protocol: 'https', domainSuffix: '', tunnelName: '' };
    
    // Get local network info
    const networkInfo = getNetworkInfo();
    
    // Get backend port from environment
    const port = process.env.PORT || '4936';
    
    // Build full tunnel URL if connected (IM access via subdomain)
    let tunnelUrl: string | null = null;
    let fullDomain: string | null = tunnelStatus.domain;
    
    // Build HTTP proxy URL (web access via path-prefix: {serverUrl}/t/{tunnelName}/)
    let httpProxyUrl: string | null = null;
    
    if (tunnelStatus.connected && tunnelStatus.domain) {
      const protocol = tunnelConfig.protocol || 'https';
      
      // Build full domain with suffix if configured
      if (tunnelConfig.domainSuffix) {
        fullDomain = `${tunnelStatus.domain}${tunnelConfig.domainSuffix}`;
      }
      
      tunnelUrl = `${protocol}://${fullDomain}`;
      
      // Build HTTP proxy URL from the same tunnel config
      if (tunnelConfig.serverUrl && tunnelConfig.tunnelName) {
        const serverBase = tunnelConfig.serverUrl.replace(/\/+$/, '');
        httpProxyUrl = `${serverBase}/t/${tunnelConfig.tunnelName}/`;
      }
    }
    
    res.json({
      tunnel: {
        enabled: tunnelStatus.enabled,
        connected: tunnelStatus.connected,
        domain: fullDomain,
        url: tunnelUrl,
        httpProxyUrl,
      },
      network: {
        hostname: networkInfo.hostname,
        localIPs: networkInfo.localIPs,
        bestLocalIP: networkInfo.bestLocalIP,
        port: parseInt(port),
      },
    });
  } catch (error) {
    console.error('[Network API] Error getting network info:', error);
    res.status(500).json({
      error: 'Failed to get network info',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
