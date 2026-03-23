/**
 * IM Binding Records API
 *
 * CRUD endpoints for locally persisted IM binding records.
 * These records track which IM platforms are bound to which projects.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { imBindingService } from '../services/imBindingService.js';

const router: RouterType = Router();

/**
 * GET /api/im-bindings
 * List all IM binding records. Optionally filter by ?platform=wecom|qqbot|weixin
 */
router.get('/', (_req: Request, res: Response) => {
  const platform = _req.query.platform as string | undefined;
  const bindings = platform
    ? imBindingService.listByPlatform(platform as any)
    : imBindingService.list();
  res.json({ bindings });
});

/**
 * DELETE /api/im-bindings/:botKey
 * Remove a binding record by bot_key.
 */
router.delete('/:botKey', (req: Request, res: Response) => {
  const { botKey } = req.params;
  const removed = imBindingService.remove(botKey);
  if (!removed) {
    return res.status(404).json({ error: '绑定记录不存在' });
  }
  res.json({ success: true });
});

export default router;
