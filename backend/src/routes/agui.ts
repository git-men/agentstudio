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
import {
  engineManager,
  initializeEngines,
  formatAguiEventAsSSE,
  AGUIEventType,
  type EngineType,
  type AGUIEvent,
} from '../engines/index.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';

// Project storage for resolving project names to paths
const projectStorage = new ProjectMetadataStorage();

const router: Router = express.Router();

// Initialize engines on module load
try {
  console.log('🚀 [AGUI Router] Initializing engines...');
  initializeEngines();
  console.log('✅ [AGUI Router] Engines initialized');
} catch (error) {
  console.error('❌ [AGUI Router] Failed to initialize engines:', error);
}

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

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  engineType: z.enum(['claude', 'cursor'] as const).optional().default('claude'),
  workspace: z.string().min(1, 'Workspace is required'),
  sessionId: z.string().optional(),
  model: z.string().optional(),
  // Images (for cursor engine, will be saved to workspace and referenced via @path)
  images: z.array(ImageSchema).optional(),
  // Claude-specific options
  providerId: z.string().optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
  mcpTools: z.array(z.string()).optional(),
  envVars: z.record(z.string()).optional(),
  // Cursor-specific options
  timeout: z.number().optional(),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /api/agui/engines
 * 
 * List all available engines and their capabilities
 */
router.get('/engines', (_req, res) => {
  try {
    const engines = engineManager.getRegisteredEngines();
    const capabilities = engineManager.getAllEngineCapabilities();
    const defaultEngine = engineManager.getDefaultEngineType();

    res.json({
      engines: engines.map(type => ({
        type,
        isDefault: type === defaultEngine,
        capabilities: capabilities[type],
        models: engineManager.getSupportedModels(type),
        activeSessions: engineManager.getActiveSessionCountByEngine()[type],
      })),
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
router.get('/engines/:type', (req, res) => {
  try {
    const engineType = req.params.type as EngineType;
    
    if (!engineManager.hasEngine(engineType)) {
      return res.status(404).json({ error: `Engine not found: ${engineType}` });
    }

    const capabilities = engineManager.getEngineCapabilities(engineType);
    const models = engineManager.getSupportedModels(engineType);
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
        details: validation.error.errors,
      });
    }

    const {
      message,
      engineType,
      workspace: rawWorkspace,
      sessionId,
      model,
      images,
      providerId,
      permissionMode,
      mcpTools,
      envVars,
      timeout,
    } = validation.data;

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

    console.log(`📤 [AGUI] Chat request via ${engineType} engine`);
    console.log(`   Workspace: ${resolvedWorkspace}`);
    console.log(`   Model: ${model || 'default'}`);
    console.log(`   Session: ${sessionId || 'new'}`);

    // Validate engine exists
    if (!engineManager.hasEngine(engineType)) {
      return res.status(400).json({ error: `Unknown engine type: ${engineType}` });
    }

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

    // AGUI event callback (used by Cursor engine)
    const onAguiEvent = (event: AGUIEvent) => {
      if (isConnectionClosed) return;

      try {
        res.write(formatAguiEventAsSSE(event));
      } catch (error) {
        console.error('[AGUI] Error writing event:', error);
        isConnectionClosed = true;
      }
    };

    try {
      if (engineType === 'cursor') {
        // Cursor engine: Use directly
        const result = await engineManager.sendMessage(
          engineType,
          message,
          {
            type: engineType,
            workspace: resolvedWorkspace,
            sessionId,
            model,
            images,
            timeout,
          },
          onAguiEvent
        );
        console.log(`✅ [AGUI] Cursor request completed, sessionId: ${result.sessionId}`);
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
    const { engineType = 'claude' } = req.body as { engineType?: EngineType };

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

export default router;
