/**
 * Platform Hook System Types
 *
 * Engine-agnostic, protocol-agnostic hook types for the AgentStudio platform.
 * These are separate from the Claude-specific hook types in ./hooks.ts.
 */

// ─── Events ──────────────────────────────────────────────────────────────────

export interface HookEvent {
  type: string;
  timestamp: string;
  source: string;
  data: Record<string, unknown>;
  sessionId?: string;
  projectId?: string;
  agentId?: string;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface HookFilter {
  toolName?: string | string[];
  pathPattern?: string;
  agentId?: string | string[];
  projectId?: string | string[];
}

// ─── Actions (discriminated union) ───────────────────────────────────────────

export interface ShellAction {
  type: 'shell';
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ScriptAction {
  type: 'script';
  path: string;
  runtime: 'node';
  args?: string[];
}

export interface WebhookAction {
  type: 'webhook';
  url: string;
  method?: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  bodyTemplate?: string;
}

export type HookAction = ShellAction | ScriptAction | WebhookAction;

// ─── Hook Configuration ─────────────────────────────────────────────────────

export interface PlatformHook {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  event: string;
  filter?: HookFilter;
  action: HookAction;
  scope: 'global' | 'project' | 'agent';
  projectId?: string;
  agentId?: string;
  timeout: number;
  failurePolicy: 'ignore' | 'warn' | 'abort';
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Execution ──────────────────────────────────────────────────────────────

export interface HookExecutionResult {
  success: boolean;
  duration: number;
  output?: string;
  error?: string;
  exitCode?: number;
  httpStatus?: number;
  timedOut: boolean;
}

export interface HookExecutionRecord {
  id: string;
  hookId: string;
  hookName: string;
  eventType: string;
  timestamp: string;
  result: HookExecutionResult;
}

// ─── Storage ────────────────────────────────────────────────────────────────

export interface HookStorageFile {
  version: string;
  hooks: PlatformHook[];
}

// ─── API Request Types ──────────────────────────────────────────────────────

export type HookCreateRequest = Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>;
export type HookUpdateRequest = Partial<Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>>;

// ─── Event Registry ─────────────────────────────────────────────────────────

export interface EventTypeInfo {
  type: string;
  description: string;
  category: string;
  phase: number;
  dataSchema: Record<string, string>;
}
