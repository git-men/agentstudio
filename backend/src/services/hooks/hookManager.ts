import { randomUUID } from 'crypto';
import type {
  HookEvent,
  HookExecutionResult,
  HookExecutionRecord,
  PlatformHook,
  HookCreateRequest,
  HookUpdateRequest,
  HookFilter,
} from '../../types/platformHooks.js';
import type { ExecutorRegistry } from './executors/types.js';
import type { HookStorage } from './hookStorage.js';
import { isValidEventType, getSyntheticEvent } from './eventRegistry.js';

const MAX_HISTORY = 1000;

export class HookManager {
  private hooks: PlatformHook[] = [];
  private executionHistory: HookExecutionRecord[] = [];

  constructor(
    private storage: HookStorage,
    private executors: ExecutorRegistry,
  ) {}

  async initialize(): Promise<void> {
    await this.reloadHooks();
    console.log(`[HookSystem] Initialized with ${this.hooks.length} hooks`);
  }

  async reloadHooks(): Promise<void> {
    this.hooks = await this.storage.loadAllHooks();
  }

  /**
   * Non-blocking: dispatches matching hooks in background.
   * Returns immediately — callers must not await this for request flow.
   */
  handleEvent(event: HookEvent): void {
    const matched = this.findMatchingHooks(event);
    if (matched.length === 0) return;

    void this.dispatchHooks(matched, event).catch(err => {
      console.error('[HookSystem] Dispatch error:', err);
    });
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async createHook(req: HookCreateRequest): Promise<PlatformHook> {
    const now = new Date().toISOString();
    const hook: PlatformHook = {
      ...req,
      id: `hook_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveHook(hook);
    await this.reloadHooks();
    return hook;
  }

  async getHook(id: string): Promise<PlatformHook | null> {
    return this.hooks.find(h => h.id === id) ?? null;
  }

  async updateHook(id: string, updates: HookUpdateRequest): Promise<PlatformHook | null> {
    const existing = await this.storage.findHookById(id);
    if (!existing) return null;

    const updated: PlatformHook = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await this.storage.saveHook(updated);
    await this.reloadHooks();
    return updated;
  }

  async deleteHook(id: string): Promise<boolean> {
    const deleted = await this.storage.deleteHook(id);
    if (deleted) {
      await this.reloadHooks();
    }
    return deleted;
  }

  async listHooks(filter?: { scope?: string; event?: string; projectId?: string; enabled?: boolean }): Promise<PlatformHook[]> {
    let result = [...this.hooks];

    if (filter?.scope) result = result.filter(h => h.scope === filter.scope);
    if (filter?.event) result = result.filter(h => h.event === filter.event);
    if (filter?.projectId) result = result.filter(h => h.projectId === filter.projectId);
    if (filter?.enabled !== undefined) result = result.filter(h => h.enabled === filter.enabled);

    return result;
  }

  // ─── Test Execution ────────────────────────────────────────────────────────

  async testHook(hookId: string, eventOverrides?: Partial<HookEvent>): Promise<{ hook: PlatformHook; event: HookEvent; result: HookExecutionResult } | null> {
    const hook = await this.getHook(hookId);
    if (!hook) return null;

    const synthetic = getSyntheticEvent(hook.event);
    if (!synthetic) return null;

    const event: HookEvent = { ...synthetic, ...eventOverrides };
    const result = await this.executeHook(hook, event);

    return { hook, event, result };
  }

  // ─── Execution History ─────────────────────────────────────────────────────

  getExecutions(
    filters?: { hookId?: string; eventType?: string; success?: boolean },
    limit = 50,
    offset = 0,
  ): { executions: HookExecutionRecord[]; total: number } {
    let records = [...this.executionHistory];

    if (filters?.hookId) records = records.filter(r => r.hookId === filters.hookId);
    if (filters?.eventType) records = records.filter(r => r.eventType === filters.eventType);
    if (filters?.success !== undefined) records = records.filter(r => r.result.success === filters.success);

    const total = records.length;
    const executions = records.slice(offset, offset + limit);
    return { executions, total };
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private findMatchingHooks(event: HookEvent): PlatformHook[] {
    return this.hooks
      .filter(hook => this.matchHook(hook, event))
      .sort((a, b) => a.priority - b.priority);
  }

  private matchHook(hook: PlatformHook, event: HookEvent): boolean {
    if (!hook.enabled) return false;
    if (hook.event !== event.type) return false;

    // Scope-based matching
    if (hook.scope === 'project' && hook.projectId && event.projectId) {
      if (hook.projectId !== event.projectId) return false;
    }
    if (hook.scope === 'agent' && hook.agentId && event.agentId) {
      if (hook.agentId !== event.agentId) return false;
    }

    if (hook.filter && !this.matchesFilter(hook.filter, event)) return false;

    return true;
  }

  private matchesFilter(filter: HookFilter, event: HookEvent): boolean {
    if (filter.toolName !== undefined) {
      const toolName = event.data.toolName as string | undefined;
      if (!toolName) return false;
      const allowed = Array.isArray(filter.toolName) ? filter.toolName : [filter.toolName];
      if (!allowed.includes(toolName)) return false;
    }

    if (filter.agentId !== undefined) {
      if (!event.agentId) return false;
      const allowed = Array.isArray(filter.agentId) ? filter.agentId : [filter.agentId];
      if (!allowed.includes(event.agentId)) return false;
    }

    if (filter.projectId !== undefined) {
      if (!event.projectId) return false;
      const allowed = Array.isArray(filter.projectId) ? filter.projectId : [filter.projectId];
      if (!allowed.includes(event.projectId)) return false;
    }

    if (filter.pathPattern !== undefined) {
      const filePath = event.data.filePath as string | undefined;
      if (!filePath) return false;
      if (!this.matchGlob(filter.pathPattern, filePath)) return false;
    }

    return true;
  }

  private matchGlob(pattern: string, value: string): boolean {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    return new RegExp(`^${regex}$`).test(value);
  }

  private async dispatchHooks(hooks: PlatformHook[], event: HookEvent): Promise<void> {
    for (const hook of hooks) {
      try {
        const result = await this.executeHook(hook, event);
        this.recordExecution(hook, event, result);

        if (!result.success) {
          if (hook.failurePolicy === 'warn') {
            console.warn(`[HookSystem] Hook "${hook.name}" failed:`, result.error);
          } else if (hook.failurePolicy === 'abort') {
            console.error(`[HookSystem] Hook "${hook.name}" failed (abort):`, result.error);
            break;
          }
        }
      } catch (err) {
        console.error(`[HookSystem] Hook "${hook.name}" execution error:`, err);
        if (hook.failurePolicy === 'abort') break;
      }
    }
  }

  private async executeHook(hook: PlatformHook, event: HookEvent): Promise<HookExecutionResult> {
    const executor = this.executors.get(hook.action.type);
    if (!executor) {
      return {
        success: false,
        duration: 0,
        timedOut: false,
        error: `No executor found for action type "${hook.action.type}"`,
      };
    }

    return executor.execute(hook, event, { timeout: hook.timeout });
  }

  private recordExecution(hook: PlatformHook, event: HookEvent, result: HookExecutionResult): void {
    const record: HookExecutionRecord = {
      id: `exec_${randomUUID()}`,
      hookId: hook.id,
      hookName: hook.name,
      eventType: event.type,
      timestamp: new Date().toISOString(),
      result,
    };

    this.executionHistory.unshift(record);
    if (this.executionHistory.length > MAX_HISTORY) {
      this.executionHistory.length = MAX_HISTORY;
    }
  }
}
