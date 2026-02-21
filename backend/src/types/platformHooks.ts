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

// ─── Hook Source (provenance tracking) ───────────────────────────────────────

export interface HookSource {
  type: 'marketplace' | 'manual';
  marketplace?: string;
  plugin?: string;
  installPath?: string;
}

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
  async?: boolean;
  source?: HookSource;
}

// ─── Marketplace Hook Package ───────────────────────────────────────────────

export interface HookPackageBinding {
  agents: string[];
}

export interface HookPackageEntry {
  name: string;
  description?: string;
  event: string;
  action: HookAction;
  scope?: 'global' | 'project' | 'agent';
  binding?: HookPackageBinding;
  filter?: HookFilter;
  timeout?: number;
  failurePolicy?: 'ignore' | 'warn' | 'abort';
  priority?: number;
  enabled?: boolean;
  async?: boolean;
}

export interface HookPackageFile {
  version: string;
  hooks: HookPackageEntry[];
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
  interceptor?: {
    decision: HookDecisionType;
    reason?: string;
    rewriteApplied: boolean;
    failurePolicyApplied?: 'abort' | 'ignore' | 'warn';
  };
}

// ─── Storage ────────────────────────────────────────────────────────────────

export interface HookStorageFile {
  version: string;
  hooks: PlatformHook[];
}

// ─── API Request Types ──────────────────────────────────────────────────────

export type HookCreateRequest = Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>;
export type HookUpdateRequest = Partial<Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>>;

// ─── Interceptor Types ───────────────────────────────────────────────────────

export type HookDecisionType = 'allow' | 'block' | 'rewrite';

export interface HookDecision {
  decision: HookDecisionType;
  reason?: string;
  rewrittenMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface ImageData {
  id: string;
  base64: string;
  mediaType: string;
  filePath?: string;
}

export interface HookContext {
  event: {
    type: string;
    timestamp: string;
    source: string;
  };
  session?: {
    sessionId?: string;
    projectId?: string;
    agentId?: string;
  };
  data: {
    message?: string;
    images?: ImageData[];
    toolName?: string;
    toolInput?: Record<string, unknown>;
    [key: string]: unknown;
  };
  hookId: string;
  hookName: string;
  timeout: number;
}

export interface HookEvaluationStep {
  hookId: string;
  hookName: string;
  decision: HookDecisionType;
  reason?: string;
  duration: number;
  timedOut: boolean;
  error?: string;
  failurePolicyApplied?: 'abort' | 'ignore' | 'warn';
}

export interface HookEvaluationResult {
  decision: HookDecisionType;
  reason?: string;
  rewrittenMessage?: string;
  hookId?: string;
  hookName?: string;
  evaluatedCount: number;
  skippedCount: number;
  totalDuration: number;
  steps: HookEvaluationStep[];
}

export interface InterceptorExecutionResult {
  success: boolean;
  duration: number;
  timedOut: boolean;
  error?: string;
  decision?: HookDecision;
  rawOutput?: string;
}

// ─── Event Registry ─────────────────────────────────────────────────────────

export interface EventTypeInfo {
  type: string;
  description: string;
  category: string;
  phase: number;
  dataSchema: Record<string, string>;
  blocking?: boolean;
}
