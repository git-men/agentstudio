/**
 * Cursor AGUI to A2A Protocol Adapter
 * 
 * Converts AGUI events from CursorEngine to A2A protocol format.
 * This adapter bridges the gap between Cursor's AGUI output and the
 * standardized A2A protocol for agent-to-agent communication.
 * 
 * A2A Protocol Reference: https://google.github.io/A2A/specification/
 */

import { v4 as uuidv4 } from 'uuid';
import type { AGUIEvent, AGUIEventType } from '../types.js';

// =============================================================================
// A2A Protocol Types (matching specification v0.2.1)
// =============================================================================

/**
 * A2A Task State
 */
export type A2ATaskState = 
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

/**
 * A2A Part - content unit within a Message or Artifact
 */
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2ATextPart {
  kind: 'text';
  text: string;
  metadata?: Record<string, any>;
}

export interface A2AFilePart {
  kind: 'file';
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;  // Base64
    uri?: string;
  };
  metadata?: Record<string, any>;
}

export interface A2ADataPart {
  kind: 'data';
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * A2A Message
 */
export interface A2AMessage {
  kind: 'message';
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, any>;
  referenceTaskIds?: string[];
}

/**
 * A2A Task Status
 */
export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

/**
 * A2A Artifact
 */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, any>;
}

/**
 * A2A Task
 */
export interface A2ATask {
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, any>;
}

/**
 * A2A Task Status Update Event (for streaming)
 */
export interface A2ATaskStatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  final?: boolean;
}

/**
 * A2A Task Artifact Update Event (for streaming)
 */
export interface A2ATaskArtifactUpdateEvent {
  kind: 'artifact-update';
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
}

/**
 * A2A Streaming Response (JSON-RPC 2.0 wrapper)
 */
export interface A2AStreamingResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: A2AMessage | A2ATask | A2ATaskStatusUpdateEvent | A2ATaskArtifactUpdateEvent;
}

// =============================================================================
// Cursor AGUI to A2A Adapter
// =============================================================================

interface AdapterState {
  taskId: string;
  contextId: string;
  currentMessageId: string | null;
  accumulatedText: string;
  currentToolCall: {
    id: string;
    name: string;
    args: string;
  } | null;
  toolResults: Map<string, { result: string; isError: boolean }>;
  artifacts: A2AArtifact[];
  history: A2AMessage[];
  lastState: A2ATaskState;
  requestId: string | number;
}

/**
 * Converts AGUI events to A2A protocol format
 */
export class CursorA2AAdapter {
  private state: AdapterState;
  
  constructor(options?: {
    taskId?: string;
    contextId?: string;
    requestId?: string | number;
  }) {
    this.state = {
      taskId: options?.taskId || uuidv4(),
      contextId: options?.contextId || uuidv4(),
      currentMessageId: null,
      accumulatedText: '',
      currentToolCall: null,
      toolResults: new Map(),
      artifacts: [],
      history: [],
      lastState: 'submitted',
      requestId: options?.requestId || uuidv4(),
    };
  }

  /**
   * Get current task ID
   */
  getTaskId(): string {
    return this.state.taskId;
  }

  /**
   * Get current context ID
   */
  getContextId(): string {
    return this.state.contextId;
  }

  /**
   * Convert a single AGUI event to A2A streaming response(s)
   */
  convertEvent(event: AGUIEvent): A2AStreamingResponse[] {
    const responses: A2AStreamingResponse[] = [];
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case 'RUN_STARTED':
        // Emit initial status update: submitted -> working
        this.state.lastState = 'working';
        responses.push(this.createStreamingResponse({
          kind: 'status-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          status: {
            state: 'working',
            timestamp,
          },
          final: false,
        }));
        break;

      case 'TEXT_MESSAGE_START':
        // Start accumulating text for a new message
        this.state.currentMessageId = (event as any).messageId || uuidv4();
        this.state.accumulatedText = '';
        break;

      case 'TEXT_MESSAGE_CONTENT':
        // Accumulate text content and emit only the DELTA (not the full accumulated text)
        // This avoids massive duplication: previously each partial message contained
        // the entire accumulated text from the beginning, causing the same content
        // to be sent O(n²) times instead of O(n).
        const content = (event as any).content || '';
        this.state.accumulatedText += content;
        
        // Emit incremental delta update (only the new content)
        if (this.state.currentMessageId && content) {
          responses.push(this.createStreamingResponse(
            this.createMessage('agent', content, {
              messageId: this.state.currentMessageId,
              isPartial: true,
            })
          ));
        }
        break;

      case 'TEXT_MESSAGE_END':
        // Finalize the message - save to history for the RUN_FINISHED status-update
        // Don't emit a separate message here to avoid sending the full text again
        // (all content was already streamed as deltas in TEXT_MESSAGE_CONTENT events,
        // and the final complete message will be included in RUN_FINISHED status-update)
        if (this.state.currentMessageId && this.state.accumulatedText) {
          const message = this.createMessage('agent', this.state.accumulatedText, {
            messageId: this.state.currentMessageId,
            isPartial: false,
          });
          
          // Add to history (used by RUN_FINISHED and getResponseText)
          this.state.history.push(message);
        }
        this.state.currentMessageId = null;
        break;

      case 'TOOL_CALL_START':
        // Start tracking tool call
        this.state.currentToolCall = {
          id: (event as any).toolCallId || uuidv4(),
          name: (event as any).toolName || 'unknown',
          args: '',
        };
        
        // Emit artifact for tool invocation
        const toolStartArtifact: A2AArtifact = {
          artifactId: `tool-${this.state.currentToolCall.id}`,
          name: `Tool: ${this.state.currentToolCall.name}`,
          description: `Invoking tool: ${this.state.currentToolCall.name}`,
          parts: [{
            kind: 'data',
            data: {
              type: 'tool_invocation',
              toolName: this.state.currentToolCall.name,
              status: 'started',
            },
          }],
        };
        
        responses.push(this.createStreamingResponse({
          kind: 'artifact-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          artifact: toolStartArtifact,
          append: false,
          lastChunk: false,
        }));
        break;

      case 'TOOL_CALL_ARGS':
        // Accumulate tool arguments
        if (this.state.currentToolCall) {
          this.state.currentToolCall.args += (event as any).args || '';
        }
        break;

      case 'TOOL_CALL_END':
        // Tool call definition complete, wait for result
        if (this.state.currentToolCall) {
          const toolEndArtifact: A2AArtifact = {
            artifactId: `tool-${this.state.currentToolCall.id}`,
            name: `Tool: ${this.state.currentToolCall.name}`,
            parts: [{
              kind: 'data',
              data: {
                type: 'tool_invocation',
                toolName: this.state.currentToolCall.name,
                arguments: this.tryParseJSON(this.state.currentToolCall.args),
                status: 'executing',
              },
            }],
          };
          
          responses.push(this.createStreamingResponse({
            kind: 'artifact-update',
            taskId: this.state.taskId,
            contextId: this.state.contextId,
            artifact: toolEndArtifact,
            append: false,
            lastChunk: false,
          }));
        }
        break;

      case 'TOOL_CALL_RESULT':
        // Tool execution complete
        const toolCallId = (event as any).toolCallId;
        const result = (event as any).result || '';
        const isError = (event as any).isError || false;
        
        this.state.toolResults.set(toolCallId, { result, isError });
        
        const toolResultArtifact: A2AArtifact = {
          artifactId: `tool-result-${toolCallId}`,
          name: `Tool Result: ${this.state.currentToolCall?.name || 'unknown'}`,
          parts: [{
            kind: 'data',
            data: {
              type: 'tool_result',
              toolCallId,
              toolName: this.state.currentToolCall?.name,
              result: this.tryParseJSON(result),
              isError,
              status: 'completed',
            },
          }],
        };
        
        this.state.artifacts.push(toolResultArtifact);
        
        responses.push(this.createStreamingResponse({
          kind: 'artifact-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          artifact: toolResultArtifact,
          append: false,
          lastChunk: true,
        }));
        
        // Clear current tool call
        this.state.currentToolCall = null;
        break;

      case 'RUN_FINISHED':
        // Task completed successfully
        this.state.lastState = 'completed';
        
        // Create final message with summary if we have accumulated text
        const finalMessage = this.state.history.length > 0 
          ? this.state.history[this.state.history.length - 1]
          : undefined;
        
        responses.push(this.createStreamingResponse({
          kind: 'status-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          status: {
            state: 'completed',
            message: finalMessage,
            timestamp,
          },
          final: true,
        }));
        break;

      case 'RUN_ERROR':
        // Task failed
        this.state.lastState = 'failed';
        
        const errorMessage = this.createMessage('agent', 
          `Error: ${(event as any).error || 'Unknown error'}`, {
            metadata: {
              errorCode: (event as any).code,
            },
          }
        );
        
        responses.push(this.createStreamingResponse({
          kind: 'status-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          status: {
            state: 'failed',
            message: errorMessage,
            timestamp,
          },
          final: true,
        }));
        break;

      case 'THINKING_START':
      case 'THINKING_CONTENT':
      case 'THINKING_END':
        // Emit thinking as a data artifact (optional transparency)
        if (event.type === 'THINKING_CONTENT') {
          const thinkingArtifact: A2AArtifact = {
            artifactId: `thinking-${uuidv4()}`,
            name: 'Agent Thinking',
            parts: [{
              kind: 'data',
              data: {
                type: 'thinking',
                content: (event as any).content,
              },
            }],
            metadata: { internal: true },
          };
          
          responses.push(this.createStreamingResponse({
            kind: 'artifact-update',
            taskId: this.state.taskId,
            contextId: this.state.contextId,
            artifact: thinkingArtifact,
            append: true,
            lastChunk: false,
          }));
        }
        break;

      case 'RAW':
        // Pass through raw events as data artifacts
        const rawArtifact: A2AArtifact = {
          artifactId: `raw-${uuidv4()}`,
          name: 'Raw Event',
          parts: [{
            kind: 'data',
            data: {
              type: 'raw_event',
              source: (event as any).source,
              event: (event as any).event,
            },
          }],
          metadata: { internal: true },
        };
        
        responses.push(this.createStreamingResponse({
          kind: 'artifact-update',
          taskId: this.state.taskId,
          contextId: this.state.contextId,
          artifact: rawArtifact,
          append: false,
          lastChunk: false,
        }));
        break;

      default:
        // Log unhandled event types
        console.log(`[CursorA2AAdapter] Unhandled AGUI event type: ${event.type}`);
    }

    return responses;
  }

  /**
   * Create a complete A2A Task object (for non-streaming responses)
   */
  createTask(): A2ATask {
    return {
      id: this.state.taskId,
      contextId: this.state.contextId,
      status: {
        state: this.state.lastState,
        timestamp: new Date().toISOString(),
        message: this.state.history.length > 0 
          ? this.state.history[this.state.history.length - 1] 
          : undefined,
      },
      artifacts: this.state.artifacts.length > 0 ? this.state.artifacts : undefined,
      history: this.state.history.length > 0 ? this.state.history : undefined,
    };
  }

  /**
   * Get accumulated response text
   */
  getResponseText(): string {
    // Combine all text from history
    return this.state.history
      .filter(m => m.role === 'agent')
      .map(m => m.parts.filter(p => p.kind === 'text').map(p => (p as A2ATextPart).text).join(''))
      .join('\n');
  }

  /**
   * Format A2A streaming response as SSE data
   */
  static formatAsSSE(response: A2AStreamingResponse): string {
    return `data: ${JSON.stringify(response)}\n\n`;
  }

  // =============================================================================
  // Private Helper Methods
  // =============================================================================

  private createStreamingResponse(
    result: A2AMessage | A2ATask | A2ATaskStatusUpdateEvent | A2ATaskArtifactUpdateEvent
  ): A2AStreamingResponse {
    return {
      jsonrpc: '2.0',
      id: this.state.requestId,
      result,
    };
  }

  private createMessage(
    role: 'user' | 'agent',
    text: string,
    options?: {
      messageId?: string;
      isPartial?: boolean;
      metadata?: Record<string, any>;
    }
  ): A2AMessage {
    return {
      kind: 'message',
      role,
      messageId: options?.messageId || uuidv4(),
      taskId: this.state.taskId,
      contextId: this.state.contextId,
      parts: [{
        kind: 'text',
        text,
        metadata: options?.isPartial ? { partial: true } : undefined,
      }],
      metadata: options?.metadata,
    };
  }

  private tryParseJSON(str: string): any {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert a batch of AGUI events to A2A format
 */
export function convertAGUIEventsToA2A(
  events: AGUIEvent[],
  options?: {
    taskId?: string;
    contextId?: string;
    requestId?: string | number;
  }
): A2AStreamingResponse[] {
  const adapter = new CursorA2AAdapter(options);
  const responses: A2AStreamingResponse[] = [];
  
  for (const event of events) {
    responses.push(...adapter.convertEvent(event));
  }
  
  return responses;
}

/**
 * Create an A2A error response
 */
export function createA2AErrorResponse(
  error: string,
  code: number,
  requestId: string | number,
  data?: any
): { jsonrpc: '2.0'; id: string | number; error: { code: number; message: string; data?: any } } {
  return {
    jsonrpc: '2.0',
    id: requestId,
    error: {
      code,
      message: error,
      data,
    },
  };
}

// A2A Standard Error Codes
export const A2A_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // A2A-specific codes (in range -32000 to -32099)
  TASK_NOT_FOUND: -32001,
  TASK_CANCELED: -32002,
  TASK_FAILED: -32003,
  UNAUTHORIZED: -32004,
  RATE_LIMITED: -32005,
} as const;
