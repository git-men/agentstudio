/**
 * Engine Layer Type Definitions
 * 
 * This module defines the unified interface for different AI agent engines.
 * Each engine (Claude, Cursor, etc.) implements this interface and outputs
 * standardized AGUI events.
 */

// =============================================================================
// Engine Types
// =============================================================================

/**
 * Supported engine types
 */
export type EngineType = 'claude' | 'cursor' | 'codebuddy';

/**
 * Image data for engine requests
 */
export interface EngineImageData {
  /** Unique identifier for the image */
  id: string;
  /** Base64 encoded image data (without data URI prefix) */
  data: string;
  /** Media type of the image */
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Optional filename */
  filename?: string;
}

/**
 * Engine configuration for a chat request
 */
export interface EngineConfig {
  /** Engine type to use */
  type: EngineType;
  
  /** Working directory for the agent */
  workspace: string;
  
  /** Model to use (engine-specific) */
  model?: string;
  
  /** Session ID for multi-turn conversations */
  sessionId?: string;
  
  /** Images to include in the message */
  images?: EngineImageData[];
  
  // Shared options
  /** Permission mode */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  /** MCP tools to enable (frontend-selected tool IDs) */
  mcpTools?: string[];
  /** Environment variables */
  envVars?: Record<string, string>;
  
  // Claude-specific options
  /** Provider ID (only for Claude engine) */
  providerId?: string;
  
  // Cursor-specific options
  /** Command timeout in milliseconds */
  timeout?: number;
  
  /** Frontend tool definitions sent inline with the chat request */
  frontendTools?: Array<{
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    mcpServerName?: string;
    resultFormat?: 'json' | 'text';
  }>;
}

/**
 * Engine capabilities declaration
 * Used to dynamically adjust UI based on engine features
 */
export interface EngineCapabilities {
  /** MCP support */
  mcp: {
    supported: boolean;
    configPath?: string;
    dynamicToolLoading?: boolean;
  };
  
  /** Skills/Rules support */
  skills: {
    supported: boolean;
    skillsPath?: string;
    ruleFormat?: 'markdown' | 'json';
  };
  
  /** Feature flags */
  features: {
    multiTurn: boolean;
    thinking: boolean;
    vision: boolean;
    streaming: boolean;
    subagents: boolean;
    codeExecution: boolean;
  };
  
  /** Supported permission modes */
  permissionModes: ('default' | 'acceptEdits' | 'bypassPermissions' | 'plan')[];
  
  /** UI feature visibility - controls which UI elements to show */
  ui: {
    /** Show MCP tool selector */
    showMcpToolSelector: boolean;
    /** Show image upload button */
    showImageUpload: boolean;
    /** Show permission mode selector */
    showPermissionSelector: boolean;
    /** Show provider/version selector */
    showProviderSelector: boolean;
    /** Show model selector */
    showModelSelector: boolean;
    /** Show environment variables editor */
    showEnvVars: boolean;
  };
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  isVision?: boolean;
  isThinking?: boolean;
  description?: string;
}

/**
 * Engine session information
 */
export interface EngineSession {
  id: string;
  engineType: EngineType;
  workspace: string;
  createdAt: Date;
  lastActivity: Date;
}

// =============================================================================
// AGUI Event Types
// Based on AG-UI Protocol: https://docs.ag-ui.com/concepts/events
// =============================================================================

/**
 * AGUI Event Types
 */
export enum AGUIEventType {
  // Lifecycle Events
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  STEP_STARTED = 'STEP_STARTED',
  STEP_FINISHED = 'STEP_FINISHED',

  // Text Message Events
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',

  // Thinking Events (extended)
  THINKING_START = 'THINKING_START',
  THINKING_CONTENT = 'THINKING_CONTENT',
  THINKING_END = 'THINKING_END',

  // Tool Call Events
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',
  TOOL_CALL_RESULT = 'TOOL_CALL_RESULT',

  // State Management Events
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',

  // Special Events
  RAW = 'RAW',
  CUSTOM = 'CUSTOM',
}

/**
 * Base AGUI Event
 */
export interface AGUIBaseEvent {
  type: AGUIEventType;
  timestamp: number;
  threadId?: string;
  runId?: string;
}

/**
 * RUN_STARTED event
 */
export interface AGUIRunStartedEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_STARTED;
  threadId: string;
  runId: string;
  input?: unknown;
}

/**
 * RUN_FINISHED event
 */
export interface AGUIRunFinishedEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_FINISHED;
  threadId: string;
  runId: string;
  result?: unknown;
}

/**
 * RUN_ERROR event
 */
export interface AGUIRunErrorEvent extends AGUIBaseEvent {
  type: AGUIEventType.RUN_ERROR;
  error: string;
  code?: string;
  message?: string;
}

/**
 * TEXT_MESSAGE_START event
 */
export interface AGUITextMessageStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_START;
  messageId: string;
  role?: 'assistant' | 'user' | 'system';
}

/**
 * TEXT_MESSAGE_CONTENT event
 */
export interface AGUITextMessageContentEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  content: string;
}

/**
 * TEXT_MESSAGE_END event
 */
export interface AGUITextMessageEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.TEXT_MESSAGE_END;
  messageId: string;
}

/**
 * THINKING_START event
 */
export interface AGUIThinkingStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_START;
  messageId: string;
}

/**
 * THINKING_CONTENT event
 */
export interface AGUIThinkingContentEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_CONTENT;
  messageId: string;
  content: string;
}

/**
 * THINKING_END event
 */
export interface AGUIThinkingEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.THINKING_END;
  messageId: string;
}

/**
 * TOOL_CALL_START event
 */
export interface AGUIToolCallStartEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_START;
  toolCallId: string;
  toolName: string;
  parentMessageId?: string;
}

/**
 * TOOL_CALL_ARGS event
 */
export interface AGUIToolCallArgsEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_ARGS;
  toolCallId: string;
  args: string; // Partial JSON string
}

/**
 * TOOL_CALL_END event
 */
export interface AGUIToolCallEndEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_END;
  toolCallId: string;
}

/**
 * TOOL_CALL_RESULT event
 */
export interface AGUIToolCallResultEvent extends AGUIBaseEvent {
  type: AGUIEventType.TOOL_CALL_RESULT;
  toolCallId: string;
  result: string;
  isError?: boolean;
}

/**
 * RAW event (for passthrough of unknown events)
 */
export interface AGUIRawEvent extends AGUIBaseEvent {
  type: AGUIEventType.RAW;
  source: string;
  event: unknown;
}

/**
 * CUSTOM event
 */
export interface AGUICustomEvent extends AGUIBaseEvent {
  type: AGUIEventType.CUSTOM;
  name: string;
  data: unknown;
}

/**
 * Union type for all AGUI events
 */
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
  | AGUIToolCallResultEvent
  | AGUIRawEvent
  | AGUICustomEvent;

// =============================================================================
// Session History Types
// =============================================================================

/**
 * Unified session summary (for session list views)
 */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  messageCount: number;
}

/**
 * Message content block
 */
export interface SessionMessageContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Unified session message
 */
export interface SessionMessage {
  type: 'user' | 'assistant' | 'summary' | string;
  uuid: string;
  timestamp: string;
  sessionId: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | SessionMessageContent[];
  };
  cwd?: string;
  // Claude-specific fields (preserved for compatibility)
  summary?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  toolUseResult?: unknown;
  isCompactSummary?: boolean;
  isCompactCommand?: boolean;
  isVisibleInTranscriptOnly?: boolean;
  sourceToolUseID?: string;
  // Message display parts (computed)
  messageParts?: unknown[];
}

/**
 * Unified session detail (with messages)
 */
export interface SessionDetail {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  messages: SessionMessage[];
}

// =============================================================================
// Engine Interface
// =============================================================================

/**
 * Unified Agent Engine Interface
 * 
 * All engine implementations must implement this interface.
 * The key contract is that all engines output standardized AGUI events,
 * regardless of their internal implementation.
 */
export interface IAgentEngine {
  /** Engine type identifier */
  readonly type: EngineType;
  
  /** Engine capabilities */
  readonly capabilities: EngineCapabilities;
  
  /**
   * Send a message and receive AGUI events via callback
   * 
   * @param message - User message to send
   * @param config - Engine configuration
   * @param onAguiEvent - Callback for each AGUI event
   * @returns Promise with session ID
   */
  sendMessage(
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }>;
  
  /**
   * Interrupt an active session
   * 
   * @param sessionId - Session ID to interrupt
   */
  interruptSession(sessionId: string): Promise<void>;
  
  /**
   * Get supported models for this engine
   */
  getSupportedModels(): Promise<ModelInfo[]>;
  
  /**
   * Get active session count
   */
  getActiveSessionCount(): number;
  
  /**
   * Read all sessions for a project (optional - for session history support)
   * 
   * @param projectPath - Absolute path to the project directory
   * @returns Array of session summaries with messages
   */
  readSessions?(projectPath: string): Promise<SessionDetail[]>;
  
  /**
   * Read a single session by ID (optional - for session history support)
   * 
   * @param projectPath - Absolute path to the project directory
   * @param sessionId - Session ID to read
   * @returns Session detail or null if not found
   */
  readSession?(projectPath: string, sessionId: string): Promise<SessionDetail | null>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format AGUI event as SSE message
 */
export function formatAguiEventAsSSE(event: AGUIEvent): string {
  const lines: string[] = [];
  lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify(event)}`);
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

/**
 * Create a timestamp for AGUI events
 */
export function createTimestamp(): number {
  return Date.now();
}
