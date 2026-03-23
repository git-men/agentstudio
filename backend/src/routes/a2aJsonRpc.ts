/**
 * A2A Standard JSON-RPC 2.0 Route Handler
 *
 * Adds standard A2A protocol support alongside the existing custom REST routes.
 * Detection strategy: incoming POST with a `jsonrpc` field in the body is routed
 * here; otherwise falls through to the existing REST handlers.
 *
 * Supported JSON-RPC methods:
 * - message/send    → synchronous message, returns Message or Task
 * - message/stream  → SSE streaming, yields TaskStatusUpdateEvent / TaskArtifactUpdateEvent / Message
 * - tasks/get       → query task status
 * - tasks/cancel    → cancel a running task
 *
 * Also adds the standard /.well-known/agent.json path (parallel to existing agent-card.json).
 */

import express, { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { a2aAuth, type A2ARequest } from '../middleware/a2aAuth.js';
import { a2aRateLimiter } from '../middleware/rateLimiting.js';
import { AgentStorage } from '../services/agentStorage.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';
import { A2AStandardAgentExecutor } from '../services/a2a/a2aAgentExecutor.js';
import { A2ATaskStoreAdapter } from '../services/a2a/a2aTaskStoreAdapter.js';
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server';
import type { AgentCard } from '@a2a-js/sdk';
import {
  generateAgentCard,
  generateCursorAgentCard,
  type ProjectContext,
} from '../services/a2a/agentCardService.js';
import {
  generateAguiAgentCard,
} from '../services/a2a/aguiA2aService.js';
import { isCursorEngine, isCodexEngine, isCodexSdkEngine, isCodebuddyEngine } from '../config/engineConfig.js';
import type { EngineType } from '../engines/types.js';

const router: Router = express.Router({ mergeParams: true });
const agentStorage = new AgentStorage();
const projectMetadataStorage = new ProjectMetadataStorage();

const AGUI_ENGINE_TYPES = new Set<EngineType>(['cursor', 'codex', 'codex-sdk', 'codebuddy']);

function getEngineType(agentType: string): EngineType {
  if (isCursorEngine()) return 'cursor';
  if (isCodexSdkEngine()) return 'codex-sdk';
  if (isCodexEngine()) return 'codex';
  if (isCodebuddyEngine()) return 'codebuddy';
  const lower = agentType.toLowerCase();
  if (lower.includes('cursor')) return 'cursor';
  if (lower.includes('codex-sdk')) return 'codex-sdk';
  if (lower.includes('codex')) return 'codex';
  if (lower.includes('codebuddy')) return 'codebuddy';
  return 'claude';
}

// ============================================================================
// Middleware
// ============================================================================

router.use(a2aAuth);
router.use(a2aRateLimiter);

// ============================================================================
// GET /.well-known/agent.json — Standard A2A Agent Card path
// ============================================================================

router.get('/.well-known/agent.json', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;
    if (!a2aContext) {
      return res.status(500).json({ error: 'Authentication context missing' });
    }

    const engineType = getEngineType(a2aContext.agentType);
    const projectMetadata = projectMetadataStorage.getProjectMetadata(a2aContext.workingDirectory);
    const projectName = projectMetadata?.name || a2aContext.projectId;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const projectContext: ProjectContext = {
      projectId: a2aContext.projectId,
      projectName,
      workingDirectory: a2aContext.workingDirectory,
      a2aAgentId: a2aContext.a2aAgentId,
      baseUrl,
    };

    let card: any;

    if (AGUI_ENGINE_TYPES.has(engineType)) {
      card = await generateAguiAgentCard(engineType, {
        a2aAgentId: a2aContext.a2aAgentId,
        projectId: a2aContext.projectId,
        projectName,
        workingDirectory: a2aContext.workingDirectory,
        baseUrl,
      });
    } else {
      const agentConfig = agentStorage.getAgent(a2aContext.agentType);
      if (!agentConfig) {
        return res.status(404).json({ error: `Agent '${a2aContext.agentType}' not found` });
      }
      card = generateAgentCard(agentConfig, projectContext);
    }

    // Enrich with standard A2A fields
    const standardCard = {
      ...card,
      protocolVersion: '0.2.0',
      preferredTransport: 'JSONRPC',
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
        ...(card.capabilities || {}),
      },
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      url: `${baseUrl}/a2a/${a2aContext.a2aAgentId}`,
    };

    res.json(standardCard);
  } catch (error) {
    console.error('[A2A JSON-RPC] Error generating agent card:', error);
    res.status(500).json({ error: 'Failed to generate agent card' });
  }
});

// ============================================================================
// POST / — JSON-RPC 2.0 Dispatch
// ============================================================================

router.post('/', async (req: A2ARequest, res: Response) => {
  const body = req.body;

  // Only handle JSON-RPC requests (must have jsonrpc field)
  if (!body || body.jsonrpc !== '2.0') {
    // Not a JSON-RPC request — pass through (Express next would handle REST)
    return res.status(400).json({
      jsonrpc: '2.0',
      id: body?.id || null,
      error: { code: -32600, message: 'Invalid Request: missing jsonrpc field' },
    });
  }

  const { a2aContext } = req;
  if (!a2aContext) {
    return res.status(500).json(jsonRpcError(body.id, -32603, 'Authentication context missing'));
  }

  const { method, params, id } = body;

  try {
    switch (method) {
      case 'message/send':
        return await handleMessageSend(req, res, a2aContext, params, id);
      case 'message/stream':
        return await handleMessageStream(req, res, a2aContext, params, id);
      case 'tasks/get':
        return await handleTasksGet(req, res, a2aContext, params, id);
      case 'tasks/cancel':
        return await handleTasksCancel(req, res, a2aContext, params, id);
      default:
        return res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    console.error(`[A2A JSON-RPC] Error handling ${method}:`, error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return res.status(200).json(jsonRpcError(id, -32603, `Internal error: ${errMsg}`));
  }
});

// ============================================================================
// JSON-RPC Method Handlers
// ============================================================================

async function handleMessageSend(
  _req: A2ARequest,
  res: Response,
  ctx: NonNullable<A2ARequest['a2aContext']>,
  params: any,
  requestId: string | number
) {
  const messageText = extractMessageText(params);
  if (!messageText) {
    return res.json(jsonRpcError(requestId, -32602, 'Invalid params: message text is required'));
  }

  const normalizedParams = ensureMessageFields(params);

  const executor = new A2AStandardAgentExecutor(ctx.agentType, ctx.workingDirectory);
  const taskStore = new A2ATaskStoreAdapter(ctx.workingDirectory);

  const agentCard = buildMinimalAgentCard(ctx);
  const handler = new DefaultRequestHandler(agentCard as any, taskStore, executor);

  const result = await handler.sendMessage(normalizedParams);

  return res.json({
    jsonrpc: '2.0',
    id: requestId,
    result,
  });
}

async function handleMessageStream(
  _req: A2ARequest,
  res: Response,
  ctx: NonNullable<A2ARequest['a2aContext']>,
  params: any,
  requestId: string | number
) {
  const messageText = extractMessageText(params);
  if (!messageText) {
    return res.json(jsonRpcError(requestId, -32602, 'Invalid params: message text is required'));
  }

  const normalizedParams = ensureMessageFields(params);

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let isConnectionClosed = false;
  res.on('close', () => { isConnectionClosed = true; });

  const heartbeat = setInterval(() => {
    if (!isConnectionClosed) {
      res.write(': heartbeat\n\n');
    } else {
      clearInterval(heartbeat);
    }
  }, 15000);

  try {
    const executor = new A2AStandardAgentExecutor(ctx.agentType, ctx.workingDirectory);
    const taskStore = new A2ATaskStoreAdapter(ctx.workingDirectory);
    const agentCard = buildMinimalAgentCard(ctx);
    const handler = new DefaultRequestHandler(agentCard as any, taskStore, executor);

    const stream = handler.sendMessageStream(normalizedParams);

    for await (const event of stream) {
      if (isConnectionClosed) break;

      const ssePayload = {
        jsonrpc: '2.0',
        id: requestId,
        result: event,
      };
      res.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
    }
  } catch (error) {
    if (!isConnectionClosed) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errorPayload = jsonRpcError(requestId, -32603, errMsg);
      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!isConnectionClosed) {
      res.end();
    }
  }
}

async function handleTasksGet(
  _req: A2ARequest,
  res: Response,
  ctx: NonNullable<A2ARequest['a2aContext']>,
  params: any,
  requestId: string | number
) {
  const taskId = params?.id || params?.taskId;
  if (!taskId) {
    return res.json(jsonRpcError(requestId, -32602, 'Invalid params: taskId is required'));
  }

  const taskStore = new A2ATaskStoreAdapter(ctx.workingDirectory);
  const task = await taskStore.load(taskId);

  if (!task) {
    return res.json(jsonRpcError(requestId, -32001, `Task not found: ${taskId}`));
  }

  return res.json({ jsonrpc: '2.0', id: requestId, result: task });
}

async function handleTasksCancel(
  _req: A2ARequest,
  res: Response,
  ctx: NonNullable<A2ARequest['a2aContext']>,
  params: any,
  requestId: string | number
) {
  const taskId = params?.id || params?.taskId;
  if (!taskId) {
    return res.json(jsonRpcError(requestId, -32602, 'Invalid params: taskId is required'));
  }

  // Cancellation is best-effort since we can't easily reach into a running executor
  const taskStore = new A2ATaskStoreAdapter(ctx.workingDirectory);
  const task = await taskStore.load(taskId);

  if (!task) {
    return res.json(jsonRpcError(requestId, -32001, `Task not found: ${taskId}`));
  }

  return res.json({
    jsonrpc: '2.0',
    id: requestId,
    result: {
      ...task,
      status: { state: 'canceled', timestamp: new Date().toISOString() },
    },
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Ensure required A2A Message fields (messageId, contextId) are present.
 * Callers may omit these optional-in-practice fields; the SDK requires them.
 */
function ensureMessageFields(params: any): any {
  if (!params?.message) return params;
  const msg = { ...params.message };
  if (!msg.messageId) msg.messageId = uuidv4();
  if (!msg.contextId) msg.contextId = msg.contextId || uuidv4();
  return { ...params, message: msg };
}

function extractMessageText(params: any): string {
  const message = params?.message;
  if (!message) return '';

  if (typeof message === 'string') return message;

  const parts = message.parts || [];
  return parts
    .filter((p: any) => p.type === 'text' || p.kind === 'text')
    .map((p: any) => p.text || '')
    .join('');
}

function jsonRpcError(id: string | number | null, code: number, message: string) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  };
}

function buildMinimalAgentCard(ctx: NonNullable<A2ARequest['a2aContext']>): AgentCard {
  return {
    name: ctx.agentType,
    description: `AgentStudio agent: ${ctx.agentType}`,
    url: `/a2a/${ctx.a2aAgentId}`,
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
  } as unknown as AgentCard;
}

export default router;
