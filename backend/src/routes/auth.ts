import express, { Request, Response, Router } from 'express';
import { generateToken, verifyToken, shouldRefreshToken } from '../utils/jwt';
import { loadConfig, isPasswordConfigured } from '../config/index';
import {
  resolvePendingAuth,
  storeEnterpriseToken,
} from '../services/mcpAdmin/tools/enterpriseAuthTools.js';
import { enterpriseAuthService } from '../services/enterpriseAuthService.js';

const router: Router = express.Router();

/**
 * GET /api/auth/check-password-required
 * Check if password is required for login
 * Returns whether the system requires a password to authenticate
 */
router.get('/check-password-required', async (req: Request, res: Response) => {
  try {
    const passwordRequired = await isPasswordConfigured();
    res.json({
      success: true,
      passwordRequired,
    });
  } catch (error) {
    console.error('Failed to check password requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check password requirement',
    });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with password and return JWT token
 * If no password is configured, login succeeds without password
 */
router.post('/login', async (req: Request, res: Response) => {
  const { password } = req.body;

  const passwordRequired = await isPasswordConfigured();

  // If no password is configured, allow login without password
  if (!passwordRequired) {
    const token = await generateToken();
    res.json({
      success: true,
      token,
      message: 'Login successful (no password required)',
    });
    return;
  }

  // Password is required but not provided
  if (!password) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  const config = await loadConfig();
  if (password !== config.adminPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  // Generate JWT token
  const token = await generateToken();

  res.json({
    success: true,
    token,
    message: 'Login successful',
  });
});

/**
 * POST /api/auth/verify
 * Verify if a token is valid
 */
router.post('/verify', async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  const payload = await verifyToken(token);

  if (!payload) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
    return;
  }

  res.json({
    valid: true,
    payload,
  });
});

/**
 * POST /api/auth/refresh
 * Refresh an existing token if it's within refresh threshold
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ error: 'Token is required' });
    return;
  }

  const payload = await verifyToken(token);

  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Check if token should be refreshed
  if (!(await shouldRefreshToken(payload))) {
    // Token is still valid and doesn't need refresh
    res.json({
      success: true,
      token: token, // Return existing token
      refreshed: false,
      message: 'Token is still valid',
    });
    return;
  }

  // Generate new token
  const newToken = await generateToken();

  res.json({
    success: true,
    token: newToken,
    refreshed: true,
    message: 'Token refreshed successfully',
  });
});

/**
 * POST /api/auth/logout
 * Logout endpoint (client-side token removal)
 */
router.post('/logout', (req: Request, res: Response) => {
  // With JWT, logout is primarily handled client-side by removing the token
  // This endpoint is provided for consistency and future extensibility
  res.json({
    success: true,
    message: 'Logout successful',
  });
});

/**
 * GET /api/auth/enterprise/callback
 * OAuth callback from AS Enterprise.
 * Receives the token from the redirect, stores it for tunnel/wecom use,
 * and shows a success page to the user.
 */
router.get('/enterprise/callback', async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  const userName = req.query.user_name as string | undefined;
  const userEmail = req.query.user_email as string | undefined;
  const userAvatar = req.query.user_avatar as string | undefined;

  if (error) {
    res.status(400).send(renderCallbackPage(false, `登录失败: ${error}`));
    return;
  }

  if (!token) {
    res.status(400).send(renderCallbackPage(false, '回调中缺少 token 参数'));
    return;
  }

  let enterpriseUrl = '';

  if (state) {
    const pending = resolvePendingAuth(state);
    if (pending) {
      enterpriseUrl = pending.enterpriseUrl;
    }
  }

  // Fallback: extract enterprise URL from Referer header
  if (!enterpriseUrl && req.headers.referer) {
    try {
      const refUrl = new URL(req.headers.referer);
      enterpriseUrl = `${refUrl.protocol}//${refUrl.host}`;
    } catch {
      // ignore
    }
  }

  if (!enterpriseUrl) {
    enterpriseUrl = 'https://tas.woa.com';
  }

  try {
    // Store in both systems for backward compatibility
    await storeEnterpriseToken(enterpriseUrl, token);

    const userInfo = (userName || userEmail)
      ? { name: userName, email: userEmail, avatarUrl: userAvatar }
      : undefined;
    await enterpriseAuthService.login(enterpriseUrl, token, userInfo);

    const displayName = userName || userEmail || '';
    res.send(
      renderCallbackPage(
        true,
        `ClawStudio 企业版登录成功！${displayName ? `欢迎，${displayName}。` : ''}令牌已自动保存到 ClawStudio。`,
      ),
    );
  } catch (err) {
    console.error('[Enterprise Auth Callback] Error storing token:', err);
    res.status(500).send(
      renderCallbackPage(false, `保存令牌失败: ${err instanceof Error ? err.message : String(err)}`),
    );
  }
});

function renderCallbackPage(success: boolean, message: string): string {
  const color = success ? '#10b981' : '#ef4444';
  const icon = success ? '✓' : '✕';
  const autoCloseScript = success
    ? `<script>
  let sec = 10;
  const el = document.getElementById('countdown');
  const t = setInterval(() => {
    sec--;
    if (el) el.textContent = sec;
    if (sec <= 0) { clearInterval(t); window.close(); }
  }, 1000);
</script>`
    : '';
  const hint = success
    ? '此页面将在 <span id="countdown">10</span> 秒后自动关闭'
    : '请返回 ClawStudio 重试';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ClawStudio 企业版认证</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
  .card { text-align: center; padding: 3rem; border-radius: 1rem;
          background: #1e293b; box-shadow: 0 4px 24px rgba(0,0,0,.3); max-width: 420px; }
  .icon { font-size: 3rem; color: ${color}; margin-bottom: 1rem; }
  .msg  { font-size: 1.1rem; line-height: 1.6; }
  .hint { margin-top: 1.5rem; font-size: .85rem; color: #94a3b8; }
</style></head>
<body><div class="card">
  <div class="icon">${icon}</div>
  <div class="msg">${message}</div>
  <div class="hint">${hint}</div>
</div>${autoCloseScript}</body></html>`;
}

export default router;
