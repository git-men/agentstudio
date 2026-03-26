import express, { Router, Request, Response } from 'express';
import { getHookManager } from '../services/hooks/index.js';
import { getEventTypes, isValidEventType } from '../services/hooks/eventRegistry.js';
import type { HookCreateRequest, HookUpdateRequest } from '../types/platformHooks.js';

const router: express.Router = Router();

function requireManager(res: Response) {
  const manager = getHookManager();
  if (!manager) {
    res.status(503).json({ error: 'hook_system_unavailable', message: 'Platform hook system is not initialized' });
    return null;
  }
  return manager;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_SCOPES = ['global', 'project', 'agent'] as const;
const VALID_FAILURE_POLICIES = ['ignore', 'warn', 'abort'] as const;
const VALID_ACTION_TYPES = ['shell', 'script', 'webhook'] as const;

function validateCreateRequest(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 200) {
    return 'name is required (1-200 characters)';
  }
  if (!body.event || typeof body.event !== 'string') {
    return 'event is required';
  }
  if (!isValidEventType(body.event)) {
    return `Invalid event type "${body.event}". Use GET /api/platform-hooks/events for available types.`;
  }
  if (!body.action || typeof body.action !== 'object') {
    return 'action is required';
  }
  const action = body.action as Record<string, unknown>;
  if (!VALID_ACTION_TYPES.includes(action.type as typeof VALID_ACTION_TYPES[number])) {
    return `Invalid action type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`;
  }
  if (action.type === 'shell' && (!action.command || typeof action.command !== 'string')) {
    return 'action.command is required for shell actions';
  }
  if (action.type === 'script' && (!action.path || typeof action.path !== 'string')) {
    return 'action.path is required for script actions';
  }
  if (action.type === 'webhook') {
    if (!action.url || typeof action.url !== 'string') {
      return 'action.url is required for webhook actions';
    }
    if (!/^https?:\/\//i.test(action.url)) {
      return 'action.url must be a valid HTTP/HTTPS URL';
    }
  }
  if (!body.scope || !VALID_SCOPES.includes(body.scope as typeof VALID_SCOPES[number])) {
    return `scope is required. Must be one of: ${VALID_SCOPES.join(', ')}`;
  }
  if (body.scope === 'project' && !body.projectId) {
    return 'projectId is required when scope is "project"';
  }
  if (body.scope === 'agent' && !body.agentId) {
    return 'agentId is required when scope is "agent"';
  }
  if (body.timeout !== undefined) {
    const t = Number(body.timeout);
    if (isNaN(t) || t < 1000 || t > 1800000) {
      return 'timeout must be between 1000 and 1800000 (1s-30min)';
    }
  }
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (isNaN(p) || p < 0 || p > 100 || !Number.isInteger(p)) {
      return 'priority must be an integer between 0 and 100';
    }
  }
  if (body.failurePolicy !== undefined && !VALID_FAILURE_POLICIES.includes(body.failurePolicy as typeof VALID_FAILURE_POLICIES[number])) {
    return `failurePolicy must be one of: ${VALID_FAILURE_POLICIES.join(', ')}`;
  }
  return null;
}

function validateUpdateRequest(body: Record<string, unknown>): string | null {
  if ('id' in body || 'createdAt' in body) {
    return 'id and createdAt are immutable and cannot be updated';
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length === 0 || body.name.length > 200)) {
    return 'name must be 1-200 characters';
  }
  if (body.event !== undefined && !isValidEventType(body.event as string)) {
    return `Invalid event type "${body.event}"`;
  }
  if (body.timeout !== undefined) {
    const t = Number(body.timeout);
    if (isNaN(t) || t < 1000 || t > 1800000) {
      return 'timeout must be between 1000 and 1800000 (1s-30min)';
    }
  }
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (isNaN(p) || p < 0 || p > 100 || !Number.isInteger(p)) {
      return 'priority must be an integer between 0 and 100';
    }
  }
  return null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/events', async (_req: Request, res: Response): Promise<void> => {
  const events = getEventTypes();
  res.json({ events });
});

router.get('/executions', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const filters: Record<string, unknown> = {};
  if (req.query.hookId) filters.hookId = String(req.query.hookId);
  if (req.query.eventType) filters.eventType = String(req.query.eventType);
  if (req.query.success !== undefined) filters.success = req.query.success === 'true';

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const result = manager.getExecutions(
    filters as { hookId?: string; eventType?: string; success?: boolean },
    limit,
    offset,
  );

  res.json({ ...result, limit, offset });
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const filter: Record<string, unknown> = {};
  if (req.query.scope) filter.scope = String(req.query.scope);
  if (req.query.event) filter.event = String(req.query.event);
  if (req.query.projectId) filter.projectId = String(req.query.projectId);
  if (req.query.enabled !== undefined) filter.enabled = req.query.enabled === 'true';

  const hooks = await manager.listHooks(filter as { scope?: string; event?: string; projectId?: string; enabled?: boolean });
  res.json({ hooks });
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const hook = await manager.getHook(req.params.id);
  if (!hook) {
    res.status(404).json({ error: 'not_found', message: `Hook "${req.params.id}" not found` });
    return;
  }
  res.json({ hook });
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const validationError = validateCreateRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: 'validation_error', message: validationError });
    return;
  }

  const createReq: HookCreateRequest = {
    name: req.body.name,
    enabled: req.body.enabled ?? true,
    event: req.body.event,
    filter: req.body.filter,
    action: req.body.action,
    scope: req.body.scope,
    projectId: req.body.projectId,
    agentId: req.body.agentId,
    timeout: req.body.timeout ?? 30000,
    failurePolicy: req.body.failurePolicy ?? 'warn',
    priority: req.body.priority ?? 10,
    description: req.body.description,
  };

  const hook = await manager.createHook(createReq);
  res.status(201).json({ hook });
});

router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const validationError = validateUpdateRequest(req.body);
  if (validationError) {
    res.status(400).json({ error: 'validation_error', message: validationError });
    return;
  }

  const hook = await manager.updateHook(req.params.id, req.body as HookUpdateRequest);
  if (!hook) {
    res.status(404).json({ error: 'not_found', message: `Hook "${req.params.id}" not found` });
    return;
  }
  res.json({ hook });
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const deleted = await manager.deleteHook(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'not_found', message: `Hook "${req.params.id}" not found` });
    return;
  }
  res.json({ success: true });
});

router.post('/:id/test', async (req: Request, res: Response): Promise<void> => {
  const manager = requireManager(res);
  if (!manager) return;

  const result = await manager.testHook(req.params.id, req.body?.eventOverrides);
  if (!result) {
    res.status(404).json({ error: 'not_found', message: `Hook "${req.params.id}" not found` });
    return;
  }

  res.json({
    hookId: result.hook.id,
    hookName: result.hook.name,
    event: result.event,
    result: result.result,
  });
});

export default router;
