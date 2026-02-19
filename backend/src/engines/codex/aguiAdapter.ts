/**
 * Codex CLI to AGUI Adapter
 *
 * Converts `codex exec --json` JSONL events into standardized AGUI events.
 */

import { v4 as uuidv4 } from 'uuid';
import type { AGUIEvent, AGUIEventType } from '../types.js';

interface ToolCallState {
  name: string;
  args: Record<string, unknown>;
  outputChunks: string[];
}

interface AdapterState {
  runStarted: boolean;
  runFinished: boolean;
  currentMessageId: string | null;
  currentThinkingId: string | null;
  activeToolCalls: Map<string, ToolCallState>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeMcpToolName(server: string | null, tool: string | null): string {
  if (!server || !tool) return 'mcp__unknown__unknown';
  return `mcp__${server}__${tool}`;
}

function extractItemText(item: Record<string, unknown>): string | null {
  const directText = asString(item.text);
  if (directText) return directText;

  const content = item.content;
  if (typeof content === 'string' && content.length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const record = part as Record<string, unknown>;
      const text = asString(record.text) || asString(record.content);
      if (text) {
        chunks.push(text);
      }
    }
    if (chunks.length > 0) {
      return chunks.join('');
    }
  }

  return null;
}

export class CodexAguiAdapter {
  private state: AdapterState = {
    runStarted: false,
    runFinished: false,
    currentMessageId: null,
    currentThinkingId: null,
    activeToolCalls: new Map(),
  };

  private runId: string;
  private threadId: string;

  constructor(threadId?: string, runId?: string) {
    this.threadId = threadId || uuidv4();
    this.runId = runId || uuidv4();
  }

  createRunStarted(input?: unknown): AGUIEvent {
    return {
      type: 'RUN_STARTED' as AGUIEventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
      input,
      timestamp: Date.now(),
    } as AGUIEvent;
  }

  createRunFinished(result?: unknown): AGUIEvent {
    return {
      type: 'RUN_FINISHED' as AGUIEventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
      result,
      timestamp: Date.now(),
    } as AGUIEvent;
  }

  createRunError(message: string, code?: string): AGUIEvent {
    return {
      type: 'RUN_ERROR' as AGUIEventType.RUN_ERROR,
      error: message,
      code,
      timestamp: Date.now(),
    } as AGUIEvent;
  }

  parseStreamLine(line: string): AGUIEvent[] {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) return [];

    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      return this.convertCodexEvent(data);
    } catch {
      return [];
    }
  }

  private ensureRunStarted(events: AGUIEvent[], input?: unknown): void {
    if (this.state.runStarted) return;
    this.state.runStarted = true;
    events.push(this.createRunStarted(input));
  }

  private startMessageIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (this.state.currentMessageId) return;
    const messageId = uuidv4();
    this.state.currentMessageId = messageId;
    events.push({
      type: 'TEXT_MESSAGE_START' as AGUIEventType.TEXT_MESSAGE_START,
      messageId,
      role: 'assistant',
      timestamp,
    } as AGUIEvent);
  }

  private closeMessageIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (!this.state.currentMessageId) return;
    events.push({
      type: 'TEXT_MESSAGE_END' as AGUIEventType.TEXT_MESSAGE_END,
      messageId: this.state.currentMessageId,
      timestamp,
    } as AGUIEvent);
    this.state.currentMessageId = null;
  }

  private startThinkingIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (this.state.currentThinkingId) return;
    const messageId = uuidv4();
    this.state.currentThinkingId = messageId;
    events.push({
      type: 'THINKING_START' as AGUIEventType.THINKING_START,
      messageId,
      timestamp,
    } as AGUIEvent);
  }

  private closeThinkingIfNeeded(events: AGUIEvent[], timestamp: number): void {
    if (!this.state.currentThinkingId) return;
    events.push({
      type: 'THINKING_END' as AGUIEventType.THINKING_END,
      messageId: this.state.currentThinkingId,
      timestamp,
    } as AGUIEvent);
    this.state.currentThinkingId = null;
  }

  private convertCodexEvent(data: Record<string, unknown>): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();
    const rawType = asString(data.type) || 'unknown';
    const eventType = rawType.replace(/\./g, '_').toLowerCase();

    switch (eventType) {
      case 'thread_started': {
        const nextThreadId = asString(data.thread_id) || this.threadId;
        const prevThreadId = this.threadId;
        this.threadId = nextThreadId;

        this.ensureRunStarted(events, { threadId: nextThreadId });
        if (this.state.runStarted && prevThreadId !== nextThreadId) {
          events.push({
            type: 'CUSTOM' as AGUIEventType.CUSTOM,
            name: 'session_id_updated',
            data: { sessionId: nextThreadId },
            threadId: nextThreadId,
            timestamp,
          } as AGUIEvent);
        }
        break;
      }

      case 'task_started':
      case 'turn_started':
        this.ensureRunStarted(events);
        break;

      case 'agent_message_delta':
      case 'agent_message_content_delta': {
        const delta = asString(data.delta);
        if (!delta) break;

        this.ensureRunStarted(events);
        this.closeThinkingIfNeeded(events, timestamp);
        this.startMessageIfNeeded(events, timestamp);
        events.push({
          type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
          messageId: this.state.currentMessageId!,
          content: delta,
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'agent_message': {
        const message = asString(data.message);
        if (!message) break;

        this.ensureRunStarted(events);
        this.closeThinkingIfNeeded(events, timestamp);
        this.startMessageIfNeeded(events, timestamp);
        events.push({
          type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
          messageId: this.state.currentMessageId!,
          content: message,
          timestamp,
        } as AGUIEvent);
        this.closeMessageIfNeeded(events, timestamp);
        break;
      }

      case 'agent_reasoning_delta':
      case 'reasoning_content_delta':
      case 'agent_reasoning_raw_content_delta':
      case 'reasoning_raw_content_delta': {
        const delta = asString(data.delta);
        if (!delta) break;

        this.ensureRunStarted(events);
        this.closeMessageIfNeeded(events, timestamp);
        this.startThinkingIfNeeded(events, timestamp);
        events.push({
          type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
          messageId: this.state.currentThinkingId!,
          content: delta,
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'agent_reasoning':
      case 'agent_reasoning_raw_content': {
        const text = asString(data.text) || asString(data.content);
        if (!text) break;

        this.ensureRunStarted(events);
        this.closeMessageIfNeeded(events, timestamp);
        this.startThinkingIfNeeded(events, timestamp);
        events.push({
          type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
          messageId: this.state.currentThinkingId!,
          content: text,
          timestamp,
        } as AGUIEvent);
        this.closeThinkingIfNeeded(events, timestamp);
        break;
      }

      case 'item_completed': {
        const item = (data.item || {}) as Record<string, unknown>;
        const itemType = asString(item.type);
        const text = extractItemText(item);
        if (!itemType || !text) break;

        this.ensureRunStarted(events);

        if (itemType === 'reasoning') {
          this.closeMessageIfNeeded(events, timestamp);
          this.startThinkingIfNeeded(events, timestamp);
          events.push({
            type: 'THINKING_CONTENT' as AGUIEventType.THINKING_CONTENT,
            messageId: this.state.currentThinkingId!,
            content: text,
            timestamp,
          } as AGUIEvent);
          this.closeThinkingIfNeeded(events, timestamp);
          break;
        }

        if (itemType === 'agent_message') {
          this.closeThinkingIfNeeded(events, timestamp);
          this.startMessageIfNeeded(events, timestamp);
          events.push({
            type: 'TEXT_MESSAGE_CONTENT' as AGUIEventType.TEXT_MESSAGE_CONTENT,
            messageId: this.state.currentMessageId!,
            content: text,
            timestamp,
          } as AGUIEvent);
          this.closeMessageIfNeeded(events, timestamp);
        }
        break;
      }

      case 'exec_command_begin': {
        const callId = asString(data.call_id) || uuidv4();
        const parsedCmd = Array.isArray(data.parsed_cmd)
          ? data.parsed_cmd.filter((x): x is string => typeof x === 'string')
          : [];
        const command = parsedCmd.length > 0
          ? parsedCmd.join(' ')
          : Array.isArray(data.command)
            ? data.command.filter((x): x is string => typeof x === 'string').join(' ')
            : '';
        const args: Record<string, unknown> = {
          command,
          cwd: asString(data.cwd) || undefined,
        };

        this.ensureRunStarted(events);
        this.state.activeToolCalls.set(callId, {
          name: 'shellToolCall',
          args,
          outputChunks: [],
        });

        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: callId,
          toolName: 'shellToolCall',
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: callId,
          args: JSON.stringify(args),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'exec_command_output_delta': {
        const callId = asString(data.call_id);
        const chunk = asString(data.chunk);
        if (!callId || !chunk) break;
        const toolCall = this.state.activeToolCalls.get(callId);
        if (toolCall) {
          toolCall.outputChunks.push(chunk);
        }
        break;
      }

      case 'exec_command_end': {
        const callId = asString(data.call_id) || uuidv4();
        const toolCall = this.state.activeToolCalls.get(callId);

        const formattedOutput = asString(data.formatted_output);
        const stdout = asString(data.stdout);
        const stderr = asString(data.stderr);
        const result =
          formattedOutput ||
          [stdout, stderr, ...(toolCall?.outputChunks || [])].filter(Boolean).join('\n');

        const exitCode = typeof data.exit_code === 'number' ? data.exit_code : 0;
        const status = asString(data.status);
        const isError = exitCode !== 0 || status === 'failed' || status === 'error';

        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: callId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: callId,
          result: result || '',
          isError,
          timestamp,
        } as AGUIEvent);
        this.state.activeToolCalls.delete(callId);
        break;
      }

      case 'mcp_tool_call_begin': {
        const callId = asString(data.call_id) || uuidv4();
        const invocation = (data.invocation || {}) as Record<string, unknown>;
        const server = asString(invocation.server);
        const tool = asString(invocation.tool);
        const toolName = normalizeMcpToolName(server, tool);
        const args = (invocation.arguments || {}) as Record<string, unknown>;

        this.ensureRunStarted(events);
        this.state.activeToolCalls.set(callId, {
          name: toolName,
          args,
          outputChunks: [],
        });

        events.push({
          type: 'TOOL_CALL_START' as AGUIEventType.TOOL_CALL_START,
          toolCallId: callId,
          toolName,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_ARGS' as AGUIEventType.TOOL_CALL_ARGS,
          toolCallId: callId,
          args: JSON.stringify(args),
          timestamp,
        } as AGUIEvent);
        break;
      }

      case 'mcp_tool_call_end': {
        const callId = asString(data.call_id) || uuidv4();
        const result = (data.result ?? '') as unknown;
        const isError =
          typeof result === 'object' &&
          result !== null &&
          ((result as Record<string, unknown>).is_error === true ||
            (result as Record<string, unknown>).error !== undefined);

        events.push({
          type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
          toolCallId: callId,
          timestamp,
        } as AGUIEvent);
        events.push({
          type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
          toolCallId: callId,
          result,
          isError,
          timestamp,
        } as AGUIEvent);
        this.state.activeToolCalls.delete(callId);
        break;
      }

      case 'turn_failed': {
        const errorMessage =
          asString((data.error as Record<string, unknown> | undefined)?.message) ||
          asString(data.message) ||
          'Codex turn failed';
        this.ensureRunStarted(events);
        events.push(this.createRunError(errorMessage, 'TURN_FAILED'));
        break;
      }

      case 'turn_aborted': {
        const reason = asString(data.reason) || 'aborted';
        this.ensureRunStarted(events);
        events.push(this.createRunError(`Turn aborted: ${reason}`, 'TURN_ABORTED'));
        break;
      }

      case 'error':
      case 'stream_error': {
        const errorMessage =
          asString(data.message) ||
          asString((data.error as Record<string, unknown> | undefined)?.message) ||
          'Codex stream error';
        this.ensureRunStarted(events);
        events.push(this.createRunError(errorMessage, 'CODEX_ERROR'));
        break;
      }

      case 'task_complete':
      case 'turn_complete':
      case 'turn_completed':
        this.closeThinkingIfNeeded(events, timestamp);
        this.closeMessageIfNeeded(events, timestamp);
        if (!this.state.runFinished) {
          events.push(this.createRunFinished());
          this.state.runFinished = true;
        }
        break;

      default:
        events.push({
          type: 'RAW' as AGUIEventType.RAW,
          source: 'codex',
          event: data,
          timestamp,
        } as AGUIEvent);
    }

    return events;
  }

  finalize(): AGUIEvent[] {
    const events: AGUIEvent[] = [];
    const timestamp = Date.now();

    this.closeThinkingIfNeeded(events, timestamp);
    this.closeMessageIfNeeded(events, timestamp);

    for (const [callId, toolCall] of this.state.activeToolCalls) {
      events.push({
        type: 'TOOL_CALL_END' as AGUIEventType.TOOL_CALL_END,
        toolCallId: callId,
        timestamp,
      } as AGUIEvent);
      events.push({
        type: 'TOOL_CALL_RESULT' as AGUIEventType.TOOL_CALL_RESULT,
        toolCallId: callId,
        result: toolCall.outputChunks.join(''),
        isError: false,
        timestamp,
      } as AGUIEvent);
    }
    this.state.activeToolCalls.clear();

    if (!this.state.runStarted) {
      this.state.runStarted = true;
      events.push(this.createRunStarted());
    }

    if (!this.state.runFinished) {
      this.state.runFinished = true;
      events.push(this.createRunFinished());
    }

    return events;
  }

  getThreadId(): string {
    return this.threadId;
  }

  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }
}
