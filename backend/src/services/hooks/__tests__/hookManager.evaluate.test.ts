import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookManager } from '../hookManager.js';
import { HookStorage } from '../hookStorage.js';
import type {
  HookContext,
  HookEvent,
  HookExecutionResult,
  InterceptorExecutionResult,
  PlatformHook,
} from '../../../types/platformHooks.js';
import type { ExecutorRegistry, HookExecutor, InterceptorExecutor, ExecutionOptions } from '../executors/types.js';

// ─── Factories ──────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'message.pre_send',
    timestamp: new Date().toISOString(),
    source: 'TestRunner',
    data: { message: 'hello world' },
    sessionId: 'sess-1',
    projectId: 'proj-1',
    ...overrides,
  };
}

function makeHook(overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_eval-001',
    name: 'Eval Hook',
    enabled: true,
    event: 'message.pre_send',
    action: { type: 'script', path: '/tmp/hook.js', runtime: 'node' as const },
    scope: 'global',
    timeout: 5000,
    failurePolicy: 'ignore',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Mock Storage ───────────────────────────────────────────────────────────

class MockStorage {
  hooks: PlatformHook[] = [];
  async loadAllHooks(): Promise<PlatformHook[]> { return [...this.hooks]; }
  async loadGlobalHooks(): Promise<PlatformHook[]> { return this.hooks.filter(h => h.scope === 'global'); }
  async loadProjectHooks(): Promise<PlatformHook[]> { return []; }
  async saveHook(hook: PlatformHook): Promise<void> {
    const idx = this.hooks.findIndex(h => h.id === hook.id);
    if (idx >= 0) this.hooks[idx] = hook; else this.hooks.push(hook);
  }
  async deleteHook(hookId: string): Promise<boolean> {
    const len = this.hooks.length;
    this.hooks = this.hooks.filter(h => h.id !== hookId);
    return this.hooks.length < len;
  }
  async findHookById(hookId: string): Promise<PlatformHook | null> {
    return this.hooks.find(h => h.id === hookId) ?? null;
  }
}

// ─── Mock Interceptor Executor ──────────────────────────────────────────────

class MockInterceptorExecutor implements InterceptorExecutor {
  readonly type = 'script';
  interceptorResults: InterceptorExecutionResult[] = [];
  private callIndex = 0;
  interceptorCalls: Array<{ hook: PlatformHook; context: HookContext }> = [];

  async execute(
    _hook: PlatformHook,
    _event: HookEvent,
    _options: ExecutionOptions,
  ): Promise<HookExecutionResult> {
    return { success: true, duration: 1, timedOut: false };
  }

  async executeInterceptor(
    hook: PlatformHook,
    context: HookContext,
    _options: ExecutionOptions,
  ): Promise<InterceptorExecutionResult> {
    this.interceptorCalls.push({ hook, context });
    const result = this.interceptorResults[this.callIndex] ?? {
      success: true,
      duration: 1,
      timedOut: false,
      decision: { decision: 'allow' as const },
    };
    this.callIndex++;
    return result;
  }
}

// ─── Setup helpers ──────────────────────────────────────────────────────────

let mockStorage: MockStorage;
let mockExecutor: MockInterceptorExecutor;
let manager: HookManager;

function createManager(): HookManager {
  mockStorage = new MockStorage();
  mockExecutor = new MockInterceptorExecutor();
  const executors: ExecutorRegistry = new Map();
  executors.set('script', mockExecutor);
  return new HookManager(mockStorage as unknown as HookStorage, executors);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('HookManager.evaluate', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    manager = createManager();
    await manager.initialize();
  });

  it('should return "allow" with evaluatedCount 0 when no hooks match', async () => {
    mockStorage.hooks = [];
    await manager.reloadHooks();

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.evaluatedCount).toBe(0);
    expect(result.steps).toHaveLength(0);
  });

  it('should return "allow" when a single blocking hook allows', async () => {
    mockStorage.hooks = [makeHook()];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      { success: true, duration: 5, timedOut: false, decision: { decision: 'allow' } },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.evaluatedCount).toBe(1);
    expect(result.steps[0].decision).toBe('allow');
  });

  it('should return "block" with reason when a blocking hook blocks', async () => {
    mockStorage.hooks = [makeHook()];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      {
        success: true,
        duration: 5,
        timedOut: false,
        decision: { decision: 'block', reason: 'Profanity detected' },
      },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('block');
    expect(result.reason).toBe('Profanity detected');
    expect(result.hookId).toBe('hook_eval-001');
    expect(result.hookName).toBe('Eval Hook');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].decision).toBe('block');
  });

  it('should chain rewrites across multiple hooks', async () => {
    mockStorage.hooks = [
      makeHook({ id: 'hook_r1', name: 'Rewrite 1', priority: 1 }),
      makeHook({ id: 'hook_r2', name: 'Rewrite 2', priority: 2 }),
    ];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      {
        success: true,
        duration: 3,
        timedOut: false,
        decision: { decision: 'rewrite', rewrittenMessage: 'rewritten-once' },
      },
      {
        success: true,
        duration: 3,
        timedOut: false,
        decision: { decision: 'rewrite', rewrittenMessage: 'rewritten-twice' },
      },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.rewrittenMessage).toBe('rewritten-twice');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].decision).toBe('rewrite');
    expect(result.steps[1].decision).toBe('rewrite');

    // Second hook should receive the rewritten message from the first
    const secondContext = mockExecutor.interceptorCalls[1].context;
    expect(secondContext.data.message).toBe('rewritten-once');
  });

  it('should stop evaluation when a hook blocks', async () => {
    mockStorage.hooks = [
      makeHook({ id: 'hook_b', name: 'Blocker', priority: 1 }),
      makeHook({ id: 'hook_a', name: 'After Blocker', priority: 2 }),
    ];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      {
        success: true,
        duration: 2,
        timedOut: false,
        decision: { decision: 'block', reason: 'Blocked' },
      },
      {
        success: true,
        duration: 2,
        timedOut: false,
        decision: { decision: 'allow' },
      },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('block');
    expect(result.evaluatedCount).toBe(1);
    expect(mockExecutor.interceptorCalls).toHaveLength(1);
  });

  it('should dispatch async hooks in background without blocking', async () => {
    const asyncHook = makeHook({
      id: 'hook_async',
      name: 'Async Hook',
      async: true,
      priority: 1,
      action: { type: 'script', path: '/tmp/async.js', runtime: 'node' as const },
    });
    const syncHook = makeHook({
      id: 'hook_sync',
      name: 'Sync Hook',
      priority: 2,
    });

    mockStorage.hooks = [asyncHook, syncHook];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      { success: true, duration: 3, timedOut: false, decision: { decision: 'allow' } },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.evaluatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    // Only the sync hook should have been evaluated via executeInterceptor
    expect(mockExecutor.interceptorCalls).toHaveLength(1);
    expect(mockExecutor.interceptorCalls[0].hook.id).toBe('hook_sync');
  });

  describe('failurePolicy: abort', () => {
    it('should return "block" when hook times out with failurePolicy abort', async () => {
      mockStorage.hooks = [makeHook({ failurePolicy: 'abort', name: 'Abort Hook' })];
      await manager.reloadHooks();

      mockExecutor.interceptorResults = [
        { success: false, duration: 5000, timedOut: true, error: 'Execution timed out' },
      ];

      const result = await manager.evaluate(makeEvent());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('timed out');
      expect(result.reason).toContain('abort');
      expect(result.steps[0].timedOut).toBe(true);
    });

    it('should return "block" when hook execution fails with failurePolicy abort', async () => {
      mockStorage.hooks = [makeHook({ failurePolicy: 'abort', name: 'Fail Abort Hook' })];
      await manager.reloadHooks();

      mockExecutor.interceptorResults = [
        { success: false, duration: 10, timedOut: false, error: 'Script crashed' },
      ];

      const result = await manager.evaluate(makeEvent());

      expect(result.decision).toBe('block');
      expect(result.reason).toContain('failed');
      expect(result.reason).toContain('abort');
    });
  });

  describe('failurePolicy: ignore', () => {
    it('should return "allow" and continue when hook times out with failurePolicy ignore', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_t', failurePolicy: 'ignore', priority: 1, name: 'Timeout Ignored' }),
        makeHook({ id: 'hook_ok', failurePolicy: 'ignore', priority: 2, name: 'After Timeout' }),
      ];
      await manager.reloadHooks();

      mockExecutor.interceptorResults = [
        { success: false, duration: 5000, timedOut: true, error: 'Execution timed out' },
        { success: true, duration: 3, timedOut: false, decision: { decision: 'allow' } },
      ];

      const result = await manager.evaluate(makeEvent());

      expect(result.decision).toBe('allow');
      expect(result.evaluatedCount).toBe(2);
    });
  });

  describe('failurePolicy: warn', () => {
    it('should return "allow", continue, and log warning when hook times out with failurePolicy warn', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_tw', failurePolicy: 'warn', priority: 1, name: 'Timeout Warn' }),
        makeHook({ id: 'hook_ok2', failurePolicy: 'ignore', priority: 2, name: 'After Warn' }),
      ];
      await manager.reloadHooks();

      mockExecutor.interceptorResults = [
        { success: false, duration: 5000, timedOut: true, error: 'Execution timed out' },
        { success: true, duration: 3, timedOut: false, decision: { decision: 'allow' } },
      ];

      const result = await manager.evaluate(makeEvent());

      expect(result.decision).toBe('allow');
      expect(result.evaluatedCount).toBe(2);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Timeout Warn'),
        expect.anything(),
      );
    });
  });

  it('should downgrade rewrite to "allow" on non-message event', async () => {
    mockStorage.hooks = [
      makeHook({
        event: 'tool.pre_use',
        name: 'Rewrite on tool event',
      }),
    ];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      {
        success: true,
        duration: 3,
        timedOut: false,
        decision: { decision: 'rewrite', rewrittenMessage: 'should not apply' },
      },
    ];

    const result = await manager.evaluate(makeEvent({ type: 'tool.pre_use', data: { toolName: 'Write' } }));

    expect(result.decision).toBe('allow');
    expect(result.rewrittenMessage).toBeUndefined();
    expect(result.steps[0].decision).toBe('allow');
    expect(result.steps[0].reason).toContain('Rewrite downgraded');
  });

  it('should accumulate totalDuration from all evaluated steps', async () => {
    mockStorage.hooks = [
      makeHook({ id: 'hook_d1', priority: 1 }),
      makeHook({ id: 'hook_d2', priority: 2 }),
    ];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      { success: true, duration: 100, timedOut: false, decision: { decision: 'allow' } },
      { success: true, duration: 200, timedOut: false, decision: { decision: 'allow' } },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.totalDuration).toBe(300);
  });

  it('should handle executor throwing an unexpected error with failurePolicy abort', async () => {
    const throwingExecutor: InterceptorExecutor = {
      type: 'script',
      async execute() { return { success: true, duration: 0, timedOut: false }; },
      async executeInterceptor(): Promise<InterceptorExecutionResult> {
        throw new Error('Unexpected executor crash');
      },
    };
    const executors: ExecutorRegistry = new Map();
    executors.set('script', throwingExecutor);
    const mgr = new HookManager(mockStorage as unknown as HookStorage, executors);

    mockStorage.hooks = [makeHook({ failurePolicy: 'abort', name: 'Crashing Hook' })];
    await mgr.initialize();

    const result = await mgr.evaluate(makeEvent());

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('threw an error');
    expect(result.steps[0].error).toBe('Unexpected executor crash');
  });

  it('should handle executor throwing an unexpected error with failurePolicy ignore', async () => {
    const throwingExecutor: InterceptorExecutor = {
      type: 'script',
      async execute() { return { success: true, duration: 0, timedOut: false }; },
      async executeInterceptor(): Promise<InterceptorExecutionResult> {
        throw new Error('Unexpected executor crash');
      },
    };
    const executors: ExecutorRegistry = new Map();
    executors.set('script', throwingExecutor);
    const mgr = new HookManager(mockStorage as unknown as HookStorage, executors);

    mockStorage.hooks = [makeHook({ failurePolicy: 'ignore', name: 'Crashing Ignored' })];
    await mgr.initialize();

    const result = await mgr.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.evaluatedCount).toBe(1);
    expect(result.steps[0].error).toBe('Unexpected executor crash');
  });

  it('should handle missing executor for action type with failurePolicy abort', async () => {
    mockStorage.hooks = [
      makeHook({
        action: { type: 'webhook', url: 'http://example.com' },
        failurePolicy: 'abort',
        name: 'Missing Executor Hook',
      }),
    ];
    await manager.reloadHooks();

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('block');
    expect(result.reason).toContain('no executor');
    expect(result.reason).toContain('abort');
  });

  it('should skip missing executor with failurePolicy ignore and continue', async () => {
    mockStorage.hooks = [
      makeHook({
        id: 'hook_no_exec',
        action: { type: 'webhook', url: 'http://example.com' },
        failurePolicy: 'ignore',
        priority: 1,
        name: 'Missing Executor',
      }),
      makeHook({
        id: 'hook_ok_after',
        priority: 2,
        name: 'After Missing',
      }),
    ];
    await manager.reloadHooks();

    mockExecutor.interceptorResults = [
      { success: true, duration: 3, timedOut: false, decision: { decision: 'allow' } },
    ];

    const result = await manager.evaluate(makeEvent());

    expect(result.decision).toBe('allow');
    expect(result.evaluatedCount).toBe(2);
  });
});
