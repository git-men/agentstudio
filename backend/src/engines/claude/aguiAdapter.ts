/**
 * Claude SDK to AGUI Adapter
 * 
 * Converts Claude Agent SDK messages to standardized AGUI events.
 * This adapter is the bridge between Claude SDK's output format and
 * the unified AGUI protocol that the frontend expects.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AGUIEvent,
  AGUIEventType,
} from '../types.js';

/**
 * Claude SDK Message types (from @anthropic-ai/claude-agent-sdk)
 */
interface ClaudeSDKMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    id?: string;
    role?: string;
    content?: unknown[];
  };
  event?: {
    type: string;
    index?: number;
    content_block?: {
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
    };
    delta?: {
      type: string;
      text?: string;
      thinking?: string;
      partial_json?: string;
    };
    message?: {
      id: string;
      role: string;
    };
  };
  isSidechain?: boolean;
  parentToolUseId?: string;
}

/**
 * Adapter state for tracking streaming context
 */
interface AdapterState {
  currentRunId: string | null;
  currentMessageId: string | null;
  activeBlocks: Map<number, {
    type: 'text' | 'thinking' | 'tool_use';
    id: string;
    accumulatedContent: string;
  }>;
  sessionId: string | null;
}

/**
 * Claude SDK to AGUI Adapter
 */
export class ClaudeAguiAdapter {
  private state: AdapterState;
  private threadId: string;

  constructor(threadId?: string) {
    this.threadId = threadId || uuidv4();
    this.state = {
      currentRunId: null,
      currentMessageId: null,
      activeBlocks: new Map(),
      sessionId: null,
    };
  }

  /**
   * Reset adapter state for a new conversation
   */
  reset(): void {
    this.state = {
      currentRunId: null,
      currentMessageId: null,
      activeBlocks: new Map(),
      sessionId: null,
    };
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.state.sessionId;
  }

  /**
   * Set the thread ID (session ID)
   */
  setThreadId(threadId: string): void {
    this.threadId = threadId;
    this.state.sessionId = threadId;
  }

  /**
   * Create RUN_STARTED event
   */
  createRunStarted(input?: unknown): AGUIEvent {
    this.state.currentRunId = uuidv4();
    return {
      type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.state.currentRunId,
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
      runId: this.state.currentRunId || '',
      result,
      timestamp: Date.now(),
    };
  }

  /**
   * Create RUN_ERROR event
   */
  createRunError(error: string, code?: string): AGUIEvent {
    return {
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error,
      code,
      timestamp: Date.now(),
    };
  }

  /**
   * Convert Claude SDK message to AGUI events
   * 
   * @param sdkMessage - Claude SDK message
   * @returns Array of AGUI events
   */
  convert(sdkMessage: ClaudeSDKMessage): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    // Skip sidechain events (handled separately for sub-agents)
    if (sdkMessage.isSidechain && sdkMessage.parentToolUseId) {
      return events;
    }

    // Handle system init event
    if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
      const sessionId = sdkMessage.session_id;
      if (sessionId) {
        this.state.sessionId = sessionId;
        this.threadId = sessionId;
      }
      // Note: RUN_STARTED is typically sent at the start of sendMessage
      return events;
    }

    // Handle stream_event type (nested events)
    if (sdkMessage.type === 'stream_event' && sdkMessage.event) {
      return this.convertStreamEvent(sdkMessage.event, timestamp);
    }

    // Handle assistant message type
    if (sdkMessage.type === 'assistant' && sdkMessage.message) {
      return this.convertAssistantMessage(sdkMessage.message, timestamp);
    }

    // Handle user message type (tool results)
    if (sdkMessage.type === 'user' && sdkMessage.message) {
      return this.convertUserMessage(sdkMessage.message, timestamp);
    }

    // Handle error events
    if (sdkMessage.type === 'error') {
      events.push(this.createRunError(
        (sdkMessage as any).error || 'Unknown error',
        (sdkMessage as any).code
      ));
      return events;
    }

    // Handle result events
    if (sdkMessage.type === 'result') {
      events.push(this.createRunFinished((sdkMessage as any).result));
      return events;
    }

    return events;
  }

  /**
   * Convert stream_event to AGUI events
   */
  private convertStreamEvent(
    event: NonNullable<ClaudeSDKMessage['event']>,
    timestamp: number
  ): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    switch (event.type) {
      case 'message_start':
        // Initialize message
        this.state.currentMessageId = event.message?.id || `msg-${uuidv4()}`;
        events.push({
          type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
          messageId: this.state.currentMessageId,
          role: 'assistant',
          timestamp,
        });
        break;

      case 'content_block_start':
        if (event.content_block) {
          const blockIndex = event.index ?? 0;
          const block = event.content_block;
          const blockId = block.id || `block-${blockIndex}-${timestamp}`;

          if (block.type === 'text') {
            this.state.activeBlocks.set(blockIndex, {
              type: 'text',
              id: blockId,
              accumulatedContent: '',
            });
            // Text block start is implicit in TEXT_MESSAGE_START
          } else if (block.type === 'thinking') {
            this.state.activeBlocks.set(blockIndex, {
              type: 'thinking',
              id: blockId,
              accumulatedContent: '',
            });
            events.push({
              type: 'THINKING_START' as AGUIEventType.THINKING_START,
              messageId: this.state.currentMessageId || '',
              timestamp,
            });
          } else if (block.type === 'tool_use') {
            this.state.activeBlocks.set(blockIndex, {
              type: 'tool_use',
              id: block.id || blockId,
              accumulatedContent: '',
            });
            events.push({
              type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
              toolCallId: block.id || blockId,
              toolName: block.name || 'unknown',
              parentMessageId: this.state.currentMessageId || undefined,
              timestamp,
            });
          }
        }
        break;

      case 'content_block_delta':
        if (event.delta) {
          const blockIndex = event.index ?? 0;
          const activeBlock = this.state.activeBlocks.get(blockIndex);

          if (event.delta.type === 'text_delta' && event.delta.text) {
            if (activeBlock) {
              activeBlock.accumulatedContent += event.delta.text;
            }
            events.push({
              type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
              messageId: this.state.currentMessageId || '',
              content: event.delta.text,
              timestamp,
            });
          } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            if (activeBlock) {
              activeBlock.accumulatedContent += event.delta.thinking;
            }
            events.push({
              type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
              messageId: this.state.currentMessageId || '',
              content: event.delta.thinking,
              timestamp,
            });
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json && activeBlock) {
            activeBlock.accumulatedContent += event.delta.partial_json;
            events.push({
              type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
              toolCallId: activeBlock.id,
              args: event.delta.partial_json,
              timestamp,
            });
          }
        }
        break;

      case 'content_block_stop':
        {
          const blockIndex = event.index ?? 0;
          const activeBlock = this.state.activeBlocks.get(blockIndex);

          if (activeBlock) {
            if (activeBlock.type === 'thinking') {
              events.push({
                type: 'THINKING_END' as AGUIEventType.THINKING_END,
                messageId: this.state.currentMessageId || '',
                timestamp,
              });
            } else if (activeBlock.type === 'tool_use') {
              events.push({
                type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
                toolCallId: activeBlock.id,
                timestamp,
              });
            }
            this.state.activeBlocks.delete(blockIndex);
          }
        }
        break;

      case 'message_stop':
        events.push({
          type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
          messageId: this.state.currentMessageId || '',
          timestamp,
        });
        this.state.currentMessageId = null;
        this.state.activeBlocks.clear();
        break;
    }

    return events;
  }

  /**
   * Convert assistant message to AGUI events
   */
  private convertAssistantMessage(
    message: NonNullable<ClaudeSDKMessage['message']>,
    timestamp: number
  ): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const messageId = message.id || `msg-${uuidv4()}`;

    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        const b = block as {
          type: string;
          text?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        };

        if (b.type === 'text' && b.text) {
          events.push({
            type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
            messageId,
            content: b.text,
            timestamp,
          });
        } else if (b.type === 'thinking' && b.thinking) {
          events.push(
            {
              type: 'THINKING_START' as AGUIEventType.THINKING_START,
              messageId,
              timestamp,
            },
            {
              type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
              messageId,
              content: b.thinking,
              timestamp,
            },
            {
              type: 'THINKING_END' as AGUIEventType.THINKING_END,
              messageId,
              timestamp,
            }
          );
        } else if (b.type === 'tool_use') {
          const toolId = b.id || `tool-${timestamp}`;
          events.push(
            {
              type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
              toolCallId: toolId,
              toolName: b.name || 'unknown',
              parentMessageId: messageId,
              timestamp,
            },
            {
              type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
              toolCallId: toolId,
              args: JSON.stringify(b.input || {}),
              timestamp,
            },
            {
              type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
              toolCallId: toolId,
              timestamp,
            }
          );
        }
      }
    }

    return events;
  }

  /**
   * Convert user message (tool results) to AGUI events
   */
  private convertUserMessage(
    message: NonNullable<ClaudeSDKMessage['message']>,
    timestamp: number
  ): AGUIEvent[] {
    const events: AGUIEvent[] = [];

    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        const b = block as {
          type: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };

        if (b.type === 'tool_result' && b.tool_use_id) {
          const result = typeof b.content === 'string'
            ? b.content
            : JSON.stringify(b.content);

          events.push({
            type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
            toolCallId: b.tool_use_id,
            result,
            isError: b.is_error || false,
            timestamp,
          });
        }
      }
    }

    return events;
  }

  /**
   * Finalize the stream (close any open messages)
   */
  finalize(): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    // Close any open message
    if (this.state.currentMessageId) {
      events.push({
        type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
        messageId: this.state.currentMessageId,
        timestamp,
      });
      this.state.currentMessageId = null;
    }

    // Close any open thinking/tool blocks
    for (const [index, block] of this.state.activeBlocks) {
      if (block.type === 'thinking') {
        events.push({
          type: 'THINKING_END' as AGUIEventType.THINKING_END,
          messageId: this.state.currentMessageId || '',
          timestamp,
        });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: block.id,
          timestamp,
        });
      }
    }
    this.state.activeBlocks.clear();

    // Add RUN_FINISHED
    events.push(this.createRunFinished());

    return events;
  }
}
