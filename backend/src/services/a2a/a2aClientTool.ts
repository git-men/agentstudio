/**
 * A2A Client MCP Tool
 *
 * Implements the `call_external_agent` MCP tool for calling external A2A-compatible agents.
 * This tool enables AgentStudio agents to delegate tasks to specialized external agents.
 *
 * Features:
 * - Allowlist validation against project's a2a-config.json
 * - HTTP client using @a2a-js/sdk for A2A standard protocol support
 * - Streaming support using A2A standard events (Task, Message, TaskStatusUpdateEvent, etc.)
 * - Timeout handling (default 10min, configurable)
 * - Clear error messages for failures
 * - Support for both sync messages and async tasks
 *
 * A2A Protocol Streaming:
 * - Uses message/stream method for real-time updates
 * - Supports Task lifecycle stream (Task → TaskStatusUpdateEvent/TaskArtifactUpdateEvent → terminal state)
 * - Supports Message-only stream (single Message response)
 *
 * Phase 5: US3 - Agent as A2A Client via MCP Tool
 */

/// <reference lib="dom" />
import type { CallExternalAgentInput, CallExternalAgentOutput, A2AProtocolType } from '../../types/a2a.js';
import { loadA2AConfig } from './a2aConfigService.js';
import { a2aHistoryService } from './a2aHistoryService.js';
import {
  a2aStreamEventEmitter,
  type TaskState,
} from './a2aStreamEvents.js';
import { v4 as uuidv4 } from 'uuid';
import type { MessageSendParams } from '@a2a-js/sdk';

declare const process: any;

/**
 * Upgrade http:// to https:// for non-local URLs.
 * HTTP→HTTPS redirects strip the Authorization header (RFC 7235),
 * so we must use HTTPS directly to preserve auth credentials.
 */
function ensureHttps(url: string): string {
  if (!url.startsWith('http://')) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
      return url;
    }
    return url.replace(/^http:\/\//, 'https://');
  } catch {
    return url;
  }
}

/**
 * MCP Tool Definition for call_external_agent
 */
export const CALL_EXTERNAL_AGENT_TOOL = {
  name: 'call_external_agent',
  description:
    'Call an external A2A-compatible agent to delegate a task. The external agent must be in the project allowlist.',
  inputSchema: {
    type: 'object',
    properties: {
      agentUrl: {
        type: 'string',
        description: 'Target agent base URL (e.g., https://analytics.example.com/a2a/agent-id)',
      },
      message: {
        type: 'string',
        description: 'Task description or query for the external agent',
      },
      useTask: {
        type: 'boolean',
        description: 'Use async task mode (default: false for synchronous message)',
        default: false,
      },
      contextId: {
        type: 'string',
        description: 'Context ID for continuing a conversation (A2A standard)',
      },
      taskId: {
        type: 'string',
        description: 'Task ID for continuing an existing task (A2A standard)',
      },
      stream: {
        type: 'boolean',
        description: 'Enable streaming response (default: false, streaming is only useful for web frontend real-time updates)',
        default: false,
      }
    },
    required: ['agentUrl', 'message'],
  },
} as const;

/**
 * Call external A2A agent tool handler
 *
 * Validates agent URL against project allowlist, then makes HTTP call
 * using @a2a-js/sdk A2AClient. Returns structured response with success/error status.
 *
 * @param input - Tool input parameters
 * @param projectId - Project ID for allowlist validation
 * @returns Structured response with success/error status
 */
export async function callExternalAgent(
  input: CallExternalAgentInput,
  projectId: string
): Promise<CallExternalAgentOutput> {
  const { agentUrl, message, useTask = false, stream = false, timeout: inputTimeout } = input;
  const timeout = inputTimeout || 600000;

  try {
    const validationResult = await validateAgentUrl(agentUrl, projectId);

    if (!validationResult.allowed) {
      return {
        success: false,
        error: validationResult.error || 'Agent URL not in project allowlist',
      };
    }

    const apiKey = validationResult.apiKey;
    const protocolType = validationResult.protocolType || 'custom';
    const customHeaders = validationResult.customHeaders;

    if (!apiKey && protocolType === 'custom') {
      return {
        success: false,
        error: 'API key not found for allowed agent',
      };
    }

    // Route to standard A2A JSON-RPC or legacy custom REST protocol
    if (protocolType === 'a2a-jsonrpc') {
      return await callExternalAgentJsonRpc(
        agentUrl, message, apiKey || '', timeout, stream,
        projectId, customHeaders, input.contextId, input.taskId
      );
    }

    // Legacy custom REST protocol
    if (useTask) {
      const taskResult = await callExternalAgentTask(agentUrl, message, apiKey!, timeout);
      return taskResult;
    } else {
      const sessionId = uuidv4();
      const messageResult = await callExternalAgentMessage(
        agentUrl, message, apiKey!, timeout, sessionId,
        stream, projectId, input.contextId, input.taskId
      );
      return messageResult;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[A2A Client Tool] Error calling external agent:', error);

    return {
      success: false,
      error: `Failed to call external agent: ${errorMessage}`,
    };
  }
}

interface AgentValidationResult {
  allowed: boolean;
  apiKey?: string;
  protocolType?: A2AProtocolType;
  customHeaders?: Record<string, string>;
  error?: string;
}

/**
 * Validate agent URL against project's allowlist
 */
async function validateAgentUrl(
  agentUrl: string,
  projectId: string
): Promise<AgentValidationResult> {
  try {
    const config = await loadA2AConfig(projectId);

    if (!config) {
      return {
        allowed: false,
        error: 'Project A2A configuration not found. Please configure allowed agents in project settings.',
      };
    }

    const normalizedTargetUrl = agentUrl.replace(/\/$/, '');

    for (const allowedAgent of config.allowedAgents) {
      const normalizedAllowedUrl = allowedAgent.url.replace(/\/$/, '');

      if (normalizedTargetUrl.startsWith(normalizedAllowedUrl) && allowedAgent.enabled) {
        return {
          allowed: true,
          apiKey: allowedAgent.apiKey,
          protocolType: allowedAgent.protocolType || 'custom',
          customHeaders: allowedAgent.customHeaders,
        };
      }
    }

    return {
      allowed: false,
      error: `Agent URL '${agentUrl}' not found in project's allowed agents list. Please add it in project A2A settings.`,
    };
  } catch (error) {
    console.error('[A2A Client Tool] Error validating agent URL:', error);
    return {
      allowed: false,
      error: 'Failed to validate agent URL against allowlist',
    };
  }
}

/**
 * Build messages endpoint URL with smart format detection
 * 
 * Supports both standard A2A format and non-standard formats:
 * - Standard: `http://host/agent-id` → `http://host/agent-id/messages`
 * - Non-standard: `http://host/messages/project-id` → `http://host/messages/project-id` (no change)
 * 
 * @param agentUrl - Base agent URL
 * @param stream - Whether to add stream query parameter
 * @returns Complete messages endpoint URL
 */
function buildMessagesUrl(agentUrl: string, stream: boolean): string {
  // Check if URL already contains /messages path
  if (agentUrl.includes('/messages/') || agentUrl.endsWith('/messages')) {
    // Already a complete messages endpoint (non-standard format), use as-is
    return stream ? `${agentUrl}?stream=true` : agentUrl;
  }
  
  // Standard A2A format: append /messages
  const base = agentUrl.endsWith('/') ? agentUrl.slice(0, -1) : agentUrl;
  return stream ? `${base}/messages?stream=true` : `${base}/messages`;
}

/**
 * Call external agent with message using A2A SDK (message/send or message/stream)
 * 
 * Uses A2A standard protocol:
 * - For streaming: Uses message/stream endpoint via A2AClient.sendMessageStream()
 * - Returns A2A standard events: Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent
 */
async function callExternalAgentMessage(
  agentUrl: string,
  message: string,
  apiKey: string,
  timeout: number,
  sessionId: string,
  stream: boolean,
  projectId: string,
  contextId?: string,
  taskId?: string
): Promise<CallExternalAgentOutput> {
  const workingDirectory = projectId.startsWith('/') ? projectId : process.cwd();

  try {
    // Build A2A standard message params
    const messageParams: MessageSendParams = {
      message: {
        kind: 'message',
        messageId: uuidv4(),
        role: 'user',
        parts: [{ kind: 'text', text: message }],
        contextId,
        taskId,
      },
      configuration: {
        acceptedOutputModes: ['text/plain', 'application/json'],
      },
    };

    if (stream) {
      // Use A2A streaming with fetch-based SSE (since A2AClient requires agent card)
      return await callExternalAgentStreamFetch(
        agentUrl,
        messageParams,
        apiKey,
        timeout,
        sessionId,
        workingDirectory
      );
    } else {
      // Use sync call with fetch
      return await callExternalAgentSyncFetch(
        agentUrl,
        messageParams,
        apiKey,
        timeout,
        sessionId,
        workingDirectory
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Error calling external agent: ${errorMessage}`,
    };
  }
}

/**
 * Call external agent with streaming using fetch-based SSE
 * Implements A2A message/stream protocol manually since A2AClient requires agent card
 */
async function callExternalAgentStreamFetch(
  agentUrl: string,
  messageParams: MessageSendParams,
  apiKey: string,
  timeout: number,
  sessionId: string,
  workingDirectory: string
): Promise<CallExternalAgentOutput> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Extract text message from parts
  const textMessage = messageParams.message.parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map(p => p.text)
    .join('');

  // Build request body matching server's expected format
  const requestBody = {
    message: textMessage,
    sessionId: messageParams.message.contextId || undefined,
  };

  // Emit stream start event
  a2aStreamEventEmitter.emitStreamStart({
    sessionId,
    projectId: workingDirectory,
    agentUrl,
    message: textMessage,
    contextId: messageParams.message.contextId,
    taskId: messageParams.message.taskId,
  });

  try {
    // Build messages URL with smart format detection
    const messagesUrl = buildMessagesUrl(agentUrl, true);

    const response = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      a2aStreamEventEmitter.emitStreamEnd({
        sessionId,
        projectId: workingDirectory,
        success: false,
        error: `HTTP ${response.status}: ${(errorData as any).error || response.statusText}`,
      });
      return {
        success: false,
        error: `External agent returned ${response.status}: ${(errorData as any).error || response.statusText}`,
      };
    }

    if (!response.body) {
      a2aStreamEventEmitter.emitStreamEnd({
        sessionId,
        projectId: workingDirectory,
        success: false,
        error: 'No response body',
      });
      return {
        success: false,
        error: 'No response body from external agent',
      };
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let collectedText = '';
    let finalContextId: string | undefined;
    let finalTaskId: string | undefined;
    let finalState: TaskState | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr || dataStr === '[DONE]') continue;

            try {
              const event = JSON.parse(dataStr);

              // Check for error event
              if (event.type === 'error') {
                const errorMsg = event.error || 'Unknown error';
                a2aStreamEventEmitter.emitStreamEnd({
                  sessionId,
                  projectId: workingDirectory,
                  success: false,
                  error: errorMsg,
                });
                return {
                  success: false,
                  error: errorMsg,
                };
              }

              // Check for done event
              if (event.type === 'done') {
                continue; // Will be handled at end of stream
              }

              // Store event in history
              await a2aHistoryService.appendEvent(workingDirectory, sessionId, event);

              // Emit stream data event for frontend
              a2aStreamEventEmitter.emitStreamData({
                sessionId,
                projectId: workingDirectory,
                agentUrl,
                event,
              });

              // Get sessionId from event if available
              if (event.sessionId) {
                finalContextId = event.sessionId;
              }

              // Process SDK message event based on type
              switch (event.type) {
                case 'assistant': {
                  // SDK assistant message: { type: 'assistant', message: { role: 'user', content: [...] } }
                  if (event.message?.content) {
                    for (const block of event.message.content) {
                      if (block.type === 'text') {
                        collectedText += block.text;
                      }
                    }
                  }
                  break;
                }
                case 'result': {
                  // Result event indicates completion
                  const isError = event.subtype === 'error' || event.is_error;
                  if (!isError) {
                    finalState = 'completed';
                  } else {
                    finalState = 'failed';
                  }
                  break;
                }
                case 'system': {
                  // System init event contains sessionId
                  if (event.sessionId) {
                    finalContextId = event.sessionId;
                  }
                  break;
                }
                case 'user': {
                  // Tool result events - extract text if available
                  if (event.message?.content) {
                    for (const block of event.message.content) {
                      if (block.type === 'tool_result' && typeof block.content === 'string') {
                        // Tool results can be included in response
                        // collectedText += block.content;
                      }
                    }
                  }
                  break;
                }
              }
            } catch (parseError) {
              // Ignore parse errors for partial data
              console.warn('[A2A Client Tool] Parse error in SSE:', parseError);
            }
          }
        }
      }
    } catch (streamError) {
      console.error('[A2A Client Tool] Error reading stream:', streamError);
      a2aStreamEventEmitter.emitStreamEnd({
        sessionId,
        projectId: workingDirectory,
        success: false,
        error: streamError instanceof Error ? streamError.message : String(streamError),
        finalState,
      });
      return {
        success: false,
        error: `Stream error: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
      };
    }

    // Stream completed normally
    a2aStreamEventEmitter.emitStreamEnd({
      sessionId,
      projectId: workingDirectory,
      success: true,
      finalState: finalState || 'completed',
    });

    return {
      success: true,
      data: collectedText || 'Streaming completed',
      sessionId,
      contextId: finalContextId,
      taskId: finalTaskId,
    };

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      a2aStreamEventEmitter.emitStreamEnd({
        sessionId,
        projectId: workingDirectory,
        success: false,
        error: 'Timeout',
      });
      return {
        success: false,
        error: `External agent call timed out after ${timeout}ms`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    a2aStreamEventEmitter.emitStreamEnd({
      sessionId,
      projectId: workingDirectory,
      success: false,
      error: errorMessage,
    });
    return {
      success: false,
      error: `Network error calling external agent: ${errorMessage}`,
    };
  }
}

/**
 * Call external agent with sync message using fetch
 * Implements A2A message/send protocol
 */
async function callExternalAgentSyncFetch(
  agentUrl: string,
  messageParams: MessageSendParams,
  apiKey: string,
  timeout: number,
  sessionId: string,
  workingDirectory: string
): Promise<CallExternalAgentOutput> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Extract text message from parts
  const textMessage = messageParams.message.parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map(p => p.text)
    .join('');

  // Build request body matching server's expected format
  const requestBody = {
    message: textMessage,
    sessionId: messageParams.message.contextId || undefined,
  };

  try {
    // Build messages URL with smart format detection
    const messagesUrl = buildMessagesUrl(agentUrl, false);

    const response = await fetch(messagesUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      return {
        success: false,
        error: `External agent returned ${response.status}: ${(errorData as any).error || response.statusText}`,
      };
    }

    const responseData = await response.json();

    // Check for error in response
    if (responseData.error) {
      return {
        success: false,
        error: responseData.error.message || responseData.error || 'Unknown error',
      };
    }

    // Server returns: { response, sessionId, metadata } (A2A standard format)
    // Store in history as a simple message event
    const historyEvent = {
      kind: 'message' as const,
      role: 'assistant' as const,
      messageId: sessionId,
      parts: [{ kind: 'text' as const, text: responseData.response || responseData.message || '' }],
    };
    await a2aHistoryService.appendEvent(workingDirectory, sessionId, historyEvent);

    return {
      success: true,
      data: responseData.response || responseData.message || 'Message processed',
      sessionId: responseData.sessionId || sessionId,
    };

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: `External agent call timed out after ${timeout}ms`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Network error calling external agent: ${errorMessage}`,
    };
  }
}

/**
 * Call external agent with asynchronous task
 *
 * Uses POST /tasks endpoint of A2A protocol.
 *
 * @param agentUrl - Target agent base URL
 * @param message - Task description
 * @param apiKey - API key for authentication
 * @param timeout - Request timeout in milliseconds
 * @returns Tool output with task ID and status
 */
async function callExternalAgentTask(
  agentUrl: string,
  message: string,
  apiKey: string,
  timeout: number
): Promise<CallExternalAgentOutput> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${agentUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ message, timeout }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({ error: response.statusText }))) as {
        error?: string;
      };
      return {
        success: false,
        error: `External agent returned ${response.status}: ${errorData.error || response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      taskId?: string;
      status?: string;
      checkUrl?: string;
      [key: string]: unknown;
    };

    return {
      success: true,
      taskId: data.taskId,
      status: data.status,
      data: data.checkUrl
        ? {
          taskId: data.taskId,
          status: data.status,
          checkUrl: data.checkUrl,
        }
        : data,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: `External agent task creation timed out after ${timeout}ms`,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Network error creating external agent task: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Standard A2A JSON-RPC 2.0 Protocol Client
// ============================================================================

/**
 * Build HTTP headers for a standard A2A JSON-RPC call.
 */
function buildJsonRpcHeaders(
  apiKey: string,
  customHeaders?: Record<string, string>,
  acceptSse = false
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (acceptSse) {
    headers['Accept'] = 'text/event-stream';
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (customHeaders) {
    Object.assign(headers, customHeaders);
  }
  return headers;
}

/**
 * Build a JSON-RPC 2.0 request body for A2A message/send or message/stream.
 */
function buildJsonRpcBody(
  method: 'message/send' | 'message/stream',
  message: string,
  requestId: string,
  contextId?: string,
  taskId?: string,
  customHeaders?: Record<string, string>
): string {
  const params: any = {
    message: {
      messageId: uuidv4(),
      role: 'user',
      parts: [{ type: 'text', text: message }],
    },
    configuration: {
      acceptedOutputModes: ['text'],
    },
  };

  if (contextId) {
    params.message.contextId = contextId;
  }
  if (taskId) {
    params.message.taskId = taskId;
  }
  // Pass userId from X-User-Id header into configuration for servers that read it there
  const userId = customHeaders?.['X-User-Id'];
  if (userId) {
    params.configuration.userId = userId;
  }

  return JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    method,
    params,
  });
}

/**
 * Top-level dispatcher for standard A2A JSON-RPC calls.
 */
async function callExternalAgentJsonRpc(
  agentUrl: string,
  message: string,
  apiKey: string,
  timeout: number,
  stream: boolean,
  projectId: string,
  customHeaders?: Record<string, string>,
  contextId?: string,
  taskId?: string,
): Promise<CallExternalAgentOutput> {
  const workingDirectory = projectId.startsWith('/') ? projectId : process.cwd();
  const sessionId = uuidv4();
  const requestId = uuidv4();

  if (stream) {
    return callJsonRpcStream(
      agentUrl, message, apiKey, timeout, sessionId, requestId,
      workingDirectory, customHeaders, contextId, taskId
    );
  }
  return callJsonRpcSync(
    agentUrl, message, apiKey, timeout, sessionId, requestId,
    workingDirectory, customHeaders, contextId, taskId
  );
}

/**
 * Standard A2A JSON-RPC synchronous message/send.
 */
async function callJsonRpcSync(
  agentUrl: string,
  message: string,
  apiKey: string,
  timeout: number,
  sessionId: string,
  requestId: string,
  workingDirectory: string,
  customHeaders?: Record<string, string>,
  contextId?: string,
  taskId?: string,
): Promise<CallExternalAgentOutput> {
  const safeUrl = ensureHttps(agentUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(safeUrl, {
      method: 'POST',
      headers: buildJsonRpcHeaders(apiKey, customHeaders),
      body: buildJsonRpcBody('message/send', message, requestId, contextId, taskId, customHeaders),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const rpcResponse = await response.json() as any;

    if (rpcResponse.error) {
      return {
        success: false,
        error: `JSON-RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`,
      };
    }

    const result = rpcResponse.result;
    if (!result) {
      return { success: false, error: 'Empty result from JSON-RPC response' };
    }

    // Extract text from the result (could be Message or Task)
    const responseText = extractTextFromA2AResult(result);

    await a2aHistoryService.appendEvent(workingDirectory, sessionId, result);

    return {
      success: true,
      data: responseText || 'Message processed',
      sessionId,
      contextId: result.contextId,
      taskId: result.taskId || result.id,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: `Timed out after ${timeout}ms` };
    }
    return { success: false, error: `Network error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Standard A2A JSON-RPC streaming message/stream with SSE.
 */
async function callJsonRpcStream(
  agentUrl: string,
  message: string,
  apiKey: string,
  timeout: number,
  sessionId: string,
  requestId: string,
  workingDirectory: string,
  customHeaders?: Record<string, string>,
  contextId?: string,
  taskId?: string,
): Promise<CallExternalAgentOutput> {
  const safeUrl = ensureHttps(agentUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  a2aStreamEventEmitter.emitStreamStart({
    sessionId,
    projectId: workingDirectory,
    agentUrl: safeUrl,
    message,
    contextId,
    taskId,
  });

  try {
    const response = await fetch(safeUrl, {
      method: 'POST',
      headers: buildJsonRpcHeaders(apiKey, customHeaders, true),
      body: buildJsonRpcBody('message/stream', message, requestId, contextId, taskId, customHeaders),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      const errMsg = `HTTP ${response.status}: ${errorText}`;
      a2aStreamEventEmitter.emitStreamEnd({ sessionId, projectId: workingDirectory, success: false, error: errMsg });
      return { success: false, error: errMsg };
    }

    // Server may return JSON error (not SSE) even with 200 status
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const jsonResp = await response.json() as any;
      if (jsonResp.error) {
        const errMsg = `JSON-RPC error ${jsonResp.error.code}: ${jsonResp.error.message}`;
        a2aStreamEventEmitter.emitStreamEnd({ sessionId, projectId: workingDirectory, success: false, error: errMsg });
        return { success: false, error: errMsg };
      }
      const result = jsonResp.result;
      if (result) {
        const responseText = extractTextFromA2AResult(result);
        return {
          success: true,
          data: responseText || 'Message processed (non-streaming response)',
          sessionId,
          contextId: result.contextId,
          taskId: result.taskId || result.id,
        };
      }
    }

    if (!response.body) {
      const errMsg = 'No response body from external agent';
      a2aStreamEventEmitter.emitStreamEnd({ sessionId, projectId: workingDirectory, success: false, error: errMsg });
      return { success: false, error: errMsg };
    }

    return await parseA2AStandardSseStream(
      response, sessionId, workingDirectory, agentUrl
    );
  } catch (error) {
    clearTimeout(timeoutId);
    const errMsg = error instanceof Error && error.name === 'AbortError'
      ? `Timed out after ${timeout}ms`
      : `Network error: ${error instanceof Error ? error.message : String(error)}`;
    a2aStreamEventEmitter.emitStreamEnd({ sessionId, projectId: workingDirectory, success: false, error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Parse a standard A2A SSE stream.
 *
 * Expected event kinds:
 * - status-update: { kind, taskId, contextId, status: { state }, final }
 * - artifact-update: { kind, taskId, contextId, artifact: { parts: [{ kind, text }] } }
 * - message: { kind, role, parts: [{ kind, text }], taskId, contextId, messageId }
 */
async function parseA2AStandardSseStream(
  response: Response,
  sessionId: string,
  workingDirectory: string,
  agentUrl: string,
): Promise<CallExternalAgentOutput> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let collectedText = '';
  let finalContextId: string | undefined;
  let finalTaskId: string | undefined;
  let finalState: TaskState | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        let event: any;
        try {
          event = JSON.parse(dataStr);
        } catch {
          console.warn('[A2A Client] Failed to parse SSE data:', dataStr.substring(0, 100));
          continue;
        }

        // Handle JSON-RPC wrapped events (result field contains the actual A2A event)
        const a2aEvent = event.result || event;

        await a2aHistoryService.appendEvent(workingDirectory, sessionId, a2aEvent);
        a2aStreamEventEmitter.emitStreamData({
          sessionId,
          projectId: workingDirectory,
          agentUrl,
          event: a2aEvent,
        });

        if (a2aEvent.contextId) finalContextId = a2aEvent.contextId;
        if (a2aEvent.taskId) finalTaskId = a2aEvent.taskId;

        switch (a2aEvent.kind) {
          case 'status-update': {
            const state = a2aEvent.status?.state;
            if (a2aEvent.final && state) {
              finalState = state as TaskState;
            }
            break;
          }
          case 'artifact-update': {
            const parts = a2aEvent.artifact?.parts || [];
            for (const part of parts) {
              if (part.kind === 'text' || part.type === 'text') {
                collectedText += part.text || '';
              }
            }
            break;
          }
          case 'message': {
            // Complete message — use its text as the definitive response
            const parts = a2aEvent.parts || [];
            let msgText = '';
            for (const part of parts) {
              if (part.kind === 'text' || part.type === 'text') {
                msgText += part.text || '';
              }
            }
            if (msgText) {
              collectedText = msgText;
            }
            break;
          }
        }

        // Also handle JSON-RPC error responses in the stream
        if (event.error) {
          const errMsg = `JSON-RPC stream error ${event.error.code}: ${event.error.message}`;
          a2aStreamEventEmitter.emitStreamEnd({ sessionId, projectId: workingDirectory, success: false, error: errMsg });
          return { success: false, error: errMsg };
        }
      }
    }
  } catch (streamError) {
    const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
    a2aStreamEventEmitter.emitStreamEnd({
      sessionId, projectId: workingDirectory, success: false, error: errMsg, finalState,
    });
    return { success: false, error: `Stream error: ${errMsg}` };
  }

  a2aStreamEventEmitter.emitStreamEnd({
    sessionId, projectId: workingDirectory, success: true, finalState: finalState || 'completed',
  });

  return {
    success: true,
    data: collectedText || 'Streaming completed',
    sessionId,
    contextId: finalContextId,
    taskId: finalTaskId,
  };
}

/**
 * Extract text from a standard A2A result (Message or Task).
 */
function extractTextFromA2AResult(result: any): string {
  // Direct Message response: { kind: "message", parts: [...] }
  if (result.parts) {
    return result.parts
      .filter((p: any) => p.kind === 'text' || p.type === 'text')
      .map((p: any) => p.text || '')
      .join('');
  }
  // Task response with history: { id, status, history: [{ parts: [...] }] }
  if (result.history && Array.isArray(result.history)) {
    const agentMessages = result.history.filter((m: any) => m.role === 'agent');
    const lastAgent = agentMessages[agentMessages.length - 1];
    if (lastAgent?.parts) {
      return lastAgent.parts
        .filter((p: any) => p.kind === 'text' || p.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
    }
  }
  return '';
}
