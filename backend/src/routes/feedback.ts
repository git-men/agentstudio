/**
 * Feedback API Route
 *
 * POST /api/feedback  — submit user feedback with description, images, and logs
 * GET  /api/feedback/status — check COS configuration status
 */

import express, { Router } from 'express';
import os from 'os';
import { execSync } from 'child_process';
import { submitFeedback } from '../services/feedbackService.js';
import { getClaudeCliName } from '../config/engineConfig.js';

const router: Router = express.Router();

const VERSION = process.env.npm_package_version || '0.0.0';

router.post('/', async (req, res) => {
  try {
    const { description, images, frontendLogs, systemInfo } = req.body;

    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: '反馈内容不能为空' });
    }

    if (images && !Array.isArray(images)) {
      return res.status(400).json({ error: '图片格式错误' });
    }

    if (images && images.length > 5) {
      return res.status(400).json({ error: '最多上传5张图片' });
    }

    const resolvedSystemInfo = {
      appVersion: systemInfo?.appVersion || VERSION,
      osVersion: systemInfo?.osVersion || `${os.type()} ${os.release()}`,
      username: systemInfo?.username || 'anonymous',
      platform: systemInfo?.platform || os.platform(),
      nodeVersion: systemInfo?.nodeVersion || process.version,
      engineVersion: systemInfo?.engineVersion || '',
    };

    const result = await submitFeedback({
      description: description.trim(),
      images: (images || []).map((img: any) => ({
        data: img.data || '',
        filename: img.filename || 'screenshot.png',
        mimeType: img.mimeType || 'image/png',
      })),
      frontendLogs: typeof frontendLogs === 'string' ? frontendLogs : '',
      systemInfo: resolvedSystemInfo,
    });

    res.json(result);
  } catch (error) {
    console.error('[Feedback] Submit error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : '提交反馈失败',
    });
  }
});

router.get('/status', async (_req, res) => {
  const { loadConfig } = await import('../config/index.js');
  const config = await loadConfig();
  const cosConfigured = !!(config.feedbackCosSecretId && config.feedbackCosSecretKey);
  res.json({ cosConfigured });
});

router.get('/system-info', (_req, res) => {
  const nodeVersion = process.version;

  let engineVersion = 'unknown';
  try {
    const cliName = getClaudeCliName();
    const raw = execSync(`${cliName} --version`, { timeout: 5000, encoding: 'utf-8' });
    engineVersion = raw.trim().split('\n')[0];
  } catch {
    engineVersion = 'not found';
  }

  res.json({ nodeVersion, engineVersion });
});

export default router;
