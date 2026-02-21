import { authFetch } from './authFetch';
import { API_BASE } from './config';

// ─── Types (mirrors backend/src/types/platformHooks.ts) ─────────────────────

export interface HookEvent {
  type: string;
  timestamp: string;
  source: string;
  data: Record<string, unknown>;
  sessionId?: string;
  projectId?: string;
  agentId?: string;
}

export interface HookFilter {
  toolName?: string | string[];
  pathPattern?: string;
  agentId?: string | string[];
  projectId?: string | string[];
}

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

export interface HookSource {
  type: 'marketplace' | 'manual';
  marketplace?: string;
  plugin?: string;
  installPath?: string;
}

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

export type HookDecisionType = 'allow' | 'block' | 'rewrite';

export interface HookDecision {
  decision: HookDecisionType;
  reason?: string;
  rewrittenMessage?: string;
  metadata?: Record<string, unknown>;
}

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

export interface EventTypeInfo {
  type: string;
  description: string;
  category: string;
  phase: number;
  dataSchema: Record<string, string>;
  blocking?: boolean;
}

export type HookCreateRequest = Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>;
export type HookUpdateRequest = Partial<Omit<PlatformHook, 'id' | 'createdAt' | 'updatedAt'>>;

const BASE = `${API_BASE}/platform-hooks`;

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message || body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

export interface HookListFilter {
  scope?: 'global' | 'project' | 'agent';
  event?: string;
  projectId?: string;
  enabled?: boolean;
}

export interface ExecutionHistoryFilter {
  hookId?: string;
  eventType?: string;
  success?: boolean;
}

export interface ListHooksResponse {
  hooks: PlatformHook[];
}

export interface SingleHookResponse {
  hook: PlatformHook;
}

export interface ListEventsResponse {
  events: EventTypeInfo[];
}

export interface ListExecutionsResponse {
  executions: HookExecutionRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface TestHookResponse {
  hookId: string;
  hookName: string;
  event: HookEvent;
  result: HookExecutionResult;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

export async function fetchEventTypes(): Promise<EventTypeInfo[]> {
  const data = await handleResponse<ListEventsResponse>(
    await authFetch(`${BASE}/events`)
  );
  return data.events;
}

export async function fetchHooks(filters?: HookListFilter): Promise<PlatformHook[]> {
  const qs = filters ? buildQueryString({
    scope: filters.scope,
    event: filters.event,
    projectId: filters.projectId,
    enabled: filters.enabled !== undefined ? String(filters.enabled) : undefined,
  }) : '';
  const data = await handleResponse<ListHooksResponse>(
    await authFetch(`${BASE}${qs}`)
  );
  return data.hooks;
}

export async function fetchHook(id: string): Promise<PlatformHook> {
  const data = await handleResponse<SingleHookResponse>(
    await authFetch(`${BASE}/${encodeURIComponent(id)}`)
  );
  return data.hook;
}

export async function createHook(request: HookCreateRequest): Promise<PlatformHook> {
  const data = await handleResponse<SingleHookResponse>(
    await authFetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  );
  return data.hook;
}

export async function updateHook(id: string, request: HookUpdateRequest): Promise<PlatformHook> {
  const data = await handleResponse<SingleHookResponse>(
    await authFetch(`${BASE}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  );
  return data.hook;
}

export async function deleteHook(id: string): Promise<void> {
  await handleResponse<{ success: boolean }>(
    await authFetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  );
}

export async function testHook(id: string): Promise<TestHookResponse> {
  return handleResponse<TestHookResponse>(
    await authFetch(`${BASE}/${encodeURIComponent(id)}/test`, { method: 'POST' })
  );
}

export async function fetchExecutions(
  filters?: ExecutionHistoryFilter,
  pagination?: { limit: number; offset: number }
): Promise<ListExecutionsResponse> {
  const qs = buildQueryString({
    hookId: filters?.hookId,
    eventType: filters?.eventType,
    success: filters?.success !== undefined ? String(filters.success) : undefined,
    limit: pagination?.limit,
    offset: pagination?.offset,
  });
  return handleResponse<ListExecutionsResponse>(
    await authFetch(`${BASE}/executions${qs}`)
  );
}
