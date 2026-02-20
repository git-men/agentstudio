import { randomUUID } from 'crypto';
import type {
  HookContext,
  HookDecisionType,
  HookEvent,
  HookEvaluationResult,
  HookEvaluationStep,
  HookExecutionResult,
  HookExecutionRecord,
  ImageData,
  InterceptorExecutionResult,
  PlatformHook,
  HookCreateRequest,
  HookUpdateRequest,
  HookFilter,
} from '../../types/platformHooks.js';
import type { ExecutorRegistry } from './executors/types.js';
import { isInterceptorExecutor } from './executors/types.js';
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

  // ─── Interceptor Evaluation ────────────────────────────────────────────────

  /**
   * Synchronously evaluate all matching blocking hooks for a "before" event.
   * Returns the aggregated decision. Async hooks matching the same event
   * are dispatched in the background (fire-and-forget).
   *
   * Call this from route handlers BEFORE the guarded action.
   * The existing handleEvent() path is NOT affected.
   */
  async evaluate(event: HookEvent): Promise<HookEvaluationResult> {
    const matched = this.findMatchingHooks(event);

    const blocking = matched.filter(h => h.async !== true);
    const asyncHooks = matched.filter(h => h.async === true);

    if (asyncHooks.length > 0) {
      void this.dispatchHooks(asyncHooks, event).catch(err => {
        console.error('[HookSystem] Async dispatch error during evaluate:', err);
      });
    }

    let currentMessage = event.data.message as string | undefined;
    const steps: HookEvaluationStep[] = [];
    let finalDecision: HookDecisionType = 'allow';
    let finalReason: string | undefined;
    let finalHookId: string | undefined;
    let finalHookName: string | undefined;
    let rewriteOccurred = false;

    for (const hook of blocking) {
      const context = this.buildHookContext(hook, event, currentMessage);
      const executor = this.executors.get(hook.action.type);

      if (!executor) {
        const step: HookEvaluationStep = {
          hookId: hook.id,
          hookName: hook.name,
          decision: 'allow',
          reason: `No executor found for action type "${hook.action.type}"`,
          duration: 0,
          timedOut: false,
          error: `No executor found for action type "${hook.action.type}"`,
          failurePolicyApplied: hook.failurePolicy,
        };
        steps.push(step);

        if (hook.failurePolicy === 'abort') {
          step.decision = 'block';
          finalDecision = 'block';
          finalReason = `Hook "${hook.name}" failed: no executor (failurePolicy: abort)`;
          finalHookId = hook.id;
          finalHookName = hook.name;
          this.recordInterceptorExecution(hook, event, step);
          break;
        }
        if (hook.failurePolicy === 'warn') {
          console.warn(`[HookSystem] Hook "${hook.name}": no executor for "${hook.action.type}" (ignored)`);
        }
        this.recordInterceptorExecution(hook, event, step);
        continue;
      }

      if (!isInterceptorExecutor(executor)) {
        const step: HookEvaluationStep = {
          hookId: hook.id,
          hookName: hook.name,
          decision: 'allow',
          reason: 'Executor does not support interceptor mode',
          duration: 0,
          timedOut: false,
          error: 'Executor does not support interceptor mode',
          failurePolicyApplied: hook.failurePolicy,
        };
        steps.push(step);

        if (hook.failurePolicy === 'abort') {
          step.decision = 'block';
          finalDecision = 'block';
          finalReason = `Hook "${hook.name}" failed: executor does not support interceptor mode (failurePolicy: abort)`;
          finalHookId = hook.id;
          finalHookName = hook.name;
          this.recordInterceptorExecution(hook, event, step);
          break;
        }
        if (hook.failurePolicy === 'warn') {
          console.warn(`[HookSystem] Hook "${hook.name}": executor does not support interceptor mode (ignored)`);
        }
        this.recordInterceptorExecution(hook, event, step);
        continue;
      }

      let result: InterceptorExecutionResult;
      try {
        result = await executor.executeInterceptor(hook, context, { timeout: hook.timeout });
      } catch (err) {
        const step: HookEvaluationStep = {
          hookId: hook.id,
          hookName: hook.name,
          decision: 'allow',
          reason: err instanceof Error ? err.message : String(err),
          duration: 0,
          timedOut: false,
          error: err instanceof Error ? err.message : String(err),
          failurePolicyApplied: hook.failurePolicy,
        };
        steps.push(step);

        if (hook.failurePolicy === 'abort') {
          step.decision = 'block';
          finalDecision = 'block';
          finalReason = `Hook "${hook.name}" threw an error (failurePolicy: abort)`;
          finalHookId = hook.id;
          finalHookName = hook.name;
          this.recordInterceptorExecution(hook, event, step);
          break;
        }
        if (hook.failurePolicy === 'warn') {
          console.warn(`[HookSystem] Hook "${hook.name}" error:`, err);
        }
        this.recordInterceptorExecution(hook, event, step);
        continue;
      }

      if (result.timedOut || !result.success) {
        const step: HookEvaluationStep = {
          hookId: hook.id,
          hookName: hook.name,
          decision: 'allow',
          reason: result.error ?? (result.timedOut ? 'Execution timed out' : 'Execution failed'),
          duration: result.duration,
          timedOut: result.timedOut,
          error: result.error,
          failurePolicyApplied: hook.failurePolicy,
        };

        if (hook.failurePolicy === 'abort') {
          step.decision = 'block';
          step.reason = result.timedOut
            ? `Hook "${hook.name}" timed out after ${hook.timeout}ms (failurePolicy: abort)`
            : `Hook "${hook.name}" failed (failurePolicy: abort)`;
          steps.push(step);
          finalDecision = 'block';
          finalReason = step.reason;
          finalHookId = hook.id;
          finalHookName = hook.name;
          this.recordInterceptorExecution(hook, event, step);
          break;
        }

        if (hook.failurePolicy === 'warn') {
          step.reason = result.timedOut
            ? `Execution timed out (ignored)`
            : `Execution failed (ignored)`;
          console.warn(`[HookSystem] Hook "${hook.name}":`, step.reason);
        }

        steps.push(step);
        this.recordInterceptorExecution(hook, event, step);
        continue;
      }

      if (result.decision) {
        const decision = result.decision;

        if (decision.decision === 'block') {
          const step: HookEvaluationStep = {
            hookId: hook.id,
            hookName: hook.name,
            decision: 'block',
            reason: decision.reason,
            duration: result.duration,
            timedOut: false,
          };
          steps.push(step);
          finalDecision = 'block';
          finalReason = decision.reason;
          finalHookId = hook.id;
          finalHookName = hook.name;
          this.recordInterceptorExecution(hook, event, step);
          break;
        }

        if (decision.decision === 'rewrite') {
          if (event.type === 'message.pre_send' && decision.rewrittenMessage) {
            currentMessage = decision.rewrittenMessage;
            rewriteOccurred = true;
            const step: HookEvaluationStep = {
              hookId: hook.id,
              hookName: hook.name,
              decision: 'rewrite',
              reason: decision.reason,
              duration: result.duration,
              timedOut: false,
            };
            steps.push(step);
            this.recordInterceptorExecution(hook, event, step);
          } else {
            const step: HookEvaluationStep = {
              hookId: hook.id,
              hookName: hook.name,
              decision: 'allow',
              reason: decision.reason ?? 'Rewrite downgraded to allow (non-message event or missing rewrittenMessage)',
              duration: result.duration,
              timedOut: false,
            };
            steps.push(step);
            this.recordInterceptorExecution(hook, event, step);
          }
          continue;
        }

        // decision === 'allow'
        const step: HookEvaluationStep = {
          hookId: hook.id,
          hookName: hook.name,
          decision: 'allow',
          reason: decision.reason,
          duration: result.duration,
          timedOut: false,
        };
        steps.push(step);
        this.recordInterceptorExecution(hook, event, step);
        continue;
      }

      // No decision returned — treat as hook failure
      const step: HookEvaluationStep = {
        hookId: hook.id,
        hookName: hook.name,
        decision: 'allow',
        reason: 'No decision returned by interceptor',
        duration: result.duration,
        timedOut: false,
        error: 'No decision returned by interceptor',
        failurePolicyApplied: hook.failurePolicy,
      };
      steps.push(step);

      if (hook.failurePolicy === 'abort') {
        step.decision = 'block';
        finalDecision = 'block';
        finalReason = `Hook "${hook.name}" returned no decision (failurePolicy: abort)`;
        finalHookId = hook.id;
        finalHookName = hook.name;
        this.recordInterceptorExecution(hook, event, step);
        break;
      }
      if (hook.failurePolicy === 'warn') {
        console.warn(`[HookSystem] Hook "${hook.name}": no decision returned (ignored)`);
      }
      this.recordInterceptorExecution(hook, event, step);
    }

    const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);

    return {
      decision: finalDecision,
      reason: finalReason,
      rewrittenMessage: rewriteOccurred ? currentMessage : undefined,
      hookId: finalHookId,
      hookName: finalHookName,
      evaluatedCount: steps.length,
      skippedCount: asyncHooks.length,
      totalDuration,
      steps,
    };
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

  private buildHookContext(hook: PlatformHook, event: HookEvent, currentMessage?: string): HookContext {
    const images = Array.isArray(event.data.images)
      ? (event.data.images as ImageData[])
      : undefined;

    const { message: _message, images: _images, ...restData } = event.data;

    return {
      event: {
        type: event.type,
        timestamp: event.timestamp,
        source: event.source,
      },
      session: {
        sessionId: event.sessionId,
        projectId: event.projectId,
        agentId: event.agentId,
      },
      data: {
        message: currentMessage,
        images,
        ...restData,
      },
      hookId: hook.id,
      hookName: hook.name,
      timeout: hook.timeout,
    };
  }

  private recordInterceptorExecution(
    hook: PlatformHook,
    event: HookEvent,
    step: HookEvaluationStep,
  ): void {
    const record: HookExecutionRecord = {
      id: `exec_${randomUUID()}`,
      hookId: hook.id,
      hookName: hook.name,
      eventType: event.type,
      timestamp: new Date().toISOString(),
      result: {
        success: step.decision !== 'block' && !step.error,
        duration: step.duration,
        timedOut: step.timedOut,
        error: step.error,
      },
      interceptor: {
        decision: step.decision,
        reason: step.reason,
        rewriteApplied: step.decision === 'rewrite',
        failurePolicyApplied: step.failurePolicyApplied,
      },
    };

    this.executionHistory.unshift(record);
    if (this.executionHistory.length > MAX_HISTORY) {
      this.executionHistory.length = MAX_HISTORY;
    }
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
