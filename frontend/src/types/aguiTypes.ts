/**
 * AGUI (Agent-User Interaction Protocol) Types
 * Based on the AG-UI protocol specification
 * @see https://ag-ui.com/concepts/architecture
 */

/** AGUI Event Types - 16 standardized event types */
export enum AGUIEventType {
  // Lifecycle events
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  STEP_STARTED = 'STEP_STARTED',
  STEP_FINISHED = 'STEP_FINISHED',

  // Text message events
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',

  // Thinking events (extended types for reasoning)
  THINKING_START = 'THINKING_START',
  THINKING_CONTENT = 'THINKING_CONTENT',
  THINKING_END = 'THINKING_END',

  // Tool call events
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',

  // State management events
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',

  // Special events
  RAW = 'RAW',
  CUSTOM = 'CUSTOM',
}

/** Base AGUI Event */
export interface AGUIBaseEvent {
  type: AGUIEventType;
  timestamp?: number;
  threadId?: string;
  runId?: string;
  rawEvent?: unknown;
}

/** RUN_STARTED event */
export interface AGUIRunStartedEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_STARTED;
  threadId: string;
  runId: string;
}

/** RUN_FINISHED event */
export interface AGUIRunFinishedEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_FINISHED;
  threadId: string;
  runId: string;
}

/** RUN_ERROR event */
export interface AGUIRunErrorEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_ERROR;
  error: string;
  message?: string;
}

/** TEXT_MESSAGE_START event */
export interface AGUITextMessageStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_START;
  messageId: string;
}

/** TEXT_MESSAGE_CONTENT event */
export interface AGUITextMessageContentEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  content: string;
}

/** TEXT_MESSAGE_END event */
export interface AGUITextMessageEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_END;
  messageId: string;
}

/** THINKING_START event */
export interface AGUIThinkingStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_START;
  messageId: string;
}

/** THINKING_CONTENT event */
export interface AGUIThinkingContentEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_CONTENT;
  messageId: string;
  content: string;
}

/** THINKING_END event */
export interface AGUIThinkingEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_END;
  messageId: string;
}

/** TOOL_CALL_START event */
export interface AGUIToolCallStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_START;
  toolId: string;
  toolName: string;
}

/** TOOL_CALL_ARGS event */
export interface AGUIToolCallArgsEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_ARGS;
  toolId: string;
  args: string; // Partial JSON string
}

/** TOOL_CALL_END event */
export interface AGUIToolCallEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_END;
  toolId: string;
  result?: unknown;
  isError?: boolean;
}

/** MESSAGES_SNAPSHOT event */
export interface AGUIMessagesSnapshotEvent extends AGUIBaseEvent {
  type: AGUIEventType.MESSAGES_SNAPSHOT;
  messages: AGUIMessage[];
}

/** STATE_SNAPSHOT event */
export interface AGUIStateSnapshotEvent extends AGUIBaseEvent {
  type: AGUIEventType.STATE_SNAPSHOT;
  state: Record<string, unknown>;
}

/** STATE_DELTA event - uses JSON Patch format (RFC 6902) */
export interface AGUIStateDeltaEvent extends AGUIBaseEvent {
  type: AGUIEventType.STATE_DELTA;
  delta: Array<{
    op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
    path: string;
    value?: unknown;
  }>;
}

/** CUSTOM event */
export interface AGUICustomEvent extends AGUIBaseEvent {
  type: AGUIEventType.CUSTOM;
  name: string;
  data: unknown;
}

/** Union of all AGUI events */
export type AGUIEvent =
  | AGUIRunStartedEvent
  | AGUIRunFinishedEvent
  | AGUIRunErrorEvent
  | AGUITextMessageStartEvent
  | AGUITextMessageContentEvent
  | AGUITextMessageEndEvent
  | AGUIThinkingStartEvent
  | AGUIThinkingContentEvent
  | AGUIThinkingEndEvent
  | AGUIToolCallStartEvent
  | AGUIToolCallArgsEvent
  | AGUIToolCallEndEvent
  | AGUIMessagesSnapshotEvent
  | AGUIStateSnapshotEvent
  | AGUIStateDeltaEvent
  | AGUICustomEvent;

/** AGUI Message format */
export interface AGUIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: AGUIMessagePart[];
  createdAt?: number;
}

/** AGUI Message Part */
export interface AGUIMessagePart {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';
  content?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  isError?: boolean;
}
