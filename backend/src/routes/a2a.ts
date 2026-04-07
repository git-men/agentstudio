/**
 * A2A Protocol Routes
 *
 * Implements A2A (Agent-to-Agent) protocol HTTP endpoints for external agent communication.
 * Supports multiple engine types: Claude (default), Cursor, Codex, Codex-SDK, CodeBuddy.
 *
 * Endpoints:
 * - GET  /.well-known/agent-card.json - Retrieve Agent Card (discovery)
 * - POST /messages - Send synchronous message
 * - POST /tasks - Create asynchronous task
 * - GET  /tasks/:taskId - Query task status
 * - DELETE /tasks/:taskId - Cancel task
 *
 * All endpoints require API key authentication via Authorization header.
 *
 * Engine Selection (Priority Order):
 * 1. Service-level engine configuration (ENGINE=codex-sdk, cursor-cli, etc.)
 * 2. Agent type naming convention (agentType contains engine name)
 * 3. Default: Claude
 *
 * Non-Claude engines (Cursor, Codex, Codex-SDK, CodeBuddy) all share the
 * same AGUI A2A service path, which delegates to engineManager.sendMessage().
 */

import express, { Router, Response } from 'express';
import { a2aAuth, type A2ARequest } from '../middleware/a2aAuth.js';
import { a2aRateLimiter, a2aStrictRateLimiter } from '../middleware/rateLimiting.js';
import {
  A2AMessageRequestSchema,
  A2ATaskRequestSchema,
  validateSafe,
} from '../schemas/a2a.js';
import { 
  generateAgentCard, 
  generateCursorAgentCard,
  getEngineTypeFromContext,
  type ProjectContext 
} from '../services/a2a/agentCardService.js';
import { agentCardCache } from '../utils/agentCardCache.js';
import { AgentStorage } from '../services/agentStorage.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';
import { taskManager } from '../services/a2a/taskManager.js';
import { a2aHistoryService } from '../services/a2a/a2aHistoryService.js';
import { getTaskExecutor } from '../services/taskExecutor/index.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { sessionManager } from '../services/sessionManager.js';
import { handleSessionManagement, isVisionModel, saveImageToHiddenDir } from '../utils/sessionUtils.js';
import { buildQueryOptions } from '../utils/claudeUtils.js';
import { executeA2AQuery, executeA2AQueryStreaming } from '../services/a2a/a2aQueryService.js';

// Cursor A2A Service imports (kept for backward compatibility)
import {
  executeCursorA2AQuery,
  executeCursorA2AStreaming,
  createUserMessage,
  type CursorA2AMessageParams,
  type CursorA2AConfig,
} from '../services/a2a/cursorA2aService.js';
import { CursorA2AAdapter } from '../engines/cursor/a2aAdapter.js';
// Generic AGUI A2A Service — supports all AGUI engines
import {
  executeAguiA2AQuery,
  executeAguiA2AStreaming,
  generateAguiAgentCard,
  type AguiA2AConfig,
} from '../services/a2a/aguiA2aService.js';
import { isCursorEngine, isCodexEngine, isCodexSdkEngine, isCodebuddyEngine } from '../config/engineConfig.js';
import type { EngineType } from '../engines/types.js';
import { platformEventBus } from '../services/hooks/platformEventBus.js';
import { getHookManager } from '../services/hooks/index.js';
import type { HookEvent } from '../types/platformHooks.js';

const router: Router = express.Router({ mergeParams: true });

// Initialize storage services
const agentStorage = new AgentStorage();
const projectMetadataStorage = new ProjectMetadataStorage();

// ============================================================================
// Engine Type Detection
// ============================================================================

/**
 * Match agentType string to a specific AGUI engine
 */
function matchAgentTypeToEngine(agentType: string): EngineType | null {
  const lower = agentType.toLowerCase();
  const patterns: Array<{ engine: EngineType; match: (s: string) => boolean }> = [
    { engine: 'cursor', match: s => s === 'cursor' || s.startsWith('cursor-') || s.endsWith(':cursor') },
    { engine: 'codex-sdk', match: s => s === 'codex-sdk' || s.startsWith('codex-sdk-') || s.endsWith(':codex-sdk') },
    { engine: 'codex', match: s => s === 'codex' || s.startsWith('codex-') || s.endsWith(':codex') },
    { engine: 'codebuddy', match: s => s === 'codebuddy' || s.startsWith('codebuddy-') || s.endsWith(':codebuddy') },
  ];
  for (const { engine, match } of patterns) {
    if (match(lower)) return engine;
  }
  return null;
}

/** AGUI engine types that bypass the Claude SDK path */
const AGUI_ENGINE_TYPES = new Set<EngineType>(['cursor', 'codex', 'codex-sdk', 'codebuddy']);

function isAguiEngine(type: EngineType): boolean {
  return AGUI_ENGINE_TYPES.has(type);
}

/**
 * Get engine type for an agent
 *
 * Priority:
 * 1. Service-level engine configuration (ENGINE=...)
 * 2. Agent type naming convention
 * 3. Default: 'claude'
 */
function getEngineType(agentType: string): EngineType {
  if (isCursorEngine()) return 'cursor';
  if (isCodexSdkEngine()) return 'codex-sdk';
  if (isCodexEngine()) return 'codex';
  if (isCodebuddyEngine()) return 'codebuddy';

  return matchAgentTypeToEngine(agentType) || 'claude';
}

// ============================================================================
// Error Response Helper
// ============================================================================

/**
 * Format error response with detailed information for debugging
 */
function formatErrorResponse(error: unknown, code: string, defaultMessage: string) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.constructor.name : typeof error;
  
  return {
    error: defaultMessage,
    code,
    details: errorMessage,
    errorType,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Middleware: Apply authentication and rate limiting to all routes
// ============================================================================

// All routes require authentication
router.use(a2aAuth);

// Default rate limiting for all routes
router.use(a2aRateLimiter);

// ============================================================================
// GET /.well-known/agent-card.json - Agent Card Discovery
// ============================================================================

/**
 * Retrieve Agent Card for an agent
 * This is the standard A2A discovery endpoint
 *
 * @route GET /a2a/:a2aAgentId/.well-known/agent-card.json
 * @access Authenticated (API key required)
 * @rateLimit 100 requests/hour per API key
 *
 * @response 200 - Agent Card JSON
 * @response 401 - Unauthorized (invalid/missing API key)
 * @response 404 - Agent not found
 * @response 429 - Rate limit exceeded
 */
/**
 * @swagger
 * /a2a/{a2aAgentId}/.well-known/agent-card.json:
 *   get:
 *     tags: [A2A]
 *     summary: 获取 Agent Card（A2A 发现）
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.get('/.well-known/agent-card.json', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    // Determine engine type from agentType
    const engineType = getEngineType(a2aContext.agentType);
    
    // Get project metadata for project name
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

    let agentCard;

    if (isAguiEngine(engineType)) {
      agentCard = await generateAguiAgentCard(engineType, {
        a2aAgentId: a2aContext.a2aAgentId,
        projectId: a2aContext.projectId,
        projectName,
        workingDirectory: a2aContext.workingDirectory,
        baseUrl,
      });

      console.info(`[A2A] ${engineType} Agent Card generated:`, {
        a2aAgentId: a2aContext.a2aAgentId,
        agentType: a2aContext.agentType,
        engineType,
        skillCount: agentCard.skills.length,
      });
    } else {
      const agentConfig = agentStorage.getAgent(a2aContext.agentType);

      if (!agentConfig) {
        return res.status(404).json({
          error: `Agent '${a2aContext.agentType}' not found`,
          code: 'AGENT_NOT_FOUND',
        });
      }

      agentCard = agentCardCache.get(agentConfig, projectContext);

      if (!agentCard) {
        agentCard = generateAgentCard(agentConfig, projectContext);
        agentCardCache.set(agentConfig, projectContext, agentCard);

        console.info('[A2A] Agent Card generated and cached:', {
          a2aAgentId: a2aContext.a2aAgentId,
          agentType: a2aContext.agentType,
          engineType: 'claude',
          skillCount: agentCard.skills.length,
        });
      } else {
        console.info('[A2A] Agent Card served from cache:', {
          a2aAgentId: a2aContext.a2aAgentId,
          agentType: a2aContext.agentType,
          engineType: 'claude',
        });
      }
    }

    res.json(agentCard);
  } catch (error) {
    console.error('[A2A] Error retrieving agent card:', error);
    res.status(500).json(
      formatErrorResponse(error, 'AGENT_CARD_ERROR', 'Failed to retrieve agent card')
    );
  }
});

// ============================================================================
// POST /messages - Synchronous Message
// ============================================================================

/**
 * Send a synchronous message to an agent
 * The agent processes the message and returns a response immediately
 *
 * @route POST /a2a/:a2aAgentId/messages
 * @access Authenticated (API key required)
 * @rateLimit 100 requests/hour per API key
 *
 * @body {message: string, context?: Record<string, unknown>}
 * @response 200 - Message response
 * @response 400 - Invalid request
 * @response 401 - Unauthorized
 * @response 429 - Rate limit exceeded
 * @response 500 - Processing error
 */
/**
 * @swagger
 * /a2a/{a2aAgentId}/messages:
 *   post:
 *     tags: [A2A]
 *     summary: 同步发送消息（A2A）
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未授权
 *       500:
 *         description: 服务器错误
 */
router.post('/messages', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    // Validate request body
    const validation = validateSafe(A2AMessageRequestSchema, req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: validation.errors,
      });
    }

    const { message, images, sessionId, sessionMode = 'new' } = validation.data;
    const stream = req.query.stream === 'true' || req.headers.accept === 'text/event-stream';
    
    if (images && images.length > 0) {
      console.log(`🖼️ [A2A] Received ${images.length} image(s) with message`);
    }
    
    // Determine engine type based on agentType
    const engineType = getEngineType(a2aContext.agentType);

    console.info('[A2A] Message received:', {
      a2aAgentId: a2aContext.a2aAgentId,
      projectId: a2aContext.projectId,
      agentType: a2aContext.agentType,
      engineType,
      messageLength: message.length,
      sessionId,
      sessionMode,
      stream,
    });

    // ── Hook Interceptor: message.pre_send ────────────────────────────────
    let interceptedMessage = message;
    try {
      const hookManager = getHookManager();
      if (hookManager) {
        const hookEvent: HookEvent = {
          type: 'message.pre_send',
          timestamp: new Date().toISOString(),
          source: 'a2a-route',
          data: {
            message,
            images: images || undefined,
            sender: 'user',
            channel: 'a2a',
          },
          sessionId: sessionId || undefined,
          projectId: a2aContext.projectId,
          agentId: a2aContext.a2aAgentId,
        };

        const evalResult = await hookManager.evaluate(hookEvent);
        console.log('[HookInterceptor] message.pre_send evaluated (a2a):', {
          decision: evalResult.decision,
          evaluatedCount: evalResult.evaluatedCount,
          skippedCount: evalResult.skippedCount,
          totalDuration: evalResult.totalDuration,
        });

        if (evalResult.decision === 'block') {
          return res.status(403).json({
            error: 'Message blocked by hook interceptor',
            decision: 'block',
            reason: evalResult.reason,
            hookId: evalResult.hookId,
            hookName: evalResult.hookName,
          });
        }

        if (evalResult.rewrittenMessage) {
          interceptedMessage = evalResult.rewrittenMessage;
          console.log('[HookInterceptor] Message rewritten by hook interceptor (a2a)');
        }
      }
    } catch (hookError) {
      console.error('[HookInterceptor] Error evaluating message.pre_send hooks (a2a):', hookError);
    }
    // ── End Hook Interceptor ──────────────────────────────────────────────

    // ============================================================================
    // AGUI Engine Handling (Cursor, Codex, Codex-SDK, CodeBuddy)
    // ============================================================================
    if (isAguiEngine(engineType)) {
      console.log(`🔌 [A2A] Using AGUI engine "${engineType}" for agentType: ${a2aContext.agentType}`);

      const a2aMessage = createUserMessage(interceptedMessage, {
        contextId: sessionId,
      });

      const aguiConfig: AguiA2AConfig = {
        engineType,
        workspace: a2aContext.workingDirectory,
        model: req.body.model as string | undefined,
        sessionId,
        timeout: (req.body.timeout as number) || 600000,
        requestId: `a2a-${Date.now()}`,
        contextId: sessionId,
        permissionMode: req.body.permissionMode as string | undefined,
      };

      const startTime = Date.now();

      const emitA2AHookEvent = (type: string, data: Record<string, unknown>) => {
        try {
          const hookEvent: HookEvent = {
            type,
            timestamp: new Date().toISOString(),
            source: 'a2a-adapter',
            data,
            sessionId: sessionId || undefined,
            projectId: a2aContext.projectId || undefined,
            agentId: a2aContext.a2aAgentId || undefined,
          };
          platformEventBus.emit(hookEvent);
        } catch {
          // Never let hook emission disrupt the A2A response
        }
      };

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let isConnectionClosed = false;
        res.on('close', () => { isConnectionClosed = true; });

        const heartbeatInterval = setInterval(() => {
          if (!isConnectionClosed) {
            res.write(': heartbeat\n\n');
          } else {
            clearInterval(heartbeatInterval);
          }
        }, 15000);

        emitA2AHookEvent('run.start', { engine: engineType });

        try {
          const result = await executeAguiA2AStreaming(
            { message: a2aMessage },
            aguiConfig,
            (response) => {
              if (!isConnectionClosed) {
                res.write(CursorA2AAdapter.formatAsSSE(response));
              }
            }
          );

          emitA2AHookEvent('run.end', {
            engine: engineType,
            durationMs: Date.now() - startTime,
          });

          if (!isConnectionClosed) {
            res.write(`data: ${JSON.stringify({ type: 'done', sessionId: result.sessionId, taskId: result.taskId })}\n\n`);
          }

          console.info(`[A2A] ${engineType} streaming completed:`, {
            a2aAgentId: a2aContext.a2aAgentId,
            taskId: result.taskId,
            sessionId: result.sessionId,
            processingTimeMs: Date.now() - startTime,
          });
        } catch (error) {
          emitA2AHookEvent('run.error', {
            engine: engineType,
            error: error instanceof Error ? error.message : String(error),
          });
          console.error(`[A2A] ${engineType} streaming error:`, error);
          if (!isConnectionClosed) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error instanceof Error ? error.message : String(error) })}\n\n`);
          }
        } finally {
          clearInterval(heartbeatInterval);
          if (!isConnectionClosed) {
            res.end();
          }
        }
        return;
      } else {
        emitA2AHookEvent('run.start', { engine: engineType });
        try {
          const result = await executeAguiA2AQuery({ message: a2aMessage }, aguiConfig);
          const processingTimeMs = Date.now() - startTime;

          emitA2AHookEvent('run.end', { engine: engineType, durationMs: processingTimeMs });

          console.info(`[A2A] ${engineType} message processed:`, {
            a2aAgentId: a2aContext.a2aAgentId,
            taskId: result.task.id,
            sessionId: result.sessionId,
            processingTimeMs,
            responseLength: result.responseText.length,
          });

          res.json({
            response: result.responseText || 'No response generated',
            sessionId: result.sessionId,
            metadata: {
              processingTimeMs,
              taskId: result.task.id,
              contextId: result.task.contextId,
              engineType,
            },
          });
        } catch (error) {
          emitA2AHookEvent('run.error', {
            engine: engineType,
            error: error instanceof Error ? error.message : String(error),
          });
          console.error(`[A2A] ${engineType} processing error:`, error);
          throw error;
        }
        return;
      }
    }

    // ============================================================================
    // Claude Engine Handling (default)
    // ============================================================================
    
    // Load agent configuration
    const agentConfig = agentStorage.getAgent(a2aContext.agentType);

    if (!agentConfig) {
      return res.status(404).json({
        error: `Agent '${a2aContext.agentType}' not found`,
        code: 'AGENT_NOT_FOUND',
      });
    }

    if (!agentConfig.enabled) {
      return res.status(403).json({
        error: `Agent '${a2aContext.agentType}' is disabled`,
        code: 'AGENT_DISABLED',
      });
    }

    // Extract MCP tools from agent configuration
    // MCP tools are identified by the naming pattern: mcp__<serverName>__<toolName>
    const mcpTools = (agentConfig.allowedTools || [])
      .filter((tool: any) => tool.enabled && tool.name.startsWith('mcp__'))
      .map((tool: any) => tool.name);

    if (mcpTools.length > 0) {
      console.info('[A2A] MCP tools found:', { mcpTools });
    }

    // Build query options for Claude using the shared utility
    // This automatically handles A2A SDK MCP server integration
    // Model and provider will be resolved by buildQueryOptions using resolveConfig
    // which prioritizes: channel > agent > project > system default
    const { queryOptions } = await buildQueryOptions(
      {
        systemPrompt: agentConfig.systemPrompt || undefined,
        allowedTools: agentConfig.allowedTools || [],
        maxTurns: 30,
        workingDirectory: a2aContext.workingDirectory,
        permissionMode: 'default',
      },
      a2aContext.workingDirectory,
      mcpTools.length > 0 ? mcpTools : undefined, // Pass extracted MCP tools
      undefined, // permissionMode
      undefined, // model - let resolveConfig determine from project/system defaults
      undefined, // claudeVersion - let resolveConfig determine from agent/project/system
      undefined, // defaultEnv
      undefined, // userEnv
      undefined, // sessionIdForAskUser
      undefined, // agentIdForAskUser
      undefined, // a2aStreamEnabled
    );

    // Override specific options for A2A
    // User requested includePartialMessages = false for A2A streaming to get complete messages
    queryOptions.includePartialMessages = false;

    // ============================================================================
    // Image Processing: Handle vision vs non-vision models
    // - Vision model: pass images as base64 inline (default behavior)
    // - Non-vision model: save images to .agentstudio-images/ directory,
    //   provide file paths in message so AI can use MCP tools to read them
    // ============================================================================
    let processedMessage = interceptedMessage;
    let processedImages = images;

    if (images && images.length > 0) {
      const modelId = queryOptions.model || 'sonnet';
      const supportsVision = await isVisionModel(modelId);

      if (!supportsVision) {
        console.log(`⚠️ [A2A] Model '${modelId}' does not support vision, saving ${images.length} image(s) to disk`);
        const imagePaths: string[] = [];

        for (let i = 0; i < images.length; i++) {
          try {
            const imagePath = saveImageToHiddenDir(
              images[i].data,
              images[i].mediaType,
              i + 1,
              a2aContext.workingDirectory
            );
            imagePaths.push(imagePath);
            console.log(`💾 [A2A] Saved image ${i + 1} to: ${imagePath}`);
          } catch (error) {
            console.error(`[A2A] Failed to save image ${i + 1}:`, error);
          }
        }

        // Append image file paths to message for non-vision model
        if (imagePaths.length > 0) {
          const pathInfo = imagePaths.map((p, i) => `图片${i + 1}: @${p}`).join('\n');
          processedMessage = `${interceptedMessage}\n\n以下图片已保存到本地，你可以通过文件路径查看:\n${pathInfo}`;
        }

        // Don't pass base64 images to non-vision model (already saved to disk)
        processedImages = undefined;
      } else {
        console.log(`✅ [A2A] Model '${modelId}' supports vision, passing ${images.length} image(s) inline`);
      }
    }

    const startTime = Date.now();

    // ============================================================================
    // sessionMode='new': Use one-shot Query (no SessionManager/ClaudeSession reuse)
    // ============================================================================
    if (sessionMode === 'new') {
      console.log(`🆕 [A2A] Using one-shot Query mode (sessionMode=new)`);
      
      // Add resume option if sessionId is provided
      if (sessionId) {
        queryOptions.resume = sessionId;
      }

      if (stream) {
        // Streaming Mode (SSE) with one-shot Query
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let capturedSessionId: string | null = null;

        try {
          const result = await executeA2AQueryStreaming(
            processedMessage,
            processedImages, // multimodal images (undefined for non-vision models)
            queryOptions,
            (sdkMessage: SDKMessage) => {
              // Capture session ID
              if ((sdkMessage as any).session_id && !capturedSessionId) {
                capturedSessionId = (sdkMessage as any).session_id;
              }

              const eventData = {
                ...sdkMessage,
                sessionId: capturedSessionId || sessionId,
                timestamp: Date.now(),
              };

              // Write to SSE stream
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);

              // Persist to history (fire and forget for streaming)
              if (capturedSessionId || sessionId) {
                a2aHistoryService.appendEvent(
                  a2aContext.workingDirectory, 
                  capturedSessionId || sessionId!, 
                  eventData
                ).catch(err => console.error('[A2A] Failed to write history event:', err));
              }

              // Check for completion
              if (sdkMessage.type === 'result') {
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
              }
            }
          );

          capturedSessionId = result.sessionId || capturedSessionId;
          res.end();
        } catch (error) {
          console.error('[A2A] Error in one-shot streaming query:', error);
          const errorEvent = {
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          res.end();
        }
      } else {
        // Synchronous Mode with one-shot Query
        try {
          const result = await executeA2AQuery(
            processedMessage,
            processedImages, // multimodal images (undefined for non-vision models)
            queryOptions,
            async (sdkMessage: SDKMessage) => {
              // Persist to history
              const eventData = {
                ...sdkMessage,
                sessionId: sessionId,
                timestamp: Date.now(),
              };
              if (sessionId) {
                try {
                  await a2aHistoryService.appendEvent(a2aContext.workingDirectory, sessionId, eventData);
                } catch (err) {
                  console.error('[A2A] Failed to write history event:', err);
                }
              }
            }
          );

          const processingTimeMs = Date.now() - startTime;

          console.info('[A2A] Message processed successfully (one-shot mode):', {
            a2aAgentId: a2aContext.a2aAgentId,
            processingTimeMs,
            responseLength: result.fullResponse.length,
            tokensUsed: result.tokensUsed,
            sessionId: result.sessionId,
          });

          res.json({
            response: result.fullResponse || 'No response generated',
            sessionId: result.sessionId,
            metadata: {
              processingTimeMs,
              tokensUsed: result.tokensUsed,
            },
          });
        } catch (error) {
          console.error('[A2A] Error in one-shot query:', error);
          throw error;
        }
      }
    } else {
      // ============================================================================
      // sessionMode='reuse': Use ClaudeSession/SessionManager (original behavior)
      // ============================================================================
      console.log(`♻️ [A2A] Using ClaudeSession reuse mode (sessionMode=reuse)`);

      // 构建配置快照用于检测配置变化
      const configSnapshot = {
        model: queryOptions.model,
        claudeVersionId: undefined, // A2A 不使用 claudeVersion
        permissionMode: queryOptions.permissionMode,
        mcpTools: [], // A2A 不使用额外的 MCP 工具
        allowedTools: agentConfig.allowedTools
          .filter((tool: any) => tool.enabled)
          .map((tool: any) => tool.name)
      };

      const { claudeSession, actualSessionId } = await handleSessionManagement(
        a2aContext.agentType,
        sessionId || null,
        a2aContext.workingDirectory,
        queryOptions,
        undefined,  // claudeVersionId
        undefined,  // modelId
        'reuse',
        configSnapshot
      );

      if (stream) {
        // Streaming Mode (SSE) with ClaudeSession
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const messageContent: any[] = [];
        if (processedImages && processedImages.length > 0) {
          for (const img of processedImages) {
            messageContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
          }
        }
        messageContent.push({ type: 'text', text: processedMessage });

        const userMessage = {
          type: 'user',
          message: {
            role: 'user',
            content: messageContent
          }
        };

        try {
          await claudeSession.sendMessage(userMessage, async (sdkMessage: SDKMessage) => {
            const eventData = {
              ...sdkMessage,
              sessionId: actualSessionId,
              timestamp: Date.now(),
            };

            res.write(`data: ${JSON.stringify(eventData)}\n\n`);

            try {
              if (actualSessionId) {
                await a2aHistoryService.appendEvent(a2aContext.workingDirectory, actualSessionId, eventData);
              }
            } catch (err) {
              console.error('[A2A] Failed to write history event:', err);
            }

            if (sdkMessage.type === 'result') {
              res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
              res.end();
            }
          });
        } catch (error) {
          console.error('[A2A] Error in streaming session:', error);
          const errorEvent = {
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          };
          res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
          res.end();
        }
      } else {
        // Synchronous Mode with ClaudeSession
        let fullResponse = '';
        let tokensUsed = 0;

        try {
          await new Promise<void>((resolve, reject) => {
            const syncMessageContent: any[] = [];
            if (processedImages && processedImages.length > 0) {
              for (const img of processedImages) {
                syncMessageContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
              }
            }
            syncMessageContent.push({ type: 'text', text: processedMessage });

            const userMessage = {
              type: 'user',
              message: {
                role: 'user',
                content: syncMessageContent
              }
            };

            claudeSession.sendMessage(userMessage, async (sdkMessage: SDKMessage) => {
              const eventData = {
                ...sdkMessage,
                sessionId: actualSessionId,
                timestamp: Date.now(),
              };
              try {
                if (actualSessionId) {
                  await a2aHistoryService.appendEvent(a2aContext.workingDirectory, actualSessionId, eventData);
                }
              } catch (err) {
                console.error('[A2A] Failed to write history event:', err);
              }

              if (sdkMessage.type === 'assistant' && sdkMessage.message?.content) {
                for (const block of sdkMessage.message.content) {
                  if (block.type === 'text') {
                    fullResponse += block.text;
                  }
                }
              }

              if (sdkMessage.type === 'assistant' && (sdkMessage as any).usage) {
                const usage = (sdkMessage as any).usage;
                tokensUsed = (usage.input_tokens || 0) + (usage.output_tokens || 0);
              }

              const sdkSessionId = (sdkMessage as any).session_id;
              if (sdkSessionId && claudeSession.getClaudeSessionId() !== sdkSessionId) {
                claudeSession.setClaudeSessionId(sdkSessionId);
                sessionManager.confirmSessionId(claudeSession, sdkSessionId);
                console.log(`✅ Confirmed session ${sdkSessionId} for agent: ${a2aContext.agentType}`);
              }

              if (sdkMessage.type === 'result') {
                resolve();
              }
            }).catch((err: any) => {
              reject(err);
            });
          });

          const finalSessionId = claudeSession.getClaudeSessionId();
          const processingTimeMs = Date.now() - startTime;

          console.info('[A2A] Message processed successfully:', {
            a2aAgentId: a2aContext.a2aAgentId,
            processingTimeMs,
            responseLength: fullResponse.length,
            tokensUsed,
            sessionId: finalSessionId,
          });

          res.json({
            response: fullResponse || 'No response generated',
            sessionId: finalSessionId,
            metadata: {
              processingTimeMs,
              tokensUsed,
            },
          });
        } catch (error) {
          console.error('[A2A] Error calling Claude:', error);
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('[A2A] Error processing message:', error);
    if (!res.headersSent) {
      res.status(500).json(
        formatErrorResponse(error, 'MESSAGE_PROCESSING_ERROR', 'Failed to process message')
      );
    }
  }
});

// ============================================================================
// POST /tasks - Create Asynchronous Task
// ============================================================================

/**
 * Create an asynchronous task for long-running operations
 * Returns immediately with task ID for status polling
 *
 * @route POST /a2a/:a2aAgentId/tasks
 * @access Authenticated (API key required)
 * @rateLimit 50 requests/hour per API key (stricter for task creation)
 *
 * @body {message: string, timeout?: number, context?: Record<string, unknown>}
 * @response 202 - Task created (returns task ID and status URL)
 * @response 400 - Invalid request
 * @response 401 - Unauthorized
 * @response 429 - Rate limit exceeded
 * @response 500 - Task creation error
 */
/**
 * @swagger
 * /a2a/{a2aAgentId}/tasks:
 *   post:
 *     tags: [A2A]
 *     summary: 创建异步任务（A2A）
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       202:
 *         description: 已接受
 *       400:
 *         description: 参数错误
 *       401:
 *         description: 未授权
 *       500:
 *         description: 服务器错误
 */
router.post('/tasks', a2aStrictRateLimiter, async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    // Validate request body
    const validation = validateSafe(A2ATaskRequestSchema, req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: validation.errors,
      });
    }

    const { message, timeout, context, pushNotificationConfig } = validation.data;

    console.info('[A2A] Task creation requested:', {
      a2aAgentId: a2aContext.a2aAgentId,
      projectId: a2aContext.projectId,
      agentType: a2aContext.agentType,
      timeout,
      hasWebhook: !!pushNotificationConfig?.url,
    });

    // Create task using TaskManager
    const task = await taskManager.createTask({
      workingDirectory: a2aContext.workingDirectory,
      projectId: a2aContext.projectId,
      agentId: a2aContext.agentType,
      a2aAgentId: a2aContext.a2aAgentId,
      input: {
        message,
        additionalContext: context,
      },
      timeoutMs: timeout,
      pushNotificationConfig,
    });

    // Submit task to executor for actual execution
    try {
      const executor = getTaskExecutor();

      // Load agent configuration to get model info
      const agent = agentStorage.getAgent(a2aContext.agentType);
      if (!agent) {
        throw new Error(`Agent not found: ${a2aContext.agentType}`);
      }

      // Build push notification config for executor
      const executorPushConfig = pushNotificationConfig ? {
        url: pushNotificationConfig.url,
        token: pushNotificationConfig.token,
        authScheme: pushNotificationConfig.authentication?.schemes?.[0],
        authCredentials: pushNotificationConfig.authentication?.credentials,
      } : undefined;

      await executor.submitTask({
        id: task.id,
        type: 'a2a_async',
        agentId: task.agentId,
        projectPath: a2aContext.workingDirectory,
        message,
        timeoutMs: task.timeoutMs,
        modelId: undefined, // Model determined by project/provider configuration
        maxTurns: agent.maxTurns,
        permissionMode: 'bypassPermissions',
        createdAt: task.createdAt,
        pushNotificationConfig: executorPushConfig,
      });

      console.info('[A2A] Task submitted to executor:', {
        taskId: task.id,
        executorMode: executor.getStats().mode,
      });

      // Task successfully submitted - return 202 Accepted
      res.status(202).json({
        taskId: task.id,
        status: task.status,
        checkUrl: `/a2a/${a2aContext.a2aAgentId}/tasks/${task.id}`,
      });
    } catch (executorError) {
      console.error('[A2A] Error submitting task to executor:', executorError);

      // Update task status to failed
      await taskManager.updateTaskStatus(
        a2aContext.workingDirectory,
        task.id,
        'failed',
        {
          errorDetails: {
            message: `Failed to submit task to executor: ${executorError instanceof Error ? executorError.message : String(executorError)}`,
            code: 'EXECUTOR_SUBMISSION_ERROR',
          },
          completedAt: new Date().toISOString(),
        }
      );

      // Return 500 since task submission failed
      // Include task ID so client can still query its (failed) status if needed
      return res.status(500).json({
        error: 'Failed to submit task for execution',
        code: 'EXECUTOR_SUBMISSION_ERROR',
        taskId: task.id,
        checkUrl: `/a2a/${a2aContext.a2aAgentId}/tasks/${task.id}`,
      });
    }
  } catch (error) {
    console.error('[A2A] Error creating task:', error);
    res.status(500).json(
      formatErrorResponse(error, 'TASK_CREATION_ERROR', 'Failed to create task')
    );
  }
});

// ============================================================================
// GET /tasks/:taskId - Query Task Status
// ============================================================================

/**
 * Query the status of an asynchronous task
 *
 * @route GET /a2a/:a2aAgentId/tasks/:taskId
 * @access Authenticated (API key required)
 * @rateLimit 100 requests/hour per API key
 *
 * @response 200 - Task status
 * @response 401 - Unauthorized
 * @response 404 - Task not found
 * @response 429 - Rate limit exceeded
 */
/**
 * @swagger
 * /a2a/{a2aAgentId}/tasks/{taskId}:
 *   get:
 *     tags: [A2A]
 *     summary: 查询异步任务状态
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.get('/tasks/:taskId', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;
    const { taskId } = req.params;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    console.info('[A2A] Task status query:', {
      a2aAgentId: a2aContext.a2aAgentId,
      projectId: a2aContext.projectId,
      taskId,
    });

    // Get task from TaskManager
    const task = await taskManager.getTask(a2aContext.workingDirectory, taskId);

    if (!task) {
      return res.status(404).json({
        error: `Task not found: ${taskId}`,
        code: 'TASK_NOT_FOUND',
      });
    }

    // Build response
    const response: any = {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };

    // Add optional fields if present
    if (task.startedAt) {
      response.startedAt = task.startedAt;
    }

    if (task.completedAt) {
      response.completedAt = task.completedAt;
    }

    if (task.output) {
      response.output = task.output;
    }

    if (task.errorDetails) {
      response.errorDetails = task.errorDetails;
    }

    if ((task as any).progress) {
      response.progress = (task as any).progress;
    }

    // Add progress information for running tasks
    if (task.status === 'running') {
      response.progress = {
        currentStep: 'Processing',
        percentComplete: 50, // TODO: Implement real progress tracking
      };
    }

    res.json(response);
  } catch (error) {
    console.error('[A2A] Error querying task status:', error);
    res.status(500).json(
      formatErrorResponse(error, 'TASK_STATUS_ERROR', 'Failed to query task status')
    );
  }
});

// ============================================================================
// DELETE /tasks/:taskId - Cancel Task
// ============================================================================

/**
 * Cancel a running or pending task
 *
 * @route DELETE /a2a/:a2aAgentId/tasks/:taskId
 * @access Authenticated (API key required)
 * @rateLimit 100 requests/hour per API key
 *
 * @response 200 - Task canceled
 * @response 400 - Task cannot be canceled (already completed/failed)
 * @response 401 - Unauthorized
 * @response 404 - Task not found
 * @response 429 - Rate limit exceeded
 */
/**
 * @swagger
 * /a2a/{a2aAgentId}/tasks/{taskId}:
 *   delete:
 *     tags: [A2A]
 *     summary: 取消异步任务
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.delete('/tasks/:taskId', async (req: A2ARequest, res: Response) => {
  try {
    const { a2aContext } = req;
    const { taskId } = req.params;

    if (!a2aContext) {
      return res.status(500).json({
        error: 'Authentication context missing',
        code: 'AUTH_CONTEXT_MISSING',
      });
    }

    console.info('[A2A] Task cancellation requested:', {
      a2aAgentId: a2aContext.a2aAgentId,
      projectId: a2aContext.projectId,
      taskId,
    });

    // Cancel task using TaskManager
    try {
      const task = await taskManager.cancelTask(a2aContext.workingDirectory, taskId);

      res.json({
        taskId: task.id,
        status: task.status,
        message: 'Task canceled successfully',
      });
    } catch (error: any) {
      // Handle specific error cases
      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: `Task not found: ${taskId}`,
          code: 'TASK_NOT_FOUND',
        });
      }

      if (error.message.includes('Cannot cancel')) {
        return res.status(400).json({
          error: error.message,
          code: 'TASK_CANNOT_BE_CANCELED',
        });
      }

      throw error; // Re-throw for general error handler
    }
  } catch (error) {
    console.error('[A2A] Error canceling task:', error);
    res.status(500).json(
      formatErrorResponse(error, 'TASK_CANCELLATION_ERROR', 'Failed to cancel task')
    );
  }
});

// ============================================================================
// Export Router
// ============================================================================

export default router;
