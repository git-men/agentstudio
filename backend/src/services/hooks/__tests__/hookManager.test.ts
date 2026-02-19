import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HookManager } from '../hookManager.js';
import { HookStorage } from '../hookStorage.js';
import type { HookEvent, PlatformHook, HookExecutionResult, HookCreateRequest } from '../../../types/platformHooks.js';
import type { ExecutorRegistry, HookExecutor, ExecutionOptions } from '../executors/types.js';

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'run.end',
    timestamp: new Date().toISOString(),
    source: 'TestRunner',
    data: {},
    ...overrides,
  };
}

function makeHook(overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-001',
    name: 'Test Hook',
    enabled: true,
    event: 'run.end',
    action: { type: 'shell', command: 'echo test' },
    scope: 'global',
    timeout: 30000,
    failurePolicy: 'warn',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

class MockExecutor implements HookExecutor {
  readonly type = 'shell';
  calls: Array<{ hook: PlatformHook; event: HookEvent }> = [];
  resultFn: () => HookExecutionResult = () => ({
    success: true,
    duration: 10,
    timedOut: false,
  });

  async execute(
    hook: PlatformHook,
    event: HookEvent,
    _options: ExecutionOptions,
  ): Promise<HookExecutionResult> {
    this.calls.push({ hook, event });
    return this.resultFn();
  }
}

class MockStorage {
  hooks: PlatformHook[] = [];

  async loadAllHooks(): Promise<PlatformHook[]> {
    return [...this.hooks];
  }

  async loadGlobalHooks(): Promise<PlatformHook[]> {
    return this.hooks.filter(h => h.scope === 'global');
  }

  async loadProjectHooks(projectId: string): Promise<PlatformHook[]> {
    return this.hooks.filter(h => h.scope === 'project' && h.projectId === projectId);
  }

  async saveHook(hook: PlatformHook): Promise<void> {
    const idx = this.hooks.findIndex(h => h.id === hook.id);
    if (idx >= 0) {
      this.hooks[idx] = hook;
    } else {
      this.hooks.push(hook);
    }
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

let mockStorage: MockStorage;
let mockExecutor: MockExecutor;
let manager: HookManager;

function createManager(): HookManager {
  mockStorage = new MockStorage();
  mockExecutor = new MockExecutor();
  const executors: ExecutorRegistry = new Map();
  executors.set('shell', mockExecutor);
  return new HookManager(mockStorage as unknown as HookStorage, executors);
}

describe('HookManager', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    manager = createManager();
    await manager.initialize();
  });

  describe('event matching', () => {
    it('should match hook by exact event type', async () => {
      mockStorage.hooks = [makeHook({ event: 'run.end' })];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));
    });

    it('should not match disabled hook', async () => {
      mockStorage.hooks = [makeHook({ enabled: false })];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(0);
    });

    it('should not match hook for different event type', async () => {
      mockStorage.hooks = [makeHook({ event: 'run.start' })];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(0);
    });

    it('should execute hooks in priority order (lower first)', async () => {
      const order: string[] = [];

      const exec1 = new MockExecutor();
      exec1.resultFn = () => { order.push('low'); return { success: true, duration: 1, timedOut: false }; };
      const exec2 = new MockExecutor();
      exec2.resultFn = () => { order.push('high'); return { success: true, duration: 1, timedOut: false }; };

      // Both use same executor via the registry, but we track call order via resultFn
      mockStorage.hooks = [
        makeHook({ id: 'hook_high', priority: 20, name: 'High' }),
        makeHook({ id: 'hook_low', priority: 5, name: 'Low' }),
      ];
      await manager.reloadHooks();

      const callOrder: number[] = [];
      let callIdx = 0;
      mockExecutor.resultFn = () => {
        callOrder.push(callIdx++);
        return { success: true, duration: 1, timedOut: false };
      };

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));

      // First call should be the low-priority (5) hook
      expect(mockExecutor.calls[0].hook.priority).toBe(5);
      expect(mockExecutor.calls[1].hook.priority).toBe(20);
    });

    it('should handle failurePolicy=warn (log and continue)', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_1', priority: 1, failurePolicy: 'warn', name: 'Warn Hook' }),
        makeHook({ id: 'hook_2', priority: 2, name: 'After Warn' }),
      ];
      await manager.reloadHooks();

      let callCount = 0;
      mockExecutor.resultFn = () => {
        callCount++;
        if (callCount === 1) {
          return { success: false, duration: 1, timedOut: false, error: 'test failure' };
        }
        return { success: true, duration: 1, timedOut: false };
      };

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Warn Hook'),
        expect.anything(),
      );
    });

    it('should handle failurePolicy=abort (stop remaining hooks)', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_1', priority: 1, failurePolicy: 'abort', name: 'Abort Hook' }),
        makeHook({ id: 'hook_2', priority: 2, name: 'Should Not Run' }),
      ];
      await manager.reloadHooks();

      mockExecutor.resultFn = () => ({
        success: false, duration: 1, timedOut: false, error: 'abort error',
      });

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await new Promise(r => setTimeout(r, 100));

      expect(mockExecutor.calls).toHaveLength(1);
    });

    it('should handle failurePolicy=ignore (continue silently)', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_1', priority: 1, failurePolicy: 'ignore', name: 'Ignore Hook' }),
        makeHook({ id: 'hook_2', priority: 2, name: 'After Ignore' }),
      ];
      await manager.reloadHooks();

      let callCount = 0;
      mockExecutor.resultFn = () => {
        callCount++;
        if (callCount === 1) {
          return { success: false, duration: 1, timedOut: false, error: 'ignored' };
        }
        return { success: true, duration: 1, timedOut: false };
      };

      manager.handleEvent(makeEvent({ type: 'run.end' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));
    });
  });

  describe('scope-based matching', () => {
    it('should match global hook for any project', async () => {
      mockStorage.hooks = [makeHook({ scope: 'global' })];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ projectId: 'proj-1' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      manager.handleEvent(makeEvent({ projectId: 'proj-2' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));
    });

    it('should match project-scoped hook only for its project', async () => {
      mockStorage.hooks = [makeHook({ scope: 'project', projectId: 'proj-1' })];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ projectId: 'proj-1' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      manager.handleEvent(makeEvent({ projectId: 'proj-2' }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(1);
    });

    it('should fire both global and project hooks, ordered by priority', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_global', scope: 'global', priority: 20 }),
        makeHook({ id: 'hook_project', scope: 'project', projectId: 'proj-1', priority: 5 }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ projectId: 'proj-1' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));

      expect(mockExecutor.calls[0].hook.id).toBe('hook_project');
      expect(mockExecutor.calls[1].hook.id).toBe('hook_global');
    });
  });

  describe('filter matching', () => {
    it('should match hook with toolName filter', async () => {
      mockStorage.hooks = [
        makeHook({ event: 'tool.call_end', filter: { toolName: 'Write' } }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ type: 'tool.call_end', data: { toolName: 'Write' } }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      manager.handleEvent(makeEvent({ type: 'tool.call_end', data: { toolName: 'Read' } }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(1);
    });

    it('should match hook with toolName array filter (OR)', async () => {
      mockStorage.hooks = [
        makeHook({ event: 'tool.call_end', filter: { toolName: ['Write', 'Edit'] } }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ type: 'tool.call_end', data: { toolName: 'Edit' } }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));
    });

    it('should match hook with agentId filter', async () => {
      mockStorage.hooks = [
        makeHook({ filter: { agentId: 'agent-a' } }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ agentId: 'agent-a' }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      manager.handleEvent(makeEvent({ agentId: 'agent-b' }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(1);
    });

    it('should use AND logic across filter fields', async () => {
      mockStorage.hooks = [
        makeHook({
          event: 'tool.call_end',
          filter: { toolName: 'Write', agentId: 'agent-a' },
        }),
      ];
      await manager.reloadHooks();

      // Both match -> fires
      manager.handleEvent(makeEvent({ type: 'tool.call_end', agentId: 'agent-a', data: { toolName: 'Write' } }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      // Only toolName matches -> should NOT fire
      manager.handleEvent(makeEvent({ type: 'tool.call_end', agentId: 'agent-b', data: { toolName: 'Write' } }));
      await new Promise(r => setTimeout(r, 50));
      expect(mockExecutor.calls).toHaveLength(1);
    });

    it('should match hook with no filter against all events of its type', async () => {
      mockStorage.hooks = [makeHook()]; // no filter
      await manager.reloadHooks();

      manager.handleEvent(makeEvent({ data: { anything: 'value' } }));
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));
    });
  });

  describe('CRUD operations', () => {
    it('should create a hook with auto-generated id and timestamps', async () => {
      const req: HookCreateRequest = {
        name: 'New Hook',
        enabled: true,
        event: 'run.end',
        action: { type: 'shell', command: 'echo created' },
        scope: 'global',
        timeout: 30000,
        failurePolicy: 'warn',
        priority: 10,
      };

      const hook = await manager.createHook(req);
      expect(hook.id).toMatch(/^hook_/);
      expect(hook.createdAt).toBeTruthy();
      expect(hook.updatedAt).toBeTruthy();
      expect(hook.name).toBe('New Hook');

      const found = await manager.getHook(hook.id);
      expect(found).toEqual(hook);
    });

    it('should update a hook', async () => {
      const hook = makeHook();
      mockStorage.hooks = [hook];
      await manager.reloadHooks();

      const updated = await manager.updateHook(hook.id, { name: 'Updated' });
      expect(updated?.name).toBe('Updated');
      expect(updated?.id).toBe(hook.id);
      expect(updated?.createdAt).toBe(hook.createdAt);
    });

    it('should return null when updating non-existent hook', async () => {
      const result = await manager.updateHook('hook_nonexistent', { name: 'Nope' });
      expect(result).toBeNull();
    });

    it('should delete a hook', async () => {
      const hook = makeHook();
      mockStorage.hooks = [hook];
      await manager.reloadHooks();

      const deleted = await manager.deleteHook(hook.id);
      expect(deleted).toBe(true);

      const found = await manager.getHook(hook.id);
      expect(found).toBeNull();
    });

    it('should list hooks with filters', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_1', scope: 'global', event: 'run.end' }),
        makeHook({ id: 'hook_2', scope: 'project', projectId: 'proj-1', event: 'run.start' }),
        makeHook({ id: 'hook_3', scope: 'global', event: 'run.end', enabled: false }),
      ];
      await manager.reloadHooks();

      const all = await manager.listHooks();
      expect(all).toHaveLength(3);

      const globalOnly = await manager.listHooks({ scope: 'global' });
      expect(globalOnly).toHaveLength(2);

      const runEnd = await manager.listHooks({ event: 'run.end' });
      expect(runEnd).toHaveLength(2);

      const enabledOnly = await manager.listHooks({ enabled: true });
      expect(enabledOnly).toHaveLength(2);
    });
  });

  describe('execution history', () => {
    it('should record execution after hook fires', async () => {
      mockStorage.hooks = [makeHook()];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent());
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(1));

      await new Promise(r => setTimeout(r, 50));
      const { executions, total } = manager.getExecutions();
      expect(total).toBe(1);
      expect(executions[0].hookId).toBe('hook_test-001');
      expect(executions[0].eventType).toBe('run.end');
      expect(executions[0].result.success).toBe(true);
    });

    it('should return executions in reverse chronological order', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_a', priority: 1 }),
        makeHook({ id: 'hook_b', priority: 2 }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent());
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));

      await new Promise(r => setTimeout(r, 50));
      const { executions } = manager.getExecutions();
      expect(executions).toHaveLength(2);
      // Last executed should be first in history (unshift)
      expect(executions[0].hookId).toBe('hook_b');
      expect(executions[1].hookId).toBe('hook_a');
    });

    it('should filter executions by hookId', async () => {
      mockStorage.hooks = [
        makeHook({ id: 'hook_a', priority: 1 }),
        makeHook({ id: 'hook_b', priority: 2 }),
      ];
      await manager.reloadHooks();

      manager.handleEvent(makeEvent());
      await vi.waitFor(() => expect(mockExecutor.calls).toHaveLength(2));

      await new Promise(r => setTimeout(r, 50));
      const { executions } = manager.getExecutions({ hookId: 'hook_a' });
      expect(executions).toHaveLength(1);
      expect(executions[0].hookId).toBe('hook_a');
    });
  });

  describe('non-blocking dispatch', () => {
    it('should return immediately from handleEvent', async () => {
      let resolveExec: (() => void) | undefined;
      mockExecutor.resultFn = () => {
        return new Promise(resolve => {
          resolveExec = () => resolve({ success: true, duration: 100, timedOut: false });
        }) as unknown as HookExecutionResult;
      };

      mockStorage.hooks = [makeHook()];
      await manager.reloadHooks();

      const start = Date.now();
      manager.handleEvent(makeEvent());
      const elapsed = Date.now() - start;

      // handleEvent should return in < 10ms (it's fire-and-forget)
      expect(elapsed).toBeLessThan(50);

      // Cleanup: resolve the pending executor
      resolveExec?.();
    });
  });
});
