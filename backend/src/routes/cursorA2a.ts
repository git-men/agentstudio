/**
 * Cursor A2A Protocol Routes
 *
 * Implements A2A (Agent-to-Agent) protocol HTTP endpoints for Cursor engine.
 * These endpoints follow the A2A specification v0.2.1 and use JSON-RPC 2.0.
 *
 * Endpoints:
 * - GET  /.well-known/agent.json - Retrieve Cursor Agent Card (discovery)
 * - POST / - JSON-RPC 2.0 endpoint for all A2A methods
 *   - message/send - Synchronous message
 *   - message/stream - Streaming message (SSE)
 *
 * All endpoints require API key authentication via Authorization header.
 */

import express, { Router, Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { a2aAuth, type A2ARequest } from '../middleware/a2aAuth.js';
import { a2aRateLimiter } from '../middleware/rateLimiting.js';
import { generateCursorAgentCard, type ProjectContext } from '../services/a2a/agentCardService.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';
import {
  executeCursorA2AQuery,
  executeCursorA2AStreaming,
  createUserMessage,
  type CursorA2AMessageParams,
  type CursorA2AConfig,
} from '../services/a2a/cursorA2aService.js';
import {
  CursorA2AAdapter,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
  type A2AMessage,
  type A2AStreamingResponse,
} from '../engines/cursor/index.js';

const router: Router = express.Router({ mergeParams: true });

// Initialize storage services
const projectMetadataStorage = new ProjectMetadataStorage();

// =============================================================================
// Error Response Helpers
// =============================================================================

/**
 * Create JSON-RPC 2.0 error response
 */
function jsonRpcError(id: string | number | null, code: number, message: string, data?: any) {
  return {
    jsonrpc: '2.0' as const,
    id,
    error: { code, message, data },
  };
}

/**
 * Create JSON-RPC 2.0 success response
 */
function jsonRpcSuccess(id: string | number, result: any) {
  return {
    jsonrpc: '2.0' as const,
    id,
    result,
  };
}

// =============================================================================
// Middleware
// =============================================================================

// Apply authentication and rate limiting
router.use(a2aAuth);
router.use(a2aRateLimiter);

// =============================================================================
// GET /.well-known/agent.json - Cursor Agent Card Discovery
// =============================================================================

/**
 * Retrieve Agent Card for Cursor engine
 * This is the standard A2A discovery endpoint
 *
 * @route GET /a2a/cursor/:a2aAgentId/.well-known/agent.json
 */
router.get('/.well-known/agent.json', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    // Get project metadata
    const projectMetadata = projectMetadataStorage.getProjectMetadata(a2aContext.workingDirectory);
    const projectName = projectMetadata?.name || a2aContext.projectId;

    // Build project context for Agent Card generation
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const projectContext: ProjectContext = {
      projectId: a2aContext.projectId,
      projectName,
      workingDirectory: a2aContext.workingDirectory,
      a2aAgentId: a2aContext.a2aAgentId,
      baseUrl,
    };

    // Generate Cursor Agent Card
    const agentCard = await generateCursorAgentCard(projectContext);

    console.info('[CursorA2A] Agent Card served:', {
      a2aAgentId: a2aContext.a2aAgentId,
      projectId: a2aContext.projectId,
    });

    res.json(agentCard);
  } catch (error) {
    console.error('[CursorA2A] Error retrieving agent card:', error);
    res.status(500).json({
      error: 'Failed to retrieve agent card',
      code: 'AGENT_CARD_ERROR',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// =============================================================================
// POST / - JSON-RPC 2.0 Endpoint
// =============================================================================

/**
 * Main JSON-RPC 2.0 endpoint for A2A methods
 * 
 * Supported methods:
 * - message/send: Synchronous message processing
 * - message/stream: Streaming message processing (returns SSE)
 *
 * @route POST /a2a/cursor/:a2aAgentId/
 */
router.post('/', async (req: A2ARequest, res: Response) => {
  const { a2aContext } = req;
  
  // Validate JSON-RPC request
  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json(jsonRpcError(
      id || null,
      A2A_ERROR_CODES.INVALID_REQUEST,
      'Invalid JSON-RPC version, must be "2.0"'
    ));
  }

  if (!method || typeof method !== 'string') {
    return res.status(400).json(jsonRpcError(
      id || null,
      A2A_ERROR_CODES.INVALID_REQUEST,
      'Method is required'
    ));
  }

  if (!a2aContext) {
    return res.status(500).json(jsonRpcError(
      id,
      A2A_ERROR_CODES.INTERNAL_ERROR,
      'Authentication context missing'
    ));
  }

  console.info('[CursorA2A] Request received:', {
    method,
    a2aAgentId: a2aContext.a2aAgentId,
    projectId: a2aContext.projectId,
    requestId: id,
  });

  try {
    switch (method) {
      case 'message/send':
        await handleMessageSend(req, res, params, id, a2aContext);
        break;

      case 'message/stream':
        await handleMessageStream(req, res, params, id, a2aContext);
        break;

      default:
        res.status(400).json(jsonRpcError(
          id,
          A2A_ERROR_CODES.METHOD_NOT_FOUND,
          `Method not found: ${method}`
        ));
    }
  } catch (error) {
    console.error(`[CursorA2A] Error handling ${method}:`, error);
    
    if (!res.headersSent) {
      res.status(500).json(jsonRpcError(
        id,
        A2A_ERROR_CODES.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error'
      ));
    }
  }
});

// =============================================================================
// Method Handlers
// =============================================================================

/**
 * Handle message/send method (synchronous)
 */
async function handleMessageSend(
  req: A2ARequest,
  res: Response,
  params: any,
  requestId: string | number,
  a2aContext: NonNullable<A2ARequest['a2aContext']>
) {
  // Validate params
  if (!params?.message) {
    return res.status(400).json(jsonRpcError(
      requestId,
      A2A_ERROR_CODES.INVALID_PARAMS,
      'message parameter is required'
    ));
  }

  const message: A2AMessage = params.message;
  const configuration = params.configuration || {};
  const blocking = configuration.blocking !== false; // Default to blocking

  // Extract model from metadata or use default
  const model = params.metadata?.model || 'auto';
  const timeout = params.metadata?.timeout || 600000;

  // Build A2A params
  const a2aParams: CursorA2AMessageParams = {
    message,
    configuration,
    metadata: params.metadata,
  };

  const config: CursorA2AConfig = {
    workspace: a2aContext.workingDirectory,
    model,
    sessionId: message.contextId,
    timeout,
    requestId,
    contextId: message.contextId,
    taskId: message.taskId,
  };

  if (blocking) {
    // Synchronous execution - wait for completion
    const result = await executeCursorA2AQuery(a2aParams, config);
    
    console.info('[CursorA2A] message/send completed:', {
      taskId: result.task.id,
      contextId: result.task.contextId,
      state: result.task.status.state,
      responseLength: result.responseText.length,
    });

    res.json(jsonRpcSuccess(requestId, result.task));
  } else {
    // Non-blocking - return task immediately
    const adapter = new CursorA2AAdapter({
      taskId: config.taskId || uuidv4(),
      contextId: config.contextId || uuidv4(),
      requestId,
    });

    const task = adapter.createTask();
    task.status.state = 'submitted';

    // Start execution in background
    executeCursorA2AQuery(a2aParams, {
      ...config,
      taskId: task.id,
      contextId: task.contextId,
    }).catch(error => {
      console.error(`[CursorA2A] Background task ${task.id} failed:`, error);
    });

    res.json(jsonRpcSuccess(requestId, task));
  }
}

/**
 * Handle message/stream method (SSE streaming)
 */
async function handleMessageStream(
  req: A2ARequest,
  res: Response,
  params: any,
  requestId: string | number,
  a2aContext: NonNullable<A2ARequest['a2aContext']>
) {
  // Validate params
  if (!params?.message) {
    return res.status(400).json(jsonRpcError(
      requestId,
      A2A_ERROR_CODES.INVALID_PARAMS,
      'message parameter is required'
    ));
  }

  const message: A2AMessage = params.message;
  const configuration = params.configuration || {};
  const model = params.metadata?.model || 'auto';
  const timeout = params.metadata?.timeout || 600000;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  let isConnectionClosed = false;

  // Handle client disconnect
  res.on('close', () => {
    console.log('[CursorA2A] Client disconnected from stream');
    isConnectionClosed = true;
  });

  // Heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    if (!isConnectionClosed) {
      res.write(': heartbeat\n\n');
    } else {
      clearInterval(heartbeatInterval);
    }
  }, 15000);

  // Build A2A params
  const a2aParams: CursorA2AMessageParams = {
    message,
    configuration,
    metadata: params.metadata,
  };

  const config: CursorA2AConfig = {
    workspace: a2aContext.workingDirectory,
    model,
    sessionId: message.contextId,
    timeout,
    requestId,
    contextId: message.contextId,
    taskId: message.taskId,
  };

  try {
    const result = await executeCursorA2AStreaming(
      a2aParams,
      config,
      (response: A2AStreamingResponse) => {
        if (!isConnectionClosed) {
          res.write(CursorA2AAdapter.formatAsSSE(response));
        }
      }
    );

    console.info('[CursorA2A] message/stream completed:', {
      taskId: result.taskId,
      contextId: result.contextId,
      sessionId: result.sessionId,
    });

  } catch (error) {
    console.error('[CursorA2A] Streaming error:', error);
    
    if (!isConnectionClosed) {
      const errorResponse = createA2AErrorResponse(
        error instanceof Error ? error.message : 'Streaming error',
        A2A_ERROR_CODES.INTERNAL_ERROR,
        requestId
      );
      res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
    }
  } finally {
    clearInterval(heartbeatInterval);
    if (!isConnectionClosed) {
      res.end();
    }
  }
}

// =============================================================================
// Legacy REST Endpoints (for backwards compatibility)
// =============================================================================

/**
 * POST /messages - Simple message endpoint (REST style)
 * This provides a simpler interface similar to the existing A2A routes
 */
router.post('/messages', async (req: A2ARequest, res: Response) => {
  const { a2aContext } = req;

  if (!a2aContext) {
    return res.status(500).json({
      error: 'Authentication context missing',
      code: 'AUTH_CONTEXT_MISSING',
    });
  }

  const { message, sessionId, model, timeout, stream } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'message is required and must be a string',
      code: 'INVALID_REQUEST',
    });
  }

  console.info('[CursorA2A] REST message received:', {
    a2aAgentId: a2aContext.a2aAgentId,
    messageLength: message.length,
    stream: !!stream,
  });

  // Convert to A2A message format
  const a2aMessage = createUserMessage(message, {
    contextId: sessionId,
  });

  const params: CursorA2AMessageParams = {
    message: a2aMessage,
  };

  const config: CursorA2AConfig = {
    workspace: a2aContext.workingDirectory,
    model: model || 'auto',
    sessionId,
    timeout: timeout || 600000,
    requestId: uuidv4(),
    contextId: sessionId,
  };

  if (stream || req.headers.accept === 'text/event-stream') {
    // Streaming mode
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let isConnectionClosed = false;
    res.on('close', () => { isConnectionClosed = true; });

    try {
      const result = await executeCursorA2AStreaming(
        params,
        config,
        (response) => {
          if (!isConnectionClosed) {
            res.write(CursorA2AAdapter.formatAsSSE(response));
          }
        }
      );

      // Send completion event
      if (!isConnectionClosed) {
        res.write(`data: ${JSON.stringify({ type: 'done', sessionId: result.sessionId })}\n\n`);
        res.end();
      }
    } catch (error) {
      if (!isConnectionClosed) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : String(error) })}\n\n`);
        res.end();
      }
    }
  } else {
    // Synchronous mode
    try {
      const result = await executeCursorA2AQuery(params, config);
      
      res.json({
        response: result.responseText,
        sessionId: result.sessionId,
        task: result.task,
        metadata: {
          taskId: result.task.id,
          contextId: result.task.contextId,
          state: result.task.status.state,
        },
      });
    } catch (error) {
      console.error('[CursorA2A] Error processing message:', error);
      res.status(500).json({
        error: 'Failed to process message',
        code: 'PROCESSING_ERROR',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
});

// =============================================================================
// Export Router
// =============================================================================

export default router;