import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger.js';

const log = logger.child('agents');

import type {
  SDKMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKCompactBoundaryMessage
} from '@anthropic-ai/claude-agent-sdk';
import crudRouter, { globalAgentStorage } from './agentCrud.js';
// getAllProjectsDirs import removed — Claude SDK handles history persistence natively
import { resolvePath } from '../config/paths.js';
import { sessionManager } from '../services/sessionManager';
import { buildQueryOptions } from '../utils/claudeUtils.js';
import { handleSessionManagement, buildUserMessageContent } from '../utils/sessionUtils.js';
import {
  frontendToolBridge,
  notificationChannelManager,
  SSENotificationChannel,
  generateSSEChannelId,
  initFrontendToolsModule,
  isFrontendTool,
} from '../services/frontendTools/index.js';
import { a2aStreamEventEmitter, type A2AStreamStartEvent, type A2AStreamDataEvent, type A2AStreamEndEvent } from '../services/a2a/a2aStreamEvents.js';
import { ClaudeAguiAdapter } from '../engines/claude/aguiAdapter.js';
import { formatAguiEventAsSSE, AGUIEventType, type AGUIEvent } from '../engines/types.js';
import { runOnRunFinishedHook } from '../services/runFinishedHooks.js';
import { sessionEventBus } from '../services/sessionEventBus.js';
import { getHookManager } from '../services/hooks/index.js';
import type { HookEvent } from '../types/platformHooks.js';
import {
  ChatRequestSchema,
  ImageSchema,
} from './agentSchemas.js';

// 类型守卫函数
function isSDKSystemMessage(message: any): message is SDKSystemMessage {
  return message && message.type === 'system';
}

function isSDKResultMessage(message: any): message is SDKResultMessage {
  return message && message.type === 'result';
}

// isSDKPartialAssistantMessage removed - not currently used

function isSDKCompactBoundaryMessage(message: any): message is SDKCompactBoundaryMessage {
  return message && message.type === 'system' && (message as any).subtype === 'compact_boundary';
}

const router: express.Router = express.Router();

// Mount CRUD and session management routes
router.use(crudRouter);

// Helper functions for chat endpoint

/**
 * 设置 SSE 连接管理
 */
function setupSSEConnectionManagement(req: express.Request, res: express.Response, agentId: string) {
  // 连接管理变量
  let isConnectionClosed = false;
  let connectionTimeout: NodeJS.Timeout | null = null;
  let currentRequestId: string | null = null;
  let claudeSession: any; // 会话实例，稍后赋值

  // 安全关闭连接的函数
  const safeCloseConnection = (reason: string) => {
    if (isConnectionClosed) return;

    isConnectionClosed = true;
    log.info(`🔚 Closing SSE connection for agent ${agentId}: ${reason}`);

    // 清理超时定时器
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
      connectionTimeout = null;
    }

    // 清理 Claude 请求回调
    if (currentRequestId && claudeSession) {
      claudeSession.cancelRequest(currentRequestId);
      if (reason === 'request completed') {
        log.info(`✅ Cleaned up Claude request ${currentRequestId}: ${reason}`);
      } else if (reason === 'client disconnected') {
        // 客户端断开（刷新页面、关闭标签页等）：仅移除回调，不立即中断 session
        // 用户可能会刷新后重新连接并复用同一 session
        // 设置延迟中断：如果用户在宽限期内未重新连接，则中断 session 防止资源泄漏
        log.info(`🔌 Client disconnected, detached callback for request ${currentRequestId} (session kept alive with grace period)`);
        const DISCONNECT_GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 分钟宽限期
        setTimeout(() => {
          // 检查 session 是否仍在处理中（说明没有新的客户端接管）
          if (claudeSession && claudeSession.isCurrentlyProcessing() && typeof claudeSession.interrupt === 'function') {
            // If a reconnect happened, replaceActiveCallback() re-inserted a
            // callback (cancelRequest cleared it on disconnect). Skip interrupt.
            if (claudeSession.hasActiveCallback?.()) {
              log.info(`⏰ Grace period expired but session was reconnected for agent ${agentId}, skipping interrupt`);
              return;
            }
            log.info(`⏰ Grace period expired, interrupting orphaned session for agent ${agentId}`);
            claudeSession.interrupt().catch((e: unknown) => {
              log.error(`❌ Failed to interrupt orphaned session:`, e);
            });
          }
        }, DISCONNECT_GRACE_PERIOD_MS);
      } else {
        log.info(`🚫 Cancelled Claude request ${currentRequestId} due to: ${reason}`);
        // 非正常完成且非客户端断开时，中断底层 Claude SDK 进程，防止命令继续在后台执行
        if (typeof claudeSession.interrupt === 'function') {
          claudeSession.interrupt().catch((e: unknown) => {
            log.error(`❌ Failed to interrupt session on disconnect:`, e);
          });
        }
      }
    }

    // 在关闭连接前发送 connection_closed 事件
    // 仅在连接未被销毁且非客户端主动断开时发送（客户端断开时 socket 已关闭，write 会失败）
    if (!res.destroyed && reason !== 'client disconnected') {
      try {
        res.write(`data: ${JSON.stringify({
          type: 'connection_closed',
          reason: reason,
          timestamp: Date.now()
        })}\n\n`);
      } catch (writeError: unknown) {
        log.error('Failed to write connection close event:', writeError);
      }
    }

    try {
      if (!res.destroyed) {
        res.end();
      }
    } catch (endError: unknown) {
      log.error('Failed to end response:', endError);
    }
  };

  // 监听客户端断开连接 - 只在响应阶段监听
  res.on('close', () => {
    if (!isConnectionClosed) {
      safeCloseConnection('client disconnected');
    }
  });

  // 监听请求完成
  req.on('end', () => {
    log.info('📤 Request data received completely');
  });

  // 监听连接错误
  req.on('error', (error) => {
    log.error('SSE request error:', error);
    safeCloseConnection(`request error: ${error.message}`);
  });

  // 监听响应错误
  res.on('error', (error) => {
    log.error('SSE response error:', error);
    safeCloseConnection(`response error: ${error.message}`);
  });

  // 设置连接超时保护（300分钟）
  const CONNECTION_TIMEOUT_MS = 300 * 60 * 1000;
  connectionTimeout = setTimeout(() => {
    safeCloseConnection('connection timeout');
  }, CONNECTION_TIMEOUT_MS);

  return {
    isConnectionClosed: () => isConnectionClosed,
    safeCloseConnection,
    setCurrentRequestId: (id: string | null) => { currentRequestId = id; },
    setClaudeSession: (session: any) => { claudeSession = session; }
  };
}

// POST /api/agents/chat - Agent-based AI chat using Claude Code SDK with session management
router.post('/chat', async (req, res) => {
  // 重试逻辑：最多重试1次
  let retryCount = 0;
  const MAX_RETRIES = 1;

  // Hoisted reference to the AGUI safety net so it's accessible from the outer catch block
  let _ensureAguiRunFinished: () => void = () => {};

  try {
    log.info('Chat request received:', req.body);

    // 输出当前Session Manager的状态
    log.info('📊 SessionManager状态 - 收到/chat消息时:');
    log.info(`   活跃会话总数: ${sessionManager.getActiveSessionCount()}`);
    const sessionsInfo = sessionManager.getSessionsInfo();
    log.info('   会话详情:');
    sessionsInfo.forEach(session => {
      log.info(`     - SessionId: ${session.sessionId}`);
      log.info(`       AgentId: ${session.agentId}`);
      log.info(`       状态: ${session.status}`);
      log.info(`       是否活跃: ${session.isActive}`);
      log.info(`       空闲时间: ${Math.round(session.idleTimeMs / 1000)}秒`);
      log.info(`       最后活动: ${new Date(session.lastActivity).toISOString()}`);
    });

    // 验证请求数据
    const validation = ChatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      log.info('Validation failed:', validation.error);
      return res.status(400).json({ error: 'Invalid request body', details: validation.error });
    }

    let { message, images, agentId, sessionId: initialSessionId, projectPath, mcpTools, permissionMode, model, claudeVersion, channel, envVars, outputFormat, reconnect, frontendTools, context: requestContext } = validation.data;
    const environmentContext = requestContext?.environmentContext;
    let sessionId = initialSessionId;
    
    log.info(`📡 Output format: ${outputFormat}`);

    // Broadcast an AGUI event to session observers via sessionEventBus
    const broadcastToObservers = (event: AGUIEvent, sid: string | null | undefined) => {
      if (sid && sessionEventBus.hasObservers(sid)) {
        sessionEventBus.emit(sid, event);
      }
    };

    log.info('[Backend] Received chat request:', {
      agentId,
      sessionId,
      reconnect: !!reconnect,
      envVarsKeys: envVars ? Object.keys(envVars) : [],
      envVars
    });

    // ── Reconnect branch: re-attach to an in-progress SSE stream ──────────
    if (reconnect && sessionId) {
      log.info(`🔄 [Reconnect] Attempting to re-attach to session: ${sessionId}`);

      const claudeSession = sessionManager.getSession(sessionId);
      if (!claudeSession || !claudeSession.isSessionActive()) {
        log.info(`❌ [Reconnect] Session ${sessionId} is not active`);
        return res.status(404).json({ error: 'Session not found or not active' });
      }

      if (!claudeSession.isCurrentlyProcessing()) {
        log.info(`ℹ️ [Reconnect] Session ${sessionId} is active but not processing`);
        return res.status(409).json({ reconnected: false, reason: 'not_processing' });
      }

      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
      res.flushHeaders();

      let isReconnectClosed = false;

      // Register an SSE notification channel for the reconnected client so that
      // frontend tool invocation events can be delivered.
      const reconnectChannelId = generateSSEChannelId();
      const reconnectChannel = new SSENotificationChannel(
        reconnectChannelId,
        sessionId,
        agentId,
        res,
        () => {
          notificationChannelManager.unregisterChannel(reconnectChannelId);

          const rcSession = sessionManager.getSession(sessionId!);
          if (rcSession && rcSession.isCurrentlyProcessing()) {
            // Keep pending tool calls alive — a subsequent reconnect may replay them.
          } else {
            frontendToolBridge.cancelBySession(sessionId!, 'SSE connection closed');
          }
        }
      );
      notificationChannelManager.registerChannel(reconnectChannel);

      res.on('close', () => { isReconnectClosed = true; });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        if (isReconnectClosed) { clearInterval(heartbeat); return; }
        try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
      }, 5000);

      // Send SESSION_RESUMED event so the frontend knows reconnection succeeded
      const sessionResumedEvent = {
        type: 'SESSION_RESUMED',
        sessionId,
        agentId,
        timestamp: Date.now(),
      };
      try {
        res.write(`data: ${JSON.stringify(sessionResumedEvent)}\n\n`);
      } catch { /* connection already dead */ }

      // Re-send any pending frontend tool calls as standard TOOL_CALL events
      const pendingCalls = frontendToolBridge.getPendingBySession(sessionId);
      if (pendingCalls.length > 0) {
        for (const request of pendingCalls) {
          try {
            if (!isReconnectClosed) {
              const now = Date.now();
              res.write(`data: ${JSON.stringify({ type: 'TOOL_CALL_START', toolCallId: request.toolCallId, toolCallName: request.toolName, timestamp: now })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'TOOL_CALL_ARGS',  toolCallId: request.toolCallId, delta: JSON.stringify(request.args), timestamp: now })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'TOOL_CALL_END',   toolCallId: request.toolCallId, timestamp: now })}\n\n`);
            }
          } catch { /* connection gone */ }
        }
      }

      const writeReconnectAgui = (event: AGUIEvent, sid?: string | null) => {
        res.write(formatAguiEventAsSSE(event));
        broadcastToObservers(event, sid);
      };

      // AGUI adapter for reconnect (if using AGUI output)
      let aguiReconnectAdapter: ClaudeAguiAdapter | null = null;
      if (outputFormat === 'agui') {
        aguiReconnectAdapter = new ClaudeAguiAdapter(sessionId);
        // Send RUN_STARTED so frontend treats this as an active run
        const runStartedEvent = aguiReconnectAdapter.createRunStarted({ message: '(reconnected)', projectPath });
        try {
          if (!isReconnectClosed) {
            writeReconnectAgui(runStartedEvent, sessionId);
            // Send a synthetic TEXT_MESSAGE_START so the frontend initializes
            // its text block tracking.  Without this, TEXT_MESSAGE_CONTENT events
            // arriving mid-stream won't produce textDelta (aguiState.textBlockIndex
            // stays null) and messageParts never gets a text entry — the UI won't
            // update even though data is being pushed.
            const textStartEvent: AGUIEvent = {
              type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
              messageId: `reconnect-${sessionId}-${Date.now()}`,
              role: 'assistant',
              timestamp: Date.now(),
            };
            writeReconnectAgui(textStartEvent, sessionId);
          }
        } catch { /* connection gone */ }
      }

      // Replace the session's response callback to forward events to this new connection
      const replaced = claudeSession.replaceActiveCallback((sdkMessage: any) => {
        if (isReconnectClosed) return;

        const eventData = {
          ...sdkMessage,
          agentId,
          sessionId,
          timestamp: Date.now(),
        };
        if (sessionId) {
          eventData.session_id = sessionId;
        }

        try {
          if (!res.destroyed && !isReconnectClosed) {
            if (outputFormat === 'agui' && aguiReconnectAdapter) {
              const aguiEvents = aguiReconnectAdapter.convert(sdkMessage);
              for (const event of aguiEvents) {
                writeReconnectAgui(event, sessionId);
              }
            } else {
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);
            }
          }
        } catch (writeError) {
          log.error('[Reconnect] Failed to write SSE data:', writeError);
          isReconnectClosed = true;
        }

        // When result arrives, finalize and close
        if (sdkMessage.type === 'result') {
          if (outputFormat === 'agui' && aguiReconnectAdapter) {
            try {
              const finalEvents = aguiReconnectAdapter.finalize();
              for (const event of finalEvents) {
                if (!res.destroyed && !isReconnectClosed) {
                  writeReconnectAgui(event, sessionId);
                }
              }
            } catch { /* ignore */ }
          }

          clearInterval(heartbeat);
          try { if (!res.destroyed) res.end(); } catch { /* ignore */ }
        }
      });

      if (!replaced) {
        log.info(`❌ [Reconnect] Failed to replace callback for session ${sessionId}`);
        clearInterval(heartbeat);
        try { res.end(); } catch { /* ignore */ }
      } else {
        log.info(`✅ [Reconnect] Successfully re-attached to session ${sessionId}`);
      }

      return; // Don't continue to the normal chat flow
    }
    // ── End reconnect branch ──────────────────────────────────────────────

    // Configure partial message streaming based on channel
    const includePartialMessages = channel === 'web';
    log.info(`📡 Channel: ${channel}, includePartialMessages: ${includePartialMessages}`);

    // 获取 agent 配置
    const agent = globalAgentStorage.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    if (!agent.enabled) {
      return res.status(403).json({ error: 'Agent is disabled' });
    }

    // ── Hook Interceptor: message.pre_send ────────────────────────────────
    try {
      const hookManager = getHookManager();
      if (hookManager) {
        const hookEvent: HookEvent = {
          type: 'message.pre_send',
          timestamp: new Date().toISOString(),
          source: 'agents-route',
          data: {
            message,
            images: images || undefined,
            sender: 'user',
            channel,
          },
          sessionId: sessionId || undefined,
          projectId: projectPath,
          agentId,
        };

        const evalResult = await hookManager.evaluate(hookEvent);
        log.info('[HookInterceptor] message.pre_send evaluated:', {
          decision: evalResult.decision,
          evaluatedCount: evalResult.evaluatedCount,
          skippedCount: evalResult.skippedCount,
          totalDuration: evalResult.totalDuration,
        });

        if (evalResult.decision === 'block') {
          // 422 Unprocessable Entity: request is well-formed but content violates policy
          // (403 would imply an authorization/permission issue, which is semantically wrong here)
          return res.status(422).json({
            error: 'Message blocked by hook interceptor',
            decision: 'block',
            reason: evalResult.reason,
            hookId: evalResult.hookId,
            hookName: evalResult.hookName,
          });
        }

        if (evalResult.rewrittenMessage) {
          message = evalResult.rewrittenMessage;
          log.info('[HookInterceptor] Message rewritten by hook interceptor');
        }
      }
    } catch (hookError) {
      log.error('[HookInterceptor] Error evaluating message.pre_send hooks:', hookError);
    }
    // ── End Hook Interceptor ──────────────────────────────────────────────

    // Resolve onRunFinished hook config from the agent
    const onRunFinishedHook = agent.hooks?.onRunFinished;

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx/proxy buffering
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders(); // Flush headers immediately to start streaming

    // Flush headers immediately to start SSE streaming
    res.flushHeaders();

    // 设置连接管理
    const connectionManager = setupSSEConnectionManagement(req, res, agentId);

    // Write an AGUI event to the client response and broadcast to session observers.
    // Guards (res.destroyed, connectionManager.isConnectionClosed) are the caller's responsibility.
    const writeAguiAndBroadcast = (event: AGUIEvent, sid?: string | null) => {
      res.write(formatAguiEventAsSSE(event));
      broadcastToObservers(event, sid);
    };

    // Safety net: ensure RUN_FINISHED is always sent before connection closes in AGUI mode
    let aguiRunFinishedSent = false;
    const ensureAguiRunFinished = () => {
      if (outputFormat !== 'agui' || aguiRunFinishedSent) return;
      if (res.destroyed || connectionManager.isConnectionClosed()) return;
      try {
        const runFinishedEvent: AGUIEvent = {
          type: AGUIEventType.RUN_FINISHED as AGUIEventType.RUN_FINISHED,
          threadId: sessionId || '',
          runId: '',
          timestamp: Date.now(),
        };
        writeAguiAndBroadcast(runFinishedEvent, sessionId);
        aguiRunFinishedSent = true;
        log.info('🛡️ [Safety Net] Sent RUN_FINISHED before connection close');
      } catch {
        // Connection already gone, nothing we can do
      }
    };
    _ensureAguiRunFinished = ensureAguiRunFinished;

    // Send heartbeat to keep connection alive through proxies
    const heartbeatInterval = setInterval(() => {
      if (!connectionManager.isConnectionClosed()) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeatInterval);
        }
      } else {
        clearInterval(heartbeatInterval);
      }
    }, 5000);

    // Clean up heartbeat when connection closes
    res.on('close', () => {
      clearInterval(heartbeatInterval);
    });

    initFrontendToolsModule();

    const sseChannelId = generateSSEChannelId();
    const tempSessionId = sessionId || `temp_${Date.now()}`;

    const sseChannel = new SSENotificationChannel(
      sseChannelId,
      tempSessionId,
      agentId,
      res,
      () => {
        notificationChannelManager.unregisterChannel(sseChannelId);

        const currentSessionId = sseChannel.sessionId;
        const session = sessionManager.getSession(currentSessionId);
        if (session && session.isCurrentlyProcessing()) {
          // Keep pending tool calls alive — a reconnect may replay them.
        } else {
          frontendToolBridge.cancelBySession(currentSessionId, 'SSE connection closed');
        }
      }
    );
    notificationChannelManager.registerChannel(sseChannel);

    // =================================================================================
    // A2A Stream Event Subscription
    // Subscribe to A2A stream events to forward sessionId to frontend
    // This allows frontend to connect to history stream early for real-time display
    // =================================================================================
    const a2aStreamStartHandler = (event: A2AStreamStartEvent) => {
      // Only forward events for the same project
      if (event.projectId === projectPath) {
        try {
          if (!res.destroyed && !connectionManager.isConnectionClosed()) {
            res.write(`data: ${JSON.stringify({
              type: 'a2a_stream_start',
              sessionId: event.sessionId,
              contextId: event.contextId,  // A2A standard contextId
              taskId: event.taskId,         // A2A standard taskId
              agentUrl: event.agentUrl,
              message: event.message,
              timestamp: event.timestamp,
            })}\n\n`);
          }
        } catch (writeError) {
          log.error('Failed to write A2A stream start event:', writeError);
        }
      }
    };

    const a2aStreamDataHandler = (event: A2AStreamDataEvent) => {
      // Only forward events for the same project
      if (event.projectId === projectPath) {
        try {
          if (!res.destroyed && !connectionManager.isConnectionClosed()) {
            res.write(`data: ${JSON.stringify({
              type: 'a2a_stream_data',
              sessionId: event.sessionId,
              agentUrl: event.agentUrl,  // Agent URL for frontend matching
              event: event.event,  // The actual A2A standard event
              timestamp: event.timestamp,
            })}\n\n`);
          }
        } catch (writeError) {
          log.error('Failed to write A2A stream data event:', writeError);
        }
      }
    };

    const a2aStreamEndHandler = (event: A2AStreamEndEvent) => {
      // Only forward events for the same project
      if (event.projectId === projectPath) {
        try {
          if (!res.destroyed && !connectionManager.isConnectionClosed()) {
            res.write(`data: ${JSON.stringify({
              type: 'a2a_stream_end',
              sessionId: event.sessionId,
              success: event.success,
              error: event.error,
              finalState: event.finalState,  // A2A standard TaskState
              timestamp: event.timestamp,
            })}\n\n`);
          }
        } catch (writeError) {
          log.error('Failed to write A2A stream end event:', writeError);
        }
      }
    };

    // Subscribe to A2A stream events
    a2aStreamEventEmitter.on('a2a_stream_start', a2aStreamStartHandler);
    a2aStreamEventEmitter.on('a2a_stream_data', a2aStreamDataHandler);
    a2aStreamEventEmitter.on('a2a_stream_end', a2aStreamEndHandler);

    // Clean up subscription when connection closes
    res.on('close', () => {
      a2aStreamEventEmitter.off('a2a_stream_start', a2aStreamStartHandler);
      a2aStreamEventEmitter.off('a2a_stream_data', a2aStreamDataHandler);
      a2aStreamEventEmitter.off('a2a_stream_end', a2aStreamEndHandler);
    });
    // =================================================================================

    // 重试循环：处理会话失败的情况
    while (retryCount <= MAX_RETRIES) {
      try {
        log.info(`🔄 Attempt ${retryCount + 1}/${MAX_RETRIES + 1} for session: ${sessionId || 'new'}`);
        const { queryOptions, frontendToolSessionRef } = await buildQueryOptions(agent, projectPath, mcpTools, permissionMode, model, claudeVersion, undefined, envVars, tempSessionId, agentId, true, frontendTools as any);

        // 📊 输出传到 query 中的模型参数
        log.info('📊 [Chat API] QueryOptions 模型参数:');
        log.info(`   请求中的 model 参数: ${model || '(未指定)'}`);
        log.info(`   请求中的 claudeVersion: ${claudeVersion || '(未指定)'}`);
        log.info(`   最终 queryOptions.model: ${queryOptions.model}`);
        log.info(`   queryOptions.pathToClaudeCodeExecutable: ${queryOptions.pathToClaudeCodeExecutable || '(未指定)'}`);
        log.info(`   queryOptions.cwd: ${queryOptions.cwd}`);
        log.info(`   queryOptions.permissionMode: ${queryOptions.permissionMode}`);

        // ⚡ CRITICAL: Add includePartialMessages BEFORE creating session
        // This must be set before handleSessionManagement because ClaudeSession
        // uses these options to configure the Claude SDK query
        queryOptions.includePartialMessages = includePartialMessages;

        // 构建配置快照，用于检测配置变化
        const configSnapshot = {
          model: queryOptions.model,
          claudeVersionId: claudeVersion,
          permissionMode: queryOptions.permissionMode,
          mcpTools: mcpTools || [],
          allowedTools: (agent.allowedTools ?? [])
            .filter((tool: any) => tool.enabled)
            .map((tool: any) => tool.name)
        };
        log.info('📸 [Chat API] Config snapshot:', configSnapshot);

        // 处理会话管理（传入配置快照）
        const { claudeSession, actualSessionId: initialSessionId } = await handleSessionManagement(
          agentId, 
          sessionId || null, 
          projectPath, 
          queryOptions, 
          claudeVersion, 
          model,
          'reuse', // session mode
          configSnapshot
        );
        const actualSessionId = initialSessionId;

        // 📊 输出 Session 初始化后的信息
        log.info('📊 [Chat API] Session 初始化后的信息:');
        log.info(`   Session ID: ${claudeSession.getClaudeSessionId?.() || '(无法获取)'}`);
        log.info(`   actualSessionId: ${actualSessionId || '(新会话)'}`);
        log.info(`   Agent ID: ${agentId}`);
        // 尝试获取 session 的内部配置
        try {
          const sessionOptions = claudeSession.getOptions?.() || claudeSession.options || queryOptions;
          log.info(`   Session 使用的 model: ${sessionOptions?.model || '(未知)'}`);
          log.info(`   Session pathToClaudeCodeExecutable: ${sessionOptions?.pathToClaudeCodeExecutable || '(未知)'}`);
        } catch (e) {
          log.info(`   无法获取 Session 内部配置`);
        }

        // 设置会话到连接管理器
        connectionManager.setClaudeSession(claudeSession);

        // 获取最终的模型名称(从queryOptions中获取,因为buildQueryOptions已经处理了优先级)
        const finalModel = queryOptions.model || 'sonnet';

        // Inject environment context as message prefix (dynamic per-message)
        const messageForAgent = environmentContext
          ? `<environment_context>\n${environmentContext}\n</environment_context>\n\n${message}`
          : message;

        // 构建用户消息(传递claudeVersion以便查询isVision配置)
        const userMessage = await buildUserMessageContent(messageForAgent, images, finalModel, projectPath, claudeVersion);

        // 设置会话标题（使用原始消息，不含 context 前缀）
        claudeSession.setSessionTitle(message);

        // 为这个特定请求创建一个独立的query调用，但复用session context
        const currentSessionId = claudeSession.getClaudeSessionId();

        // 使用会话の sendMessage 方法发送消息
        let compactMessageBuffer: any[] = []; // 缓存 compact 相关消息

        // Initialize AGUI adapter if using AGUI output format
        // NOTE: RUN_STARTED is deferred until the init message arrives with the real session ID.
        let aguiAdapter: ClaudeAguiAdapter | null = null;
        let aguiRunStartedSent = false;
        if (outputFormat === 'agui') {
          aguiAdapter = new ClaudeAguiAdapter(actualSessionId || currentSessionId || undefined);
        }

        // Note: The Claude SDK natively persists messages to ~/.claude/projects/<path>/<session>.jsonl.
        // A SessionHistoryWriter is NO LONGER used here to avoid writing each message twice,
        // which previously caused duplicate messages when loading session history.
        const currentRequestId = await claudeSession.sendMessage(userMessage, async (sdkMessage: SDKMessage) => {
          if (isSDKSystemMessage(sdkMessage) && sdkMessage.subtype === "init") {
            // Log summary only (full message may contain sensitive MCP/env data)
            const initSummary = {
              subtype: sdkMessage.subtype,
              model: (sdkMessage as any).model,
              mcp_servers: (sdkMessage as any).mcp_servers?.map((s: any) => ({ name: s.name, status: s.status })),
              tools_count: (sdkMessage as any).tools?.length,
            };
            log.info('📊 [Chat API] System Init:', JSON.stringify(initSummary));
            
            // 检查 MCP 服务器连接状态
            if (sdkMessage.mcp_servers && Array.isArray(sdkMessage.mcp_servers)) {
              const failedServers = sdkMessage.mcp_servers.filter(
                (s: any) => s.status !== "connected"
              );

              if (failedServers.length > 0) {
                log.warn("🚨 [MCP] Failed to connect MCP servers:", failedServers.map((s: any) => ({
                  name: s.name,
                  status: s.status,
                  error: s.error
                })));

                // 发送 MCP 状态通知给前端
                const mcpStatusEvent = {
                  type: 'mcp_status',
                  subtype: 'connection_failed',
                  failedServers: failedServers,
                  timestamp: Date.now(),
                  agentId: agentId,
                  sessionId: actualSessionId || currentSessionId
                };

                try {
                  if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                    res.write(`data: ${JSON.stringify(mcpStatusEvent)}\n\n`);
                  }
                } catch (writeError: unknown) {
                  log.error('Failed to write MCP status event:', writeError);
                }
              } else {
                // 所有 MCP 服务器连接成功
                const connectedServers = sdkMessage.mcp_servers.filter((s: any) => s.status === "connected");
                if (connectedServers.length > 0) {
                  log.info("✅ [MCP] Successfully connected MCP servers:", connectedServers.map((s: any) => s.name));

                  // 发送成功连接通知给前端
                  const mcpStatusEvent = {
                    type: 'mcp_status',
                    subtype: 'connection_success',
                    connectedServers: connectedServers,
                    timestamp: Date.now(),
                    agentId: agentId,
                    sessionId: actualSessionId || currentSessionId
                  };

                  try {
                    if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                      res.write(`data: ${JSON.stringify(mcpStatusEvent)}\n\n`);
                    }
                  } catch (writeError: unknown) {
                    log.error('Failed to write MCP success event:', writeError);
                  }
                }
              }
            }
          }

          // 🚨 MCP 工具日志观察 - 检查执行错误
          if (isSDKResultMessage(sdkMessage) && sdkMessage.subtype === "error_during_execution") {
            const errorMessage = sdkMessage as any; // 临时类型断言以访问错误详情
            log.error("❌ [MCP] Execution failed:", {
              error: errorMessage.error,
              details: errorMessage.details,
              tool: errorMessage.tool,
              timestamp: Date.now()
            });

            // 发送执行错误通知给前端
            const mcpErrorEvent = {
              type: 'mcp_error',
              subtype: 'execution_failed',
              error: errorMessage.error,
              details: errorMessage.details,
              tool: errorMessage.tool,
              timestamp: Date.now(),
              agentId: agentId,
              sessionId: actualSessionId || currentSessionId
            };

            try {
              if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                res.write(`data: ${JSON.stringify(mcpErrorEvent)}\n\n`);
              }
            } catch (writeError: unknown) {
              log.error('Failed to write MCP error event:', writeError);
            }
          }

          // 🔍 添加详细日志来观察消息结构
          if (message === '/compact') {
            const msgWithContent = sdkMessage as any;  // 临时使用 any 访问 message 属性
            log.info('📦 [COMPACT] Received SDK message:', {
              type: sdkMessage.type,
              subtype: (sdkMessage as any).subtype,
              hasMessage: !!msgWithContent.message,
              messageType: typeof msgWithContent.message,
              messageContentType: msgWithContent.message?.content ? typeof msgWithContent.message.content : 'no content',
              messageContentLength: Array.isArray(msgWithContent.message?.content) ? msgWithContent.message.content.length : 'not array',
              firstBlock: Array.isArray(msgWithContent.message?.content) && msgWithContent.message.content.length > 0
                ? { type: msgWithContent.message.content[0].type, hasText: !!msgWithContent.message.content[0].text, textPreview: msgWithContent.message.content[0].text?.substring(0, 100) }
                : 'no blocks'
            });
          }

          // 🔄 处理自动压缩事件 (auto-compaction)
          // 当上下文窗口接近限制时，SDK 会自动触发压缩，发送 compact_boundary 事件
          // 与手动 /compact 不同，自动压缩需要即时通知前端
          if (message !== '/compact' && isSDKCompactBoundaryMessage(sdkMessage)) {
            const compactMsg = sdkMessage as SDKCompactBoundaryMessage;
            const compactMetadata = (compactMsg as any).compact_metadata;
            log.info('🔄 [AUTO-COMPACT] Detected auto-compaction event:', {
              trigger: compactMetadata?.trigger,
              preTokens: compactMetadata?.pre_tokens,
            });

            try {
              if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                if (outputFormat === 'agui') {
                  // AGUI 模式：使用 CUSTOM 事件类型发送
                  const aguiCustomEvent: AGUIEvent = {
                    type: AGUIEventType.CUSTOM,
                    name: 'auto_compact',
                    data: {
                      trigger: compactMetadata?.trigger || 'auto',
                      preTokens: compactMetadata?.pre_tokens || 0,
                      agentId: agentId,
                      sessionId: actualSessionId || currentSessionId,
                    },
                    timestamp: Date.now(),
                  };
                  writeAguiAndBroadcast(aguiCustomEvent, actualSessionId || currentSessionId);
                } else {
                  // 默认模式：发送自动压缩通知给前端
                  const autoCompactEvent = {
                    type: 'auto_compact',
                    trigger: compactMetadata?.trigger || 'auto',
                    preTokens: compactMetadata?.pre_tokens || 0,
                    agentId: agentId,
                    sessionId: actualSessionId || currentSessionId,
                    timestamp: Date.now(),
                  };
                  res.write(`data: ${JSON.stringify(autoCompactEvent)}\n\n`);
                }
              }
            } catch (writeError: unknown) {
              log.error('Failed to write auto-compact event:', writeError);
            }
            return; // 不继续处理，避免重复发送
          }

          // 处理 /compact 命令的特殊消息序列
          if (message === '/compact' && isSDKCompactBoundaryMessage(sdkMessage)) {
            compactMessageBuffer.push(sdkMessage);
            log.info('📦 [COMPACT] Detected compact_boundary, buffering messages...');
            return; // 不发送给前端，等待完整的消息序列
          }

          // 如果在 compact 模式下，缓存消息直到找到完整序列
          if (compactMessageBuffer.length > 0) {
            compactMessageBuffer.push(sdkMessage);

            // 检查是否有足够的消息来构成完整的 compact 序列
            if (compactMessageBuffer.length >= 5) {
              log.info('📦 [COMPACT] Processing complete compact sequence...');

              // 提取摘要内容（第二个消息应该是 isCompactSummary）
              const summaryMsg = compactMessageBuffer.find(msg => msg.isCompactSummary);
              let compactContent = '会话上下文已压缩';

              if (summaryMsg?.message?.content) {
                if (Array.isArray(summaryMsg.message.content)) {
                  const textBlock = summaryMsg.message.content.find((block: any) => block.type === 'text');
                  compactContent = textBlock?.text || compactContent;
                } else if (typeof summaryMsg.message.content === 'string') {
                  compactContent = summaryMsg.message.content;
                }
              }

              // 创建 compact summary 消息发送给前端
              const compactSummaryMessage = {
                type: 'assistant',
                role: 'assistant',
                content: [
                  {
                    type: 'compactSummary',
                    text: compactContent
                  }
                ],
                agentId: agentId,
                sessionId: actualSessionId || currentSessionId,
                timestamp: Date.now(),
                isCompactSummary: true
              };

              log.info('📦 [COMPACT] Sending compact summary to frontend:', compactContent.substring(0, 100));

              try {
                if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                  res.write(`data: ${JSON.stringify(compactSummaryMessage)}\n\n`);
                }
              } catch (writeError: unknown) {
                log.error('Failed to write compact summary:', writeError);
              }

              // 清空缓存
              compactMessageBuffer = [];
              return; // 不继续处理原始消息
            }
          }

          // 检查连接是否已关闭
          if (connectionManager.isConnectionClosed()) {
            log.info(`⚠️ Skipping response for closed connection, agent: ${agentId}`);
            return;
          }

          // 当收到 init 消息时，确认会话 ID
          const responseSessionId = sdkMessage.session_id;
          if (isSDKSystemMessage(sdkMessage) && sdkMessage.subtype === 'init' && responseSessionId) {
            if (!actualSessionId || !currentSessionId) {
              // 新会话：保存session ID
              claudeSession.setClaudeSessionId(responseSessionId);
              sessionManager.confirmSessionId(claudeSession, responseSessionId, configSnapshot);
              log.info(`✅ Confirmed session ${responseSessionId} for agent: ${agentId}`);

              // When the frontend sent an existing session ID (actualSessionId) but
              // the SDK issued a different ID (responseSessionId), also register an
              // alias so that subsequent requests using the original session ID can
              // still find this session in memory.
              if (actualSessionId && actualSessionId !== responseSessionId) {
                sessionManager.registerSessionAlias(actualSessionId, claudeSession);
                log.info(`🔗 Aliased frontend session ${actualSessionId} → SDK session ${responseSessionId}`);
              }

              if (tempSessionId !== responseSessionId) {
                notificationChannelManager.updateChannelSession(sseChannelId, responseSessionId);
                frontendToolBridge.updateSessionId(tempSessionId, responseSessionId);
                if (frontendToolSessionRef) {
                  frontendToolSessionRef.current = responseSessionId;
                }
              }
            } else if (currentSessionId && responseSessionId !== currentSessionId) {
              // Resume scenario: Claude SDK returned a new session ID (branch).
              // We keep the original sessionId as the public-facing ID so the
              // frontend sees a consistent session. The SDK's internal session ID
              // is stored on the ClaudeSession object for future SDK calls.
              log.info(`🔄 Session resumed: SDK returned ${responseSessionId}, keeping public sessionId as ${currentSessionId} for agent: ${agentId}`);

              // Track the SDK's real session ID internally (do NOT replace the
              // session manager mapping — the session stays indexed under the
              // original sessionId).
              claudeSession.setClaudeSessionId(responseSessionId);
            } else {
              // 继续会话：使用现有session ID
              log.info(`♻️  Continued session ${currentSessionId} for agent: ${agentId}`);
            }

            // 🎯 Deferred RUN_STARTED: now that we have the real session ID from init,
            // update the AGUI adapter's threadId and send RUN_STARTED with the correct ID.
            // Use actualSessionId (original request sessionId) when available so the
            // frontend sees a consistent session ID. For new sessions actualSessionId
            // is null, so we fall back to responseSessionId from the SDK.
            if (outputFormat === 'agui' && aguiAdapter && !aguiRunStartedSent) {
              const aguiThreadId = actualSessionId || responseSessionId;
              aguiAdapter.setThreadId(aguiThreadId);
              const runStartedEvent = aguiAdapter.createRunStarted({ message, projectPath });
              try {
                if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                  writeAguiAndBroadcast(runStartedEvent, actualSessionId || currentSessionId);
                  aguiRunStartedSent = true;
                  log.info(`🚀 [AGUI] Sent deferred RUN_STARTED with threadId: ${aguiThreadId}`);
                }
              } catch (writeError) {
                log.error('Failed to write AGUI RUN_STARTED event:', writeError);
              }
            }
          }

          // 🎯 检测子Agent消息：通过 parent_tool_use_id 字段判断
          const msgAny = sdkMessage as any;
          const isSidechain = !!msgAny.parent_tool_use_id;
          const parentToolUseId = msgAny.parent_tool_use_id;

          if (isSidechain) {
            const contentBlocks = msgAny.message?.content || [];
            const blockTypes = contentBlocks.map((b: any) => b.type);
            log.info('🎯 [SIDECHAIN] Sub-agent message:', {
              type: sdkMessage.type,
              parentToolUseId,
              blockTypes,
              // 如果有文本内容，打印前100字符
              textPreview: contentBlocks.find((b: any) => b.type === 'text')?.text?.substring(0, 100),
            });
          }

          const eventData = {
            ...sdkMessage,
            agentId: agentId,
            sessionId: actualSessionId || responseSessionId || currentSessionId,
            timestamp: Date.now(),
            // 🎯 添加子Agent标识
            isSidechain,
            parentToolUseId,
          };

          // 确保返回的 session_id 字段与 sessionId 一致
          if (actualSessionId || currentSessionId) {
            eventData.session_id = actualSessionId || currentSessionId;
          }

          // Note: SDK message persistence is handled natively by the Claude SDK.
          // Do NOT append here — it would duplicate every message in the JSONL file.

          // Frontend tool calls are handled via FrontendToolBridge:
          // 1. MCP tool calls frontendToolBridge.waitForResult() → blocks
          // 2. Bridge emits event → NotificationChannelManager sends to channels
          // 3. User responds → POST /agents/frontend-tool-result → resolves Promise

          try {
            if (!res.destroyed && !connectionManager.isConnectionClosed()) {
              if (outputFormat === 'agui' && aguiAdapter) {
                // Convert SDK message to AGUI format
                const aguiEvents = aguiAdapter.convert(sdkMessage as any);
                for (const event of aguiEvents) {
                  writeAguiAndBroadcast(event, actualSessionId || currentSessionId);
                }
              } else {
                // Default SDK format
                res.write(`data: ${JSON.stringify(eventData)}\n\n`);
              }
            }
          } catch (writeError: unknown) {
            log.error('Failed to write SSE data:', writeError);
            const errorMessage = writeError instanceof Error ? writeError.message : 'unknown write error';
            ensureAguiRunFinished();
            connectionManager.safeCloseConnection(`write error: ${errorMessage}`);
            return;
          }

          // 当收到 result 事件时，检查是否为错误类型
          if (isSDKResultMessage(sdkMessage)) {
            const resultMsg = sdkMessage as any; // 类型断言以访问 subtype 和 errors 字段

            // 检查是否为错误类型的 result
            if (resultMsg.subtype !== 'success') {
              log.error(`❌ Received error result (subtype: ${resultMsg.subtype}):`, resultMsg.errors);

              // 发送错误事件给前端
              const errorEvent = {
                type: 'error',
                error: 'Claude API request failed',
                message: resultMsg.errors?.join('\n') || 'Unknown error occurred',
                subtype: resultMsg.subtype,
                timestamp: Date.now(),
                agentId: agentId,
                sessionId: actualSessionId || currentSessionId
              };

              try {
                if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                  res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
                }
              } catch (writeError: unknown) {
                log.error('Failed to write error event:', writeError);
              }
            }

            // For AGUI output, send finalize events
            if (outputFormat === 'agui' && aguiAdapter) {
              try {
                const finalEvents = aguiAdapter.finalize();

                // Separate RUN_FINISHED from other finalize events so we can
                // execute the onRunFinished hook before it is sent.
                const runFinishedEvent = finalEvents.find(e => e.type === AGUIEventType.RUN_FINISHED);
                const otherEvents = finalEvents.filter(e => e.type !== AGUIEventType.RUN_FINISHED);

                // Send all non-RUN_FINISHED finalize events first
                const sid = actualSessionId || currentSessionId;
                for (const event of otherEvents) {
                  if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                    writeAguiAndBroadcast(event, sid);
                  }
                }

                // Execute onRunFinished hook (if configured) before sending RUN_FINISHED
                if (onRunFinishedHook && projectPath && !res.destroyed && !connectionManager.isConnectionClosed()) {
                  try {
                    const hookEvents = await runOnRunFinishedHook(onRunFinishedHook, {
                      projectPath,
                      agentId,
                      sessionId: actualSessionId || currentSessionId || undefined,
                    });
                    for (const hookEvent of hookEvents) {
                      if (!res.destroyed && !connectionManager.isConnectionClosed()) {
                        writeAguiAndBroadcast(hookEvent, sid);
                      }
                    }
                  } catch (hookError: any) {
                    log.warn(`[onRunFinished hook] Error: ${hookError.message}`);
                  }
                }

                // Now send the deferred RUN_FINISHED
                if (runFinishedEvent && !res.destroyed && !connectionManager.isConnectionClosed()) {
                  writeAguiAndBroadcast(runFinishedEvent, sid);
                }

                aguiRunFinishedSent = true; // finalize() includes RUN_FINISHED
              } catch (finalizeError) {
                log.error('Failed to write AGUI finalize events:', finalizeError);
              }
            }

            // Safety net: ensure RUN_FINISHED is sent even if finalize() failed
            ensureAguiRunFinished();
            log.info(`✅ Received result event (subtype: ${resultMsg.subtype}), closing SSE connection for sessionId: ${actualSessionId || currentSessionId}`);
            connectionManager.safeCloseConnection('request completed');
          }
        });

        // 设置当前请求ID到连接管理器
        connectionManager.setCurrentRequestId(currentRequestId);

        log.info(`📨 Started Claude request for agent: ${agentId}, sessionId: ${currentSessionId || 'new'}, requestId: ${currentRequestId}`);

        // 如果成功发送消息，跳出重试循环
        break;

      } catch (sessionError) {
        log.error(`❌ Claude session error (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, sessionError);

        const errorMessage = sessionError instanceof Error ? sessionError.message : 'Unknown error';
        const originalSessionId = sessionId; // 使用外部作用域的sessionId

        // 检查是否应该重试
        const shouldRetry = retryCount < MAX_RETRIES && originalSessionId !== null;

        if (shouldRetry && originalSessionId) {
          // 尝试重试：从SessionManager中移除失败的会话
          log.info(`🔄 Attempting to recover from session failure for session: ${originalSessionId}`);
          log.info(`   Error details: ${errorMessage}`);

          try {
            // 从SessionManager中移除失败的会话
            const removed = await sessionManager.removeSession(originalSessionId);
            if (removed) {
              log.info(`✅ Removed failed session ${originalSessionId} from SessionManager`);
            } else {
              log.info(`⚠️  Session ${originalSessionId} was not found in SessionManager (may have been cleaned up already)`);
            }
          } catch (removeError) {
            log.error(`⚠️  Failed to remove session ${originalSessionId}:`, removeError);
          }

          // 将sessionId设为null，下次循环将创建新会话
          sessionId = null;
          retryCount++;

          log.info(`🔄 Retrying with new session (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
          continue; // 继续下一次循环
        }

        // 不再重试，发送错误给前端
        log.info(`❌ Maximum retries reached or no sessionId to retry. Sending error to frontend.`);

        if (!connectionManager.isConnectionClosed()) {
          try {
            res.write(`data: ${JSON.stringify({
              type: 'error',
              error: 'Claude session failed',
              message: errorMessage,
              timestamp: Date.now(),
              retriesExhausted: retryCount >= MAX_RETRIES
            })}\n\n`);
          } catch (writeError) {
            log.error('Failed to write error message:', writeError);
          }
          ensureAguiRunFinished();
          connectionManager.safeCloseConnection(`session error: ${errorMessage}`);
        }
        break; // 跳出重试循环
      }
    } // End of while loop

  } catch (error) {
    log.error('Error in AI chat:', error);

    // 使用安全关闭连接函数（如果在 try 块内部定义的话）
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (!res.headersSent) {
      // 如果还没有设置为 SSE，返回 JSON 错误
      res.status(500).json({ error: 'AI request failed', message: errorMessage });
    } else {
      // 如果已经是 SSE 连接，发送错误事件并关闭
      try {
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({
            type: 'error',
            error: 'AI request failed',
            message: errorMessage,
            timestamp: Date.now()
          })}\n\n`);
          _ensureAguiRunFinished();
          res.end();
        }
      } catch (writeError) {
        log.error('Failed to write final error message:', writeError);
        try {
          if (!res.destroyed) {
            res.end();
          }
        } catch (endError) {
          log.error('Failed to end response in error handler:', endError);
        }
      }
    }
  }
});

export default router;
