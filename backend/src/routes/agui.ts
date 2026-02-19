/**
 * AGUI Routes
 * 
 * Unified AGUI protocol endpoints that work with any registered engine.
 * All endpoints output standardized AGUI events via SSE.
 * 
 * Endpoints:
 * - POST /api/agui/chat - Send message (unified entry point)
 * - GET /api/agui/engines - List available engines
 * - GET /api/agui/engines/:type - Get engine info
 * - POST /api/agui/sessions/:sessionId/interrupt - Interrupt session
 */

import express, { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  engineManager,
  formatAguiEventAsSSE,
  AGUIEventType,
  type EngineType,
  type AGUIEvent,
} from '../engines/index.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';
import { sessionEventBus, type SessionEvent } from '../services/sessionEventBus.js';
import { runOnRunFinishedHook } from '../services/runFinishedHooks.js';
import { AgentStorage } from '../services/agentStorage.js';
import { frontendToolBridge, type FrontendToolRequest } from '../services/frontendTools/index.js';

// Project storage for resolving project names to paths
const projectStorage = new ProjectMetadataStorage();
// Agent storage for reading agent hooks config
const agentStorage = new AgentStorage();

const router: Router = express.Router();

// Simple test route
router.get('/test', (_req, res) => {
  console.log('🔥 [AGUI] /test route hit!');
  res.json({ test: 'ok', engines: engineManager.getRegisteredEngines() });
});

// =============================================================================
// Validation Schemas
// =============================================================================

// Image schema for AGUI requests
const ImageSchema = z.object({
  id: z.string(),
  data: z.string(), // base64 encoded image data (without data URI prefix)
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  filename: z.string().optional(),
});

const FrontendToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }),
  mcpServerName: z.string().optional(),
  resultFormat: z.enum(['json', 'text']).optional(),
});

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  // engineType is deprecated — backend uses its configured default engine.
  // Kept as optional for backward compatibility but ignored for routing.
  engineType: z.enum(['claude', 'cursor', 'codebuddy', 'codex'] as const).optional(),
  workspace: z.string().min(1, 'Workspace is required'),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  images: z.array(ImageSchema).optional(),
  providerId: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
  mcpTools: z.array(z.string()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  frontendTools: z.array(FrontendToolSchema).optional(),
  timeout: z.number().optional(),
  reconnect: z.boolean().optional(),
}).refine(data => {
  if (data.reconnect) return true;
  return data.message.trim().length > 0;
}, {
  message: "Message is required unless reconnecting"
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/agui/engines
 * 
 * List all available engines and their capabilities
 */
router.get('/engines', async (_req, res) => {
  try {
    const engines = engineManager.getRegisteredEngines();
    const capabilities = engineManager.getAllEngineCapabilities();
    const defaultEngine = engineManager.getDefaultEngineType();

    const enginesWithModels = await Promise.all(
      engines.map(async (type) => ({
        type,
        isDefault: type === defaultEngine,
        capabilities: capabilities[type],
        models: await engineManager.getSupportedModels(type),
        activeSessions: engineManager.getActiveSessionCountByEngine()[type],
      }))
    );

    res.json({
      engines: enginesWithModels,
      defaultEngine,
      totalActiveSessions: engineManager.getTotalActiveSessionCount(),
    });
  } catch (error) {
    console.error('[AGUI] Error listing engines:', error);
    res.status(500).json({ error: 'Failed to list engines' });
  }
});

/**
 * GET /api/agui/engines/:type
 * 
 * Get detailed information about a specific engine
 */
router.get('/engines/:type', async (req, res) => {
  try {
    const engineType = req.params.type as EngineType;

    if (!engineManager.hasEngine(engineType)) {
      return res.status(404).json({ error: `Engine not found: ${engineType}` });
    }

    const capabilities = engineManager.getEngineCapabilities(engineType);
    const models = await engineManager.getSupportedModels(engineType);
    const activeSessions = engineManager.getActiveSessionCountByEngine()[engineType];

    res.json({
      type: engineType,
      isDefault: engineType === engineManager.getDefaultEngineType(),
      capabilities,
      models,
      activeSessions,
    });
  } catch (error) {
    console.error('[AGUI] Error getting engine info:', error);
    res.status(500).json({ error: 'Failed to get engine info' });
  }
});

/**
 * POST /api/agui/chat
 * 
 * Send a message using the specified engine.
 * For Claude engine: Proxies to /api/agents/chat and converts output to AGUI format.
 * For Cursor engine: Uses the Cursor Engine directly.
 * Returns AGUI events via Server-Sent Events (SSE).
 */
router.post('/chat', async (req, res) => {
  try {
    // Validate request
    const validation = ChatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: validation.error.issues,
      });
    }

    const {
      message,
      workspace: rawWorkspace,
      sessionId,
      model,
      images,
      providerId,
      permissionMode,
      mcpTools,
      envVars,
      frontendTools,
      timeout,
      reconnect,
    } = validation.data;

    // Use server-configured engine type (ignoring any client-provided engineType)
    const engineType = engineManager.getDefaultEngineType();

    // Resolve workspace: if it's a project name, get the actual path
    let resolvedWorkspace = rawWorkspace;
    if (!path.isAbsolute(rawWorkspace)) {
      // Try to resolve as project name
      const projects = projectStorage.getAllProjects();
      const matchedProject = projects.find(p =>
        p.name === rawWorkspace ||
        p.path.endsWith(`/${rawWorkspace}`) ||
        p.path.endsWith(`\\${rawWorkspace}`)
      );
      if (matchedProject) {
        resolvedWorkspace = matchedProject.path;
        console.log(`📂 [AGUI] Resolved project name "${rawWorkspace}" to path "${resolvedWorkspace}"`);
      } else {
        console.log(`⚠️ [AGUI] Could not resolve project name "${rawWorkspace}", using as-is`);
      }
    }

    console.log(`📤 [AGUI] Chat request via ${engineType} engine (server-configured)`);
    console.log(`   Workspace: ${resolvedWorkspace}`);
    console.log(`   Model: ${model || 'default'}`);
    console.log(`   Session: ${sessionId || 'new'}`);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Flush headers immediately
    res.flushHeaders();

    // Connection state
    let isConnectionClosed = false;

    // Handle client disconnect - use res.on('close') not req.on('close')
    // req.on('close') fires when request body is fully received, not when client disconnects
    res.on('close', () => {
      console.log(`[AGUI] res.on('close') triggered - Client disconnected`);
      isConnectionClosed = true;
    });

    res.on('error', (error) => {
      console.error(`[AGUI] res.on('error'):`, error);
      isConnectionClosed = true;
    });

    // Send heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      if (!isConnectionClosed) {
        res.write(': heartbeat\n\n');
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 5000);

    // Track session ID for event bus broadcasting
    let activeSessionId: string | null = sessionId || null;

    // Resolve agent hooks (if an agentId-like identifier is available from the request)
    // For AGUI, we try to find an agent whose hooks should apply.
    // The request body may carry an agentId field (forwarded by the frontend).
    const requestAgentId = (req.body as any)?.agentId as string | undefined;
    const aguiAgent = requestAgentId ? agentStorage.getAgent(requestAgentId) : null;
    const onRunFinishedHook = aguiAgent?.hooks?.onRunFinished;

    // If there's an onRunFinished hook, we intercept RUN_FINISHED so we can
    // execute the hook and emit its events before the run-finished signal.
    let pendingRunFinished: AGUIEvent | null = null;

    // AGUI event callback (used by Cursor engine)
    const onAguiEvent = (event: AGUIEvent) => {
      if (isConnectionClosed) return;

      // Extract session ID from RUN_STARTED event
      if (event.type === AGUIEventType.RUN_STARTED && 'threadId' in event) {
        activeSessionId = (event as any).threadId || activeSessionId;
      }

      // Intercept RUN_FINISHED when an onRunFinished hook is configured
      if (event.type === AGUIEventType.RUN_FINISHED && onRunFinishedHook && resolvedWorkspace) {
        pendingRunFinished = event;
        return; // Don't write yet — will be sent after hook execution
      }

      try {
        res.write(formatAguiEventAsSSE(event));
      } catch (error) {
        console.error('[AGUI] Error writing event:', error);
        isConnectionClosed = true;
      }

      // Also broadcast to observers via event bus
      if (activeSessionId && sessionEventBus.hasObservers(activeSessionId)) {
        sessionEventBus.emit(activeSessionId, event);
      }
    };

    // Set up bridge listener to forward frontend tool invocations as AGUI CUSTOM events
    const bridgeListener = (request: FrontendToolRequest) => {
      if (isConnectionClosed) return;
      if (activeSessionId && request.sessionId !== activeSessionId) return;
      onAguiEvent({
        type: AGUIEventType.CUSTOM,
        name: 'frontend_tool_call',
        data: {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          args: request.args,
          sessionId: request.sessionId,
          agentId: request.agentId,
        },
        timestamp: Date.now(),
      });
    };
    const hasFrontendTools = frontendTools && frontendTools.length > 0;
    if (hasFrontendTools) {
      frontendToolBridge.on('tool_invocation', bridgeListener);
    }

    try {
      if (engineType === 'cursor' || engineType === 'codebuddy' || engineType === 'codex') {
        // Cursor / CodeBuddy / Codex engines: Use directly via AGUI
        const result = await engineManager.sendMessage(
          engineType,
          message,
          {
            type: engineType,
            workspace: resolvedWorkspace,
            sessionId,
            model,
            images,
            permissionMode,
            mcpTools,
            envVars,
            frontendTools,
            timeout,
          },
          onAguiEvent
        );
        console.log(`✅ [AGUI] ${engineType} request completed, sessionId: ${result.sessionId}`);

        // Execute onRunFinished hook (if configured) before sending RUN_FINISHED
        if (pendingRunFinished && onRunFinishedHook && resolvedWorkspace && !isConnectionClosed) {
          try {
            const hookEvents = await runOnRunFinishedHook(onRunFinishedHook, {
              projectPath: resolvedWorkspace,
              agentId: requestAgentId || engineType,
              sessionId: activeSessionId || sessionId,
            });
            for (const hookEvent of hookEvents) {
              res.write(formatAguiEventAsSSE(hookEvent));
            }
          } catch (hookError: any) {
            console.warn(`[onRunFinished hook] Error: ${hookError.message}`);
          }

          // Now send the deferred RUN_FINISHED
          try {
            res.write(formatAguiEventAsSSE(pendingRunFinished));
          } catch (error) {
            console.error('[AGUI] Error writing deferred RUN_FINISHED:', error);
          }
          pendingRunFinished = null;
        }
      } else {
        // Claude engine: Redirect to /api/agents/chat with outputFormat=agui
        // Note: We can't proxy SSE-to-SSE, so we inform the client to use the direct endpoint
        // Send redirect info and close connection
        console.log(`[AGUI] Claude engine requested via /api/agui/chat - sending redirect info`);

        const redirectInfo = {
          type: 'redirect',
          message: 'Please use /api/agents/chat with outputFormat=agui for Claude engine',
          endpoint: '/api/agents/chat',
          params: {
            message,
            agentId: 'claude-code',
            sessionId,
            projectPath: resolvedWorkspace,
            mcpTools,
            permissionMode,
            model,
            claudeVersion: providerId,
            envVars,
            channel: 'web',
            outputFormat: 'agui',
            ...(reconnect ? { reconnect: true } : {}),
          },
        };

        res.write(`event: redirect\ndata: ${JSON.stringify(redirectInfo)}\n\n`);
        console.log(`✅ [AGUI] Claude redirect info sent`);
      }

    } catch (error) {
      console.error('[AGUI] Engine error:', error);

      // Send error event if connection still open
      if (!isConnectionClosed) {
        onAguiEvent({
          type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
          error: error instanceof Error ? error.message : String(error),
          code: 'ENGINE_ERROR',
          timestamp: Date.now(),
        });
      }
    } finally {
      // Clean up
      clearInterval(heartbeatInterval);
      if (hasFrontendTools) {
        frontendToolBridge.off('tool_invocation', bridgeListener);
      }

      if (!isConnectionClosed) {
        res.end();
      }
    }

  } catch (error) {
    console.error('[AGUI] Route error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

/**
 * POST /api/agui/sessions/:sessionId/interrupt
 * 
 * Interrupt an active session
 */
router.post('/sessions/:sessionId/interrupt', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const engineType = engineManager.getDefaultEngineType();

    console.log(`🛑 [AGUI] Interrupt request for session ${sessionId} on ${engineType} engine`);

    await engineManager.interruptSession(engineType, sessionId);

    res.json({
      success: true,
      message: `Session ${sessionId} interrupted`,
    });
  } catch (error) {
    console.error('[AGUI] Error interrupting session:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/agui/health
 * 
 * Health check endpoint (no auth required)
 * Note: This endpoint is public for testing purposes
 */
router.get('/health', (_req, res) => {
  try {
    const status = engineManager.getStatus();
    res.json({
      status: 'ok',
      engines: status.registeredEngines,
      defaultEngine: status.defaultEngine,
      activeSessions: status.totalActiveSessions,
    });
  } catch (error) {
    console.error('[AGUI] Error getting health:', error);
    res.status(500).json({ status: 'error', error: 'Failed to get health' });
  }
});

/**
 * GET /api/agui/status
 * 
 * Get engine layer status
 */
router.get('/status', (_req, res) => {
  try {
    const status = engineManager.getStatus();
    res.json(status);
  } catch (error) {
    console.error('[AGUI] Error getting status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// =============================================================================
// Session Inject API (for Facilitator Agent)
// =============================================================================

/**
 * POST /api/agui/sessions/:sessionId/inject
 * 
 * Inject a message into an existing session as if the owner sent it.
 * Used by Facilitator Agent to send collected requirements to the ChatPanel.
 * 
 * The message is:
 * 1. Broadcast as USER_MESSAGE event to all session observers
 * 2. Sent to the AI engine for processing
 * 3. AI response events are broadcast to all observers
 * 4. Returns JSON result when processing completes
 */
router.post('/sessions/:sessionId/inject', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, sender = 'facilitator-agent', workspace } = req.body as {
      message: string;
      sender?: string;
      workspace?: string;
    };
    const engineType = engineManager.getDefaultEngineType();

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!workspace) {
      return res.status(400).json({ error: 'Workspace is required' });
    }

    console.log(`💉 [AGUI] Inject request for session ${sessionId} from ${sender}`);

    // 1. Broadcast USER_MESSAGE event to all observers
    sessionEventBus.emit(sessionId, {
      type: 'USER_MESSAGE',
      content: message.trim(),
      sender,
      timestamp: Date.now(),
      sessionId,
    });

    // 2. Send to engine and collect events
    const events: AGUIEvent[] = [];
    let resultSessionId = sessionId;

    const onAguiEvent = (event: AGUIEvent) => {
      events.push(event);

      // Extract session ID from RUN_STARTED
      if (event.type === AGUIEventType.RUN_STARTED && 'threadId' in event) {
        resultSessionId = (event as any).threadId || resultSessionId;
      }

      // Broadcast AI response events to observers (and store in history for late subscribers)
      sessionEventBus.emit(sessionId, event);
    };

    // Resolve workspace path
    let resolvedWorkspace = workspace;
    if (!workspace.startsWith('/')) {
      const matchedProject = projectStorage.getAllProjects().find(
        (p: any) => p.name === workspace || p.dirName === workspace
      );
      if (matchedProject) {
        resolvedWorkspace = matchedProject.path;
      }
    }

    // 3. Process with engine
    const result = await engineManager.sendMessage(
      engineType,
      message.trim(),
      {
        type: engineType,
        workspace: resolvedWorkspace,
        sessionId,
      },
      onAguiEvent
    );

    console.log(`✅ [AGUI] Inject completed for session ${sessionId}, events: ${events.length}`);

    res.json({
      success: true,
      sessionId: resultSessionId,
      eventsCount: events.length,
    });

  } catch (error) {
    console.error('[AGUI] Inject error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// Session Observe SSE (for spectators / group chat members)
// =============================================================================

/**
 * GET /api/agui/sessions/:sessionId/observe
 * 
 * Subscribe to a session's event stream as an observer (read-only).
 * Returns SSE stream with both USER_MESSAGE and AI response events.
 * 
 * Used by:
 * - Group chat members to watch the ChatPanel in real-time
 * - Facilitator Agent to see AI responses
 */
router.get('/sessions/:sessionId/observe', (req, res) => {
  const { sessionId } = req.params;
  const clientId = (req.query.clientId as string) || randomUUID();
  const userId = req.headers['x-sandboxproxy-auth-oid'] as string | undefined;

  console.log(`👁️ [AGUI] Observe request for session ${sessionId} from client ${clientId}${userId ? ` user ${userId}` : ''}`);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  let isConnectionClosed = false;

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId, clientId, timestamp: Date.now() })}\n\n`);

  // Subscribe to session events (replay=true allows late-joining browsers to catch up)
  const replay = req.query.replay === 'true';
  const unsubscribe = sessionEventBus.subscribe(sessionId, clientId, (event: SessionEvent) => {
    if (isConnectionClosed) return;

    try {
      if (event.type === 'USER_MESSAGE') {
        // Custom event format for user messages
        res.write(`event: USER_MESSAGE\ndata: ${JSON.stringify(event)}\n\n`);
      } else {
        // Standard AGUI event format
        res.write(formatAguiEventAsSSE(event as AGUIEvent));
      }
    } catch (error) {
      console.error(`[AGUI] Error writing observe event to ${clientId}:`, error);
      isConnectionClosed = true;
    }
  }, { replay });

  // Heartbeat
  const heartbeatInterval = setInterval(() => {
    if (!isConnectionClosed) {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        isConnectionClosed = true;
      }
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 5000);

  // Cleanup on disconnect
  res.on('close', () => {
    console.log(`[AGUI] Observer ${clientId} disconnected from session ${sessionId}`);
    isConnectionClosed = true;
    clearInterval(heartbeatInterval);
    unsubscribe();

  });

  res.on('error', () => {
    isConnectionClosed = true;
    clearInterval(heartbeatInterval);
    unsubscribe();
  });
});

// =============================================================================
// Session Observer Management
// =============================================================================

/**
 * GET /api/agui/sessions/:sessionId/observers
 * 
 * Get the number of observers for a session
 */
router.get('/sessions/:sessionId/observers', (req, res) => {
  const { sessionId } = req.params;
  res.json({
    sessionId,
    observerCount: sessionEventBus.getObserverCount(sessionId),
    hasObservers: sessionEventBus.hasObservers(sessionId),
  });
});

export default router;
