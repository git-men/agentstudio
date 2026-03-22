/**
 * Enterprise Auth Routes
 *
 * REST endpoints for enterprise identity management.
 * Provides profile query, login initiation, and logout.
 * This is the unified prerequisite for tunnel and IM binding features.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { enterpriseAuthService } from '../services/enterpriseAuthService.js';

const router: RouterType = Router();

/**
 * GET /api/enterprise/profile
 * Get current enterprise auth status and user profile.
 */
router.get('/profile', async (_req: Request, res: Response) => {
  try {
    const profile = enterpriseAuthService.getProfile();
    if (!profile?.token) {
      return res.json({
        authenticated: false,
        message: '未登录企业版',
      });
    }

    res.json({
      authenticated: true,
      userId: profile.userId,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      enterpriseUrl: profile.enterpriseUrl,
      loginAt: profile.loginAt,
      tokenPreview: profile.token.slice(0, 20) + '...',
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * GET /api/enterprise/verify
 * Verify the stored token is still valid.
 */
router.get('/verify', async (_req: Request, res: Response) => {
  try {
    const valid = await enterpriseAuthService.verifyToken();
    const profile = enterpriseAuthService.getProfile();

    res.json({
      authenticated: !!profile?.token,
      valid,
      name: profile?.name,
      email: profile?.email,
      enterpriseUrl: profile?.enterpriseUrl,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/enterprise/auth/start
 * Initiate OAuth login via iOA/TOF.
 * Returns a URL for the user to visit in their browser.
 */
router.post('/auth/start', async (req: Request, res: Response) => {
  try {
    const enterpriseUrl = (
      (req.body.enterprise_url as string) || 'https://tas.woa.com'
    ).replace(/\/+$/, '');

    // Build callback URL
    const publicUrl = process.env.AGENTSTUDIO_PUBLIC_URL;
    let callbackUrl: string;
    if (publicUrl) {
      callbackUrl = `${publicUrl.replace(/\/+$/, '')}/api/auth/enterprise/callback`;
    } else {
      const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
      const host =
        (req.headers['x-forwarded-host'] as string) ||
        req.headers.host ||
        `localhost:${process.env.PORT || '4936'}`;
      callbackUrl = `${proto}://${host}/api/auth/enterprise/callback`;
    }

    const state =
      Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    // Register pending auth state (reuse existing mechanism in auth.ts callback)
    const { registerPendingAuth } = await import(
      '../services/mcpAdmin/tools/enterpriseAuthTools.js'
    );
    registerPendingAuth(state, enterpriseUrl);

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
 * POST /api/enterprise/refresh
 * Refresh the stored JWT token.
 */
router.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const success = await enterpriseAuthService.refreshToken();
    if (success) {
      const profile = enterpriseAuthService.getProfile();
      res.json({
        success: true,
        name: profile?.name,
        tokenPreview: profile?.token?.slice(0, 20) + '...',
      });
    } else {
      res.status(401).json({
        success: false,
        error: '刷新失败，令牌可能已过期，请重新登录',
      });
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * POST /api/enterprise/logout
 * Clear stored enterprise credentials.
 */
router.post('/logout', async (_req: Request, res: Response) => {
  try {
    await enterpriseAuthService.logout();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
