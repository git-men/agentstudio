/**
 * Frontend Tool Framework - Type Definitions
 *
 * Defines the contract for tools that execute in the frontend (browser)
 * but are invoked by the backend agent through the MCP protocol.
 */

/**
 * JSON Schema compatible parameter definition for a frontend tool.
 */
export interface FrontendToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/**
 * Frontend tool definition — describes a tool that runs in the browser.
 *
 * The frontend registers these definitions; the backend creates corresponding
 * MCP tool wrappers that block until the frontend executes the tool and
 * submits the result.
 */
export interface FrontendToolDefinition {
  name: string;
  description: string;
  parameters: FrontendToolParameters;
  /**
   * Override the MCP server name exposed to the agent.
   * Defaults to `frontend-tool-${name}` for dynamically registered tools.
   *
   * Built-in tools like AskUserQuestion set this explicitly (e.g.
   * 'ask-user-question') to maintain a stable MCP identity compatible
   * with Claude Code's native tool of the same name.
   */
  mcpServerName?: string;
  /**
   * Hint for how the result is formatted. 'json' means the result is a
   * JSON-serializable value; 'text' means it is a plain string.
   * The framework does not enforce this — it merely passes the value through.
   */
  resultFormat?: 'json' | 'text';
}

/**
 * Represents a pending frontend tool invocation waiting for the frontend
 * to execute and return a result.
 */
export interface FrontendToolRequest {
  toolCallId: string;
  toolName: string;
  sessionId: string;
  agentId: string;
  args: Record<string, unknown>;
  createdAt: number;
}

/**
 * Result submitted by the frontend after executing a tool.
 */
export interface FrontendToolResult {
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

/**
 * Notification channel types (carried over from the existing design).
 */
export type ChannelType = 'sse' | 'slack' | 'wechat' | 'email';

/**
 * Notification channel interface for delivering frontend tool invocations
 * to the user across different mediums.
 */
export interface NotificationChannel {
  type: ChannelType;
  channelId: string;
  sessionId: string;
  agentId: string;
  createdAt: number;
  isActive(): boolean;
  sendToolInvocation(request: FrontendToolRequest): Promise<boolean>;
  close(): void;
}
