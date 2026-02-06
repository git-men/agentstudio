/**
 * Cursor CLI to AGUI Adapter
 * 
 * Converts Cursor CLI JSON output (with --stream-partial-output) to standardized AGUI events.
 * 
 * Format with --output-format stream-json --stream-partial-output:
 * - {"type": "system", "subtype": "init", "model": "...", "session_id": "..."}
 * - {"type": "assistant", "message": {"content": [{"type": "text", "text": "delta"}]}}
 * - {"type": "tool_call", "subtype": "started", "tool_call": {...}}
 * - {"type": "tool_call", "subtype": "completed", "tool_call": {...}}
 * - {"type": "result", "duration_ms": ...}
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AGUIEvent,
  AGUIEventType,
} from '../types.js';

/**
 * Convert snake_case keys to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert all keys in an object from snake_case to camelCase
 * Also handles arrays containing objects
 */
function convertKeysToCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = snakeToCamel(key);
    const value = obj[key];
    
    if (Array.isArray(value)) {
      // Handle arrays - convert objects within arrays
      result[camelKey] = value.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return convertKeysToCamelCase(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      // Recursively convert nested objects
      result[camelKey] = convertKeysToCamelCase(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

/**
 * Adapter state for tracking message/tool call context
 */
interface AdapterState {
  currentMessageId: string | null;
  currentToolCallId: string | null;
  activeToolCalls: Map<string, { name: string; args: any }>;
  /** Accumulated text for current message (to detect duplicates) */
  accumulatedText: string;
}

/**
 * Cursor CLI to AGUI Adapter
 */
export class CursorAguiAdapter {
  private state: AdapterState = {
    currentMessageId: null,
    currentToolCallId: null,
    activeToolCalls: new Map(),
    accumulatedText: '',
  };

  private runId: string;
  private threadId: string;

  constructor(threadId?: string, runId?: string) {
    this.threadId = threadId || uuidv4();
    this.runId = runId || uuidv4();
  }

  /**
   * Create RUN_STARTED event
   */
  createRunStarted(input?: unknown): AGUIEvent {
    return {
      type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
      input,
      timestamp: Date.now(),
    };
  }

  /**
   * Create RUN_FINISHED event
   */
  createRunFinished(result?: unknown): AGUIEvent {
    return {
      type: 'RUN_FINISHED' as AGUIEventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
      result,
      timestamp: Date.now(),
    };
  }

  /**
   * Create RUN_ERROR event
   */
  createRunError(message: string, code?: string): AGUIEvent {
    return {
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error: message,
      code,
      timestamp: Date.now(),
    };
  }

  /**
   * Parse Cursor CLI JSON line and convert to AGUI events
   */
  parseStreamLine(line: string): AGUIEvent[] {
    try {
      const data = JSON.parse(line);
      return this.convertCursorEvent(data);
    } catch (error) {
      console.error('[CursorAguiAdapter] Failed to parse stream line:', error);
      return [];
    }
  }

  /**
   * Convert Cursor CLI event to AGUI events
   * 
   * Handles --stream-partial-output format:
   * - system: init with model info and session_id
   * - assistant: incremental text deltas in message.content[].text
   * - tool_call: with subtype started/completed
   * - result: final summary
   */
  private convertCursorEvent(data: any): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    switch (data.type) {
      case 'system':
        events.push(...this.handleSystemEvent(data, timestamp));
        break;

      case 'assistant':
        // Incremental text deltas with --stream-partial-output
        events.push(...this.handleAssistantDelta(data, timestamp));
        break;

      case 'tool_call':
        // Tool call with subtype (started/completed)
        events.push(...this.handleToolCallEvent(data, timestamp));
        break;

      case 'result':
        // Final result - contains duration_ms, no duplicate content
        console.log('[CursorAguiAdapter] Received result event');
        // Close any open message before finalize
        if (this.state.currentMessageId) {
          events.push({
            type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
            messageId: this.state.currentMessageId,
            timestamp,
          });
          this.state.currentMessageId = null;
          this.state.accumulatedText = ''; // Reset accumulated text
        }
        break;

      case 'user':
        // User message echo - ignore
        break;

      case 'error':
        // Error from Cursor
        events.push(this.createRunError(data.message || 'Unknown error', data.code));
        break;

      // Legacy format support (without --stream-partial-output)
      case 'content':
        events.push(...this.handleTextContent(data.content, timestamp));
        break;

      case 'tool_use':
        events.push(...this.handleLegacyToolUse(data, timestamp));
        break;

      case 'tool_result':
        events.push(...this.handleToolResult(data, timestamp));
        break;

      default:
        // Unknown event, wrap in RAW event
        console.log(`[CursorAguiAdapter] Unknown event type: ${data.type}`);
        events.push({
          type: 'RAW' as AGUIEventType.RAW,
          source: 'cursor',
          event: data,
          timestamp,
        });
    }

    return events;
  }

  /**
   * Handle system event (init, etc.)
   */
  private handleSystemEvent(data: any, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    if (data.subtype === 'init') {
      // Extract session_id if present and notify frontend of the real session ID
      if (data.session_id) {
        const oldThreadId = this.threadId;
        this.setThreadId(data.session_id);
        console.log(`[CursorAguiAdapter] Session ID updated: ${oldThreadId} -> ${data.session_id}`);
        
        // Emit CUSTOM event to sync the real CLI session_id to the frontend
        events.push({
          type: 'CUSTOM' as AGUIEventType.CUSTOM,
          name: 'session_id_updated',
          data: { sessionId: data.session_id },
          threadId: data.session_id,
          timestamp,
        });
      }
      console.log(`[CursorAguiAdapter] System init - model: ${data.model || 'unknown'}`);
    }

    // Wrap as RAW event for debugging
    events.push({
      type: 'RAW' as AGUIEventType.RAW,
      source: 'cursor',
      event: data,
      timestamp,
    });

    return events;
  }

  /**
   * Handle assistant delta (incremental text with --stream-partial-output)
   * Format: {"type": "assistant", "message": {"content": [{"type": "text", "text": "delta"}]}, "timestamp_ms": ...}
   * 
   * IMPORTANT: Cursor CLI sends assistant events twice:
   * 1. First with timestamp_ms - this is the actual content (incremental or full)
   * 2. Second without timestamp_ms - this is a duplicate that should be IGNORED
   * 
   * We only process events that have timestamp_ms to avoid duplicates.
   */
  private handleAssistantDelta(data: any, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    // CRITICAL: Only process assistant events that have timestamp_ms
    // Events without timestamp_ms are duplicates sent by Cursor CLI
    if (!data.timestamp_ms) {
      console.log('[CursorAguiAdapter] Skipping duplicate assistant event (no timestamp_ms)');
      return events;
    }

    // Extract text content from message
    if (data.message?.content) {
      for (const block of data.message.content) {
        if (block.type === 'text' && block.text) {
          const newText = block.text;
          
          // Start new message if needed
          if (!this.state.currentMessageId) {
            const messageId = uuidv4();
            this.state.currentMessageId = messageId;
            this.state.accumulatedText = ''; // Reset accumulated text for new message

            events.push({
              type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
              messageId,
              role: 'assistant',
              timestamp,
            });
          }

          // Track accumulated text
          this.state.accumulatedText += newText;

          // Add incremental content
          events.push({
            type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
            messageId: this.state.currentMessageId,
            content: newText,
            timestamp,
          });
        } else if (block.type === 'tool_use') {
          // Tool use embedded in assistant message
          events.push(...this.handleLegacyToolUse(block, timestamp));
        }
      }
    }

    return events;
  }

  /**
   * Handle tool_call event (with subtype started/completed)
   * Format: {"type": "tool_call", "subtype": "started|completed", "tool_call": {...}}
   */
  private handleToolCallEvent(data: any, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const subtype = data.subtype;

    if (subtype === 'started') {
      // Close any open text message first
      if (this.state.currentMessageId) {
        events.push({
          type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
          messageId: this.state.currentMessageId,
          timestamp,
        });
        this.state.currentMessageId = null;
        this.state.accumulatedText = ''; // Reset accumulated text
      }

      // Extract tool info from tool_call object
      const toolCall = data.tool_call || {};
      
      // Find the specific tool type (readToolCall, writeToolCall, etc.)
      // Keep the full xxxToolCall format for frontend CursorToolRenderer
      let toolName = 'unknown';
      let toolArgs = {};
      let toolId = uuidv4();

      for (const key of Object.keys(toolCall)) {
        if (key.endsWith('ToolCall') || key.endsWith('_tool_call')) {
          // Keep the full tool name format (e.g., "readToolCall" not "read")
          // Convert snake_case to camelCase if needed
          toolName = key.replace('_tool_call', 'ToolCall');
          const toolData = toolCall[key];
          const rawArgs = toolData.args || toolData.input || {};
          // Convert snake_case keys to camelCase for frontend compatibility
          toolArgs = convertKeysToCamelCase(rawArgs);
          toolId = toolData.id || toolId;
          break;
        }
      }

      // Track this tool call
      this.state.currentToolCallId = toolId;
      this.state.activeToolCalls.set(toolId, { name: toolName, args: toolArgs });

      events.push({
        type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
        toolCallId: toolId,
        toolName,
        timestamp,
      });

      events.push({
        type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
        toolCallId: toolId,
        args: JSON.stringify(toolArgs),
        timestamp,
      });

      events.push({
        type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
        toolCallId: toolId,
        timestamp,
      });

      console.log(`[CursorAguiAdapter] Tool started: ${toolName}`);

    } else if (subtype === 'completed') {
      // Extract result from completed tool call
      const toolCall = data.tool_call || {};
      
      // Find the specific tool type and its result
      let toolResult = '';
      let isError = false;
      let toolId = this.state.currentToolCallId || '';

      for (const key of Object.keys(toolCall)) {
        if (key.endsWith('ToolCall') || key.endsWith('_tool_call')) {
          const toolData = toolCall[key];
          toolId = toolData.id || toolId;
          
          if (toolData.result) {
            if (toolData.result.success) {
              toolResult = JSON.stringify(toolData.result.success);
            } else if (toolData.result.error) {
              toolResult = typeof toolData.result.error === 'string' 
                ? toolData.result.error 
                : JSON.stringify(toolData.result.error);
              isError = true;
            } else {
              toolResult = JSON.stringify(toolData.result);
            }
          }
          break;
        }
      }

      if (toolId) {
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: toolId,
          result: toolResult,
          isError,
          timestamp,
        });

        // Clean up tracking
        this.state.activeToolCalls.delete(toolId);
        if (this.state.currentToolCallId === toolId) {
          this.state.currentToolCallId = null;
        }
      }

      console.log(`[CursorAguiAdapter] Tool completed: ${toolId}`);
    }

    return events;
  }

  /**
   * Handle legacy text content (without --stream-partial-output)
   */
  private handleTextContent(content: string, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    // Start new message if needed
    if (!this.state.currentMessageId) {
      const messageId = uuidv4();
      this.state.currentMessageId = messageId;

      events.push({
        type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
        timestamp,
      });
    }

    // Add content chunk
    if (content && content.length > 0) {
      events.push({
        type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
        messageId: this.state.currentMessageId,
        content,
        timestamp,
      });
    }

    return events;
  }

  /**
   * Handle legacy tool use (without --stream-partial-output)
   */
  private handleLegacyToolUse(data: any, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const toolCallId = data.id || uuidv4();

    // Close previous message if open
    if (this.state.currentMessageId) {
      events.push({
        type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
        messageId: this.state.currentMessageId,
        timestamp,
      });
      this.state.currentMessageId = null;
    }

    // Start tool call
    this.state.currentToolCallId = toolCallId;

    // Convert tool name to Cursor format if needed (e.g., "Read" -> "readToolCall")
    let toolName = data.name || 'unknown';
    if (!toolName.endsWith('ToolCall')) {
      toolName = toolName.charAt(0).toLowerCase() + toolName.slice(1) + 'ToolCall';
    }

    events.push({
      type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
      toolCallId,
      toolName,
      timestamp,
    });

    // Send tool arguments
    if (data.input) {
      // Convert snake_case keys to camelCase for frontend compatibility
      const convertedInput = convertKeysToCamelCase(data.input);
      events.push({
        type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
        toolCallId,
        args: JSON.stringify(convertedInput),
        timestamp,
      });
    }

    // End tool call
    events.push({
      type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
      toolCallId,
      timestamp,
    });

    return events;
  }

  /**
   * Handle tool result (legacy format)
   */
  private handleToolResult(data: any, timestamp: number): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    if (this.state.currentToolCallId || data.tool_use_id) {
      events.push({
        type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
        toolCallId: data.tool_use_id || this.state.currentToolCallId || '',
        result: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
        isError: data.is_error || false,
        timestamp,
      });
    }

    return events;
  }

  /**
   * Finalize the stream (close any open messages)
   */
  finalize(): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    // Close open message
    if (this.state.currentMessageId) {
      events.push({
        type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
        messageId: this.state.currentMessageId,
        timestamp,
      });
      this.state.currentMessageId = null;
      this.state.accumulatedText = ''; // Reset accumulated text
    }

    // Add RUN_FINISHED
    events.push(this.createRunFinished());

    return events;
  }

  /**
   * Reset adapter state
   */
  reset(): void {
    this.state = {
      currentMessageId: null,
      currentToolCallId: null,
      activeToolCalls: new Map(),
      accumulatedText: '',
    };
  }

  /**
   * Get the thread ID (session ID)
   */
  getThreadId(): string {
    return this.threadId;
  }

  /**
   * Set the thread ID
   */
  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }
}
