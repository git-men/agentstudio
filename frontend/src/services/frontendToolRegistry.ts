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

export interface FrontendToolRenderProps {
  /** Tool call arguments from the agent. */
  args: Record<string, unknown>;
  /** Call this to submit the tool result back to the agent. */
  onSubmit: (result: unknown) => void;
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
