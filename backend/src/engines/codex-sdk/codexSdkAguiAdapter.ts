/**
 * Codex SDK to AGUI Adapter
 *
 * Converts Codex SDK ThreadEvent items into standardized AGUI events.
 * Handles all 8 item types: agent_message, reasoning, command_execution,
 * file_change, web_search, todo_list, mcp_tool_call, error.
 *
 * SDK field mapping (SDK → AGUI):
 *   - FileChangeItem.changes → files (with kind → changeType)
 *   - TodoListItem.items → tasks
 *   - McpToolCallItem.server/tool → serverName/toolName
 *   - CommandExecutionItem.aggregated_output → output
 *   - ThreadStartedEvent.thread_id → threadId
 */

import { v4 as uuidv4 } from 'uuid';
import type { AGUIEvent, AGUIEventType } from '../types.js';

interface ItemState {
  id: string;
  type: string;
  aguiToolCallId?: string;
  outputChunks: string[];
  lastTextLength: number;
}

function mapPatchKind(kind: string): string {
  switch (kind) {
    case 'add': return 'added';
    case 'delete': return 'deleted';
    case 'update': return 'modified';
    default: return kind;
  }
}

export class CodexSdkAguiAdapter {
  private runId: string;
  private threadId: string;
  private activeItems: Map<string, ItemState> = new Map();
  private currentMessageId: string | null = null;
  private currentThinkingId: string | null = null;
  private runStarted = false;
  private runFinished = false;

  constructor(threadId?: string) {
    this.threadId = threadId || uuidv4();
    this.runId = uuidv4();
  }

  convertThreadEvent(event: Record<string, unknown>): AGUIEvent[] {
    const eventType = event.type as string;
    if (!eventType) return [];

    switch (eventType) {
      case 'thread.started':
        return this.handleThreadStarted(event);
      case 'turn.started':
        return this.handleTurnStarted();
      case 'turn.completed':
        return this.handleTurnCompleted();
      case 'turn.failed':
        return this.handleTurnFailed(event);
      case 'error':
        return this.handleTopLevelError(event);
      case 'item.started':
        return this.handleItemStarted(event);
      case 'item.updated':
        return this.handleItemUpdated(event);
      case 'item.completed':
        return this.handleItemCompleted(event);
      default:
        return [];
    }
  }

  private handleThreadStarted(event: Record<string, unknown>): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();
    const newThreadId = (event.thread_id as string) || this.threadId;
    this.threadId = newThreadId;

    if (!this.runStarted) {
      this.runStarted = true;
      events.push({
        type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp,
      } as AGUIEvent);
    }

    events.push({
      type: 'CUSTOM' as AGUIEventType.CUSTOM,
      name: 'session_id_updated',
      data: { sessionId: this.threadId },
      threadId: this.threadId,
      timestamp,
    } as AGUIEvent);

    return events;
  }

  private handleTurnStarted(): AGUIEvent[] {
    if (!this.runStarted) {
      this.runStarted = true;
      return [{
        type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp: Date.now(),
      } as AGUIEvent];
    }
    return [];
  }

  private handleTurnCompleted(): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    this.closeThinkingIfNeeded(events, timestamp);
    this.closeMessageIfNeeded(events, timestamp);

    if (!this.runFinished) {
      this.runFinished = true;
      events.push({
        type: 'RUN_FINISHED' as AGUIEventType.RUN_FINISHED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp,
      } as AGUIEvent);
    }

    return events;
  }

  private handleTurnFailed(event: Record<string, unknown>): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();
    const errorObj = event.error as Record<string, unknown> | string | undefined;
    const errorMsg = typeof errorObj === 'string'
      ? errorObj
      : (errorObj?.message as string) || 'Turn failed';

    this.closeThinkingIfNeeded(events, timestamp);
    this.closeMessageIfNeeded(events, timestamp);

    events.push({
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error: errorMsg,
      code: 'TURN_FAILED',
      timestamp,
    } as AGUIEvent);

    if (!this.runFinished) {
      this.runFinished = true;
      events.push({
        type: 'RUN_FINISHED' as AGUIEventType.RUN_FINISHED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp,
      } as AGUIEvent);
    }

    return events;
  }

  private handleTopLevelError(event: Record<string, unknown>): AGUIEvent[] {
    const errorMsg = (event.message as string) || 'SDK error';
    return [{
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error: errorMsg,
      code: 'SDK_ERROR',
      timestamp: Date.now(),
    } as AGUIEvent];
  }

  private handleItemStarted(event: Record<string, unknown>): AGUIEvent[] {
    const item = (event.item || {}) as Record<string, unknown>;
    const itemId = (item.id as string) || uuidv4();
    const itemType = item.type as string;
    if (!itemType) return [];

    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    this.ensureRunStarted(events);

    const state: ItemState = {
      id: itemId,
      type: itemType,
      outputChunks: [],
      lastTextLength: 0,
    };

    switch (itemType) {
      case 'agent_message': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        this.currentMessageId = itemId;
        events.push({
          type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
          messageId: itemId,
          role: 'assistant',
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'reasoning': {
        this.closeMessageIfNeeded(events, timestamp);
        this.closeThinkingIfNeeded(events, timestamp);
        this.currentThinkingId = itemId;
        events.push({
          type: 'THINKING_START' as AGUIEventType.THINKING_START,
          messageId: itemId,
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'command_execution': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        state.aguiToolCallId = itemId;
        const command = (item.command as string) || '';
        const workingDirectory = item.workingDirectory as string | undefined;
        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: itemId,
          toolName: 'shellToolCall',
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: itemId,
          args: JSON.stringify({ command, workingDirectory }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'file_change': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        state.aguiToolCallId = itemId;
        const changes = (item.changes as Array<{ path: string; kind: string }>) || [];
        const files = changes.map(c => ({ path: c.path, changeType: mapPatchKind(c.kind) }));
        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: itemId,
          toolName: 'fileChangeToolCall',
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: itemId,
          args: JSON.stringify({ files }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'web_search': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        state.aguiToolCallId = itemId;
        const query = (item.query as string) || '';
        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: itemId,
          toolName: 'webSearchToolCall',
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: itemId,
          args: JSON.stringify({ query }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'todo_list': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        state.aguiToolCallId = itemId;
        const items = (item.items as Array<{ text: string; completed: boolean }>) || [];
        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: itemId,
          toolName: 'todoListToolCall',
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: itemId,
          args: JSON.stringify({ tasks: items }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'mcp_tool_call': {
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        state.aguiToolCallId = itemId;
        const server = (item.server as string) || 'unknown';
        const tool = (item.tool as string) || 'unknown';
        const mcpToolName = `mcp__${server}__${tool}`;
        const args = (item.arguments as Record<string, unknown>) || {};
        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: itemId,
          toolName: mcpToolName,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: itemId,
          args: JSON.stringify(args),
          timestamp,
        } as AGUIEvent);
        break;
      }
    }

    this.activeItems.set(itemId, state);
    return events;
  }

  private handleItemUpdated(event: Record<string, unknown>): AGUIEvent[] {
    const item = (event.item || {}) as Record<string, unknown>;
    const itemId = (item.id as string) || '';
    const itemType = item.type as string;
    if (!itemType) return [];

    const events: AGUIEvent[] = [];
    const timestamp = Date.now();
    const state = this.activeItems.get(itemId);

    switch (itemType) {
      case 'agent_message': {
        const text = item.text as string | undefined;
        if (text && state && this.currentMessageId === itemId) {
          const delta = text.slice(state.lastTextLength);
          state.lastTextLength = text.length;
          if (delta) {
            events.push({
              type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
              messageId: itemId,
              content: delta,
              timestamp,
            } as AGUIEvent);
          }
        }
        break;
      }

      case 'reasoning': {
        const text = item.text as string | undefined;
        if (text && state && this.currentThinkingId === itemId) {
          const delta = text.slice(state.lastTextLength);
          state.lastTextLength = text.length;
          if (delta) {
            events.push({
              type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
              messageId: itemId,
              content: delta,
              timestamp,
            } as AGUIEvent);
          }
        }
        break;
      }

      case 'command_execution': {
        const output = item.aggregated_output as string | undefined;
        if (output && state) {
          state.outputChunks = [output];
        }
        break;
      }

      case 'todo_list': {
        const items = item.items as Array<{ text: string; completed: boolean }> | undefined;
        if (items && state?.aguiToolCallId) {
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: state.aguiToolCallId,
            args: JSON.stringify({ tasks: items }),
            timestamp,
          } as AGUIEvent);
        }
        break;
      }
    }

    return events;
  }

  private handleItemCompleted(event: Record<string, unknown>): AGUIEvent[] {
    const item = (event.item || {}) as Record<string, unknown>;
    const itemId = (item.id as string) || '';
    const itemType = item.type as string;
    if (!itemType) return [];

    const events: AGUIEvent[] = [];
    const timestamp = Date.now();
    const state = this.activeItems.get(itemId);

    switch (itemType) {
      case 'agent_message': {
        const text = (item.text as string) || '';
        const wasTracked = this.currentMessageId === itemId;
        if (!wasTracked) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          events.push({
            type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
            messageId: itemId,
            role: 'assistant',
            timestamp,
          } as AGUIEvent);
          if (text) {
            events.push({
              type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
              messageId: itemId,
              content: text,
              timestamp,
            } as AGUIEvent);
          }
        }
        events.push({
          type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
          messageId: itemId,
          timestamp,
        } as AGUIEvent);
        this.currentMessageId = null;
        break;
      }

      case 'reasoning': {
        const text = (item.text as string) || '';
        const wasTracked = this.currentThinkingId === itemId;
        if (!wasTracked) {
          this.closeMessageIfNeeded(events, timestamp);
          this.closeThinkingIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          events.push({
            type: 'THINKING_START' as AGUIEventType.THINKING_START,
            messageId: itemId,
            timestamp,
          } as AGUIEvent);
          if (text) {
            events.push({
              type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
              messageId: itemId,
              content: text,
              timestamp,
            } as AGUIEvent);
          }
        }
        events.push({
          type: 'THINKING_END' as AGUIEventType.THINKING_END,
          messageId: itemId,
          timestamp,
        } as AGUIEvent);
        this.currentThinkingId = null;
        break;
      }

      case 'command_execution': {
        const exitCode = typeof item.exit_code === 'number' ? item.exit_code : 0;
        const output = (item.aggregated_output as string) || state?.outputChunks.join('') || '';
        if (!state) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          const command = (item.command as string) || '';
          events.push({
            type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
            toolCallId: itemId,
            toolName: 'shellToolCall',
            timestamp,
          } as AGUIEvent);
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: itemId,
            args: JSON.stringify({ command }),
            timestamp,
          } as AGUIEvent);
        }
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: itemId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: itemId,
          result: JSON.stringify({ output, exit_code: exitCode }),
          isError: exitCode !== 0,
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'file_change': {
        const changes = (item.changes as Array<{ path: string; kind: string }>) || [];
        const files = changes.map(c => ({ path: c.path, changeType: mapPatchKind(c.kind) }));
        const status = (item.status as string) || 'completed';
        if (!state) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          events.push({
            type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
            toolCallId: itemId,
            toolName: 'fileChangeToolCall',
            timestamp,
          } as AGUIEvent);
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: itemId,
            args: JSON.stringify({ files }),
            timestamp,
          } as AGUIEvent);
        }
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: itemId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: itemId,
          result: JSON.stringify({ status, fileCount: files.length, files }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'web_search': {
        if (!state) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          const query = (item.query as string) || '';
          events.push({
            type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
            toolCallId: itemId,
            toolName: 'webSearchToolCall',
            timestamp,
          } as AGUIEvent);
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: itemId,
            args: JSON.stringify({ query }),
            timestamp,
          } as AGUIEvent);
        }
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: itemId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: itemId,
          result: JSON.stringify({ status: 'completed' }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'todo_list': {
        const items = (item.items as Array<{ text: string; completed: boolean }>) || [];
        if (!state) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          events.push({
            type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
            toolCallId: itemId,
            toolName: 'todoListToolCall',
            timestamp,
          } as AGUIEvent);
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: itemId,
            args: JSON.stringify({ tasks: items }),
            timestamp,
          } as AGUIEvent);
        }
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: itemId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: itemId,
          result: JSON.stringify({
            status: 'completed',
            taskCount: items.length,
            completedCount: items.filter(t => t.completed).length,
          }),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'mcp_tool_call': {
        const result = item.result as Record<string, unknown> | undefined;
        const error = item.error as Record<string, unknown> | undefined;
        const status = item.status as string | undefined;
        const isError = status === 'failed' || !!error;
        if (!state) {
          this.closeThinkingIfNeeded(events, timestamp);
          this.closeMessageIfNeeded(events, timestamp);
          this.ensureRunStarted(events);
          const server = (item.server as string) || 'unknown';
          const tool = (item.tool as string) || 'unknown';
          const mcpToolName = `mcp__${server}__${tool}`;
          const args = (item.arguments as Record<string, unknown>) || {};
          events.push({
            type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
            toolCallId: itemId,
            toolName: mcpToolName,
            timestamp,
          } as AGUIEvent);
          events.push({
            type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
            toolCallId: itemId,
            args: JSON.stringify(args),
            timestamp,
          } as AGUIEvent);
        }
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: itemId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: itemId,
          result: JSON.stringify(error ? { error: error.message } : (result || {})),
          isError,
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'error': {
        const message = (item.message as string) || 'Unknown error';
        this.ensureRunStarted(events);
        events.push({
          type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
          error: message,
          code: 'ITEM_ERROR',
          timestamp,
        } as AGUIEvent);
        break;
      }
    }

    this.activeItems.delete(itemId);
    return events;
  }

  handleError(error: Error): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    this.ensureRunStarted(events);
    events.push({
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error: error.message,
      code: 'SDK_ERROR',
      timestamp: Date.now(),
    } as AGUIEvent);
    return events;
  }

  finalize(): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    this.closeThinkingIfNeeded(events, timestamp);
    this.closeMessageIfNeeded(events, timestamp);

    for (const [callId, state] of this.activeItems) {
      if (state.aguiToolCallId) {
        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: callId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: callId,
          result: JSON.stringify({ status: 'interrupted' }),
          isError: false,
          timestamp,
        } as AGUIEvent);
      }
    }
    this.activeItems.clear();

    if (!this.runStarted) {
      this.runStarted = true;
      events.push({
        type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp,
      } as AGUIEvent);
    }

    if (!this.runFinished) {
      this.runFinished = true;
      events.push({
        type: 'RUN_FINISHED' as AGUIEventType.RUN_FINISHED,
        threadId: this.threadId,
        runId: this.runId,
        timestamp,
      } as AGUIEvent);
    }

    return events;
  }

  getThreadId(): string {
    return this.threadId;
  }

  private ensureRunStarted(events: AGUIEvent[]): void {
    if (this.runStarted) return;
    this.runStarted = true;
    events.push({
      type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
      timestamp: Date.now(),
    } as AGUIEvent);
  }

  private closeMessageIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (!this.currentMessageId) return;
    events.push({
      type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
      messageId: this.currentMessageId,
      timestamp,
    } as AGUIEvent);
    this.currentMessageId = null;
  }

  private closeThinkingIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (!this.currentThinkingId) return;
    events.push({
      type: 'THINKING_END' as AGUIEventType.THINKING_END,
      messageId: this.currentThinkingId,
      timestamp,
    } as AGUIEvent);
    this.currentThinkingId = null;
  }
}
