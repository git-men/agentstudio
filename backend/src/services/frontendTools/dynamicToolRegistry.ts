/**
 * Dynamic Frontend Tool Registry
 *
 * Stores tool definitions registered by the frontend at runtime.
 * Tools are keyed by agentId and persist for the lifetime of the backend process.
 */

import type { FrontendToolDefinition } from './types.js';

/**
 * In-memory store: agentId → list of registered tool definitions.
 * Using a Map means registrations survive across multiple chat sessions
 * for the same agent, which is the desired behavior (tools are registered
 * when the page loads, before any session begins).
 */
const registry = new Map<string, Map<string, FrontendToolDefinition>>();

/**
 * Register (or update) a set of frontend tool definitions for an agent.
 * The frontend calls this before starting a session.
 */
export function registerDynamicTools(agentId: string, tools: FrontendToolDefinition[]): void {
  if (!registry.has(agentId)) {
    registry.set(agentId, new Map());
  }
  const agentTools = registry.get(agentId)!;
  for (const tool of tools) {
    agentTools.set(tool.name, tool);
    console.log(`[DynamicToolRegistry] Registered tool '${tool.name}' for agent ${agentId}`);
  }
}

/**
 * Return all dynamically registered tools for an agent.
 */
export function getDynamicTools(agentId: string): FrontendToolDefinition[] {
  const agentTools = registry.get(agentId);
  if (!agentTools) return [];
  return Array.from(agentTools.values());
}

/**
 * Clear all dynamic tools for an agent (e.g. on agent deletion).
 */
export function clearDynamicTools(agentId: string): void {
  registry.delete(agentId);
}
