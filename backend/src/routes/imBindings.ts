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
 * PATCH /api/im-bindings/:botKey
 * Update a binding record (name, channels, etc.).
 */
router.patch('/:botKey', (req: Request, res: Response) => {
  const { botKey } = req.params;
  const updates = req.body as Record<string, unknown>;
  const updated = imBindingService.update(botKey, updates);
  if (!updated) {
    return res.status(404).json({ error: '绑定记录不存在' });
  }
  res.json({ success: true, binding: updated });
});

/**
 * POST /api/im-bindings/:botKey/channels
 * Add a channel (chat_id + optional chat_name) to a WeChat Work binding.
 */
router.post('/:botKey/channels', (req: Request, res: Response) => {
  const { botKey } = req.params;
  const { chat_id, chat_name } = req.body;
  if (!chat_id) {
    return res.status(400).json({ error: '缺少 chat_id' });
  }
  const updated = imBindingService.addChannel(botKey, { chat_id, chat_name });
  if (!updated) {
    return res.status(404).json({ error: '绑定记录不存在' });
  }
  res.json({ success: true, binding: updated });
});

/**
 * DELETE /api/im-bindings/:botKey/channels/:chatId
 * Remove a channel from a WeChat Work binding.
 */
router.delete('/:botKey/channels/:chatId', (req: Request, res: Response) => {
  const { botKey, chatId } = req.params;
  const updated = imBindingService.removeChannel(botKey, chatId);
  if (!updated) {
    return res.status(404).json({ error: '绑定记录不存在或 channel 不存在' });
  }
  res.json({ success: true, binding: updated });
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
