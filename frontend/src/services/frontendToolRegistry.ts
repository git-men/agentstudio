/**
 * Frontend Tool Registry (client-side)
 *
 * Stores tool definitions and render functions registered by the application
 * via `useFrontendTool`. This is a module-level singleton so it's accessible
 * from both hooks and components without React context overhead.
 */

import type React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FrontendToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'integer';
  description?: string;
  enum?: string[];
  items?: FrontendToolParameter;
  properties?: Record<string, FrontendToolParameter>;
  required?: string[];
}

export interface FrontendToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, FrontendToolParameter>;
    required?: string[];
  };
  /** Override the MCP server name (optional, same semantics as backend). */
  mcpServerName?: string;
  /** Result format hint. */
  resultFormat?: 'json' | 'text';
}

export interface FrontendToolSubmitResult {
  success: boolean;
  error?: string;
}

export type FrontendToolStatus = 'pending' | 'submitted' | 'error';

export interface FrontendToolRenderProps {
  /** Tool call arguments from the agent. */
  args: Record<string, unknown>;
  /** Unique identifier for this tool invocation (matches the Claude tool_use id). */
  toolCallId: string;
  /** Current submission status of this tool call. */
  status: FrontendToolStatus;
  /** Submit the tool result back to the agent. Returns submission outcome. */
  onSubmit: (result: unknown) => Promise<FrontendToolSubmitResult>;
  /** Cancel this tool call. The agent will receive an error. */
  onCancel: (reason?: string) => void;
}

export type FrontendToolRenderFn = (props: FrontendToolRenderProps) => React.ReactNode;

export interface FrontendToolRegistration {
  schema: FrontendToolSchema;
  render: FrontendToolRenderFn;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, FrontendToolRegistration>();

/**
 * Register a custom frontend tool.
 * Typically called inside a `useFrontendTool` hook on page load.
 */
export function registerTool(registration: FrontendToolRegistration): void {
  registry.set(registration.schema.name, registration);
}

/**
 * Unregister a tool (called on component unmount).
 */
export function unregisterTool(name: string): void {
  registry.delete(name);
}

/**
 * Look up the render function for a tool by name.
 * Returns null if the tool has no registered render.
 */
export function getToolRender(name: string): FrontendToolRenderFn | null {
  return registry.get(name)?.render ?? null;
}

/**
 * Built-in frontend tools that use the bridge/notification mechanism but are
 * not registered in the dynamic registry (they have dedicated components).
 */
const BUILTIN_FRONTEND_TOOLS = new Set(['ask_user_question']);

/**
 * Parse an MCP tool name (e.g. `mcp__server__tool`) and return the short
 * tool name portion, or return the input unchanged if it's already short.
 */
export function extractFrontendToolShortName(name: string): string {
  const parts = name.split('__');
  if (parts.length === 3 && parts[0] === 'mcp') {
    return parts[2];
  }
  return name;
}

/**
 * Check whether a tool name refers to a frontend tool (either registered in
 * the dynamic registry or a known built-in frontend tool).
 * Accepts both short names (`ask_user_question`) and full MCP names
 * (`mcp__ask-user-question__ask_user_question`).
 */
export function isFrontendToolName(name: string): boolean {
  const shortName = extractFrontendToolShortName(name);
  return !!getToolRender(shortName) || BUILTIN_FRONTEND_TOOLS.has(shortName);
}

/**
 * Return all registered tool schemas (for syncing to the backend).
 */
export function getAllSchemas(): FrontendToolSchema[] {
  return Array.from(registry.values()).map(r => r.schema);
}

/**
 * Return a snapshot of the entire registry (for debugging/inspection).
 */
export function getRegistry(): Map<string, FrontendToolRegistration> {
  return registry;
}
