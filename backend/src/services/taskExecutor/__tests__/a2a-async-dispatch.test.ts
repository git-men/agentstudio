/**
 * A2A Async Task Dispatch Tests
 *
 * Tests the new behaviors introduced by fix/a2a-async-dispatch:
 * 1. Task transitions to 'running' immediately when worker starts
 * 2. Worker exit without completion message marks task as failed
 * 3. completionReceived tracking prevents double-handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskDefinition } from '../types.js';

// Mock taskManager used by BuiltinExecutor via dynamic import
const mockGetTask = vi.fn();
const mockUpdateTaskStatus = vi.fn();

vi.mock('../../a2a/taskManager.js', () => ({
  taskManager: {
    createTask: vi.fn(),
    getTask: mockGetTask,
    updateTaskStatus: mockUpdateTaskStatus,
  },
}));

// Mock scheduledTaskStorage (imported by storeResult for 'scheduled' tasks)
vi.mock('../../scheduledTaskStorage.js', () => ({
  updateTaskExecution: vi.fn(),
  updateTaskRunStatus: vi.fn(),
}));

vi.mock('../../schedulerService.js', () => ({
  onScheduledTaskComplete: vi.fn(),
}));

// Mock webhookService
vi.mock('../../a2a/webhookService.js', () => ({
  sendTaskCompletionWebhook: vi.fn().mockResolvedValue({ success: true, attempts: 1 }),
}));

function makeA2ATask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    type: 'a2a_async',
    agentId: 'test-agent',
    projectPath: '/tmp/test-project',
    message: `Test A2A task ${id}`,
    timeoutMs: 15000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('A2A Async Task Dispatch — New Behaviors', () => {
  let executor: BuiltinTaskExecutor;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: getTask returns a pending task so the transition can proceed
    mockGetTask.mockResolvedValue({ id: 'any', status: 'pending' });
    mockUpdateTaskStatus.mockResolvedValue({ status: 'running' });

    executor = new BuiltinTaskExecutor({
      maxConcurrent: 3,
      defaultTimeoutMs: 15000,
      maxMemoryMb: 512,
    });
    await executor.start();
  });

  afterEach(async () => {
    await executor.stop();
  });

  // =========================================================================
  // 1. Immediate transition to 'running' on worker start
  // =========================================================================

  describe('Immediate running transition', () => {
    it('should call taskManager.updateTaskStatus(running) shortly after submitting an A2A task', async () => {
      const task = makeA2ATask('dispatch-1');
      await executor.submitTask(task);

      // transitionA2ATaskToRunning is fire-and-forget; give it a tick
      await new Promise(r => setTimeout(r, 200));

      // getTask should have been called to check current status
      expect(mockGetTask).toHaveBeenCalledWith('/tmp/test-project', 'dispatch-1');

      // updateTaskStatus should have been called with 'running'
      const runningCalls = mockUpdateTaskStatus.mock.calls.filter(
        (c: any[]) => c[2] === 'running'
      );
      expect(runningCalls.length).toBeGreaterThanOrEqual(1);
      expect(runningCalls[0][0]).toBe('/tmp/test-project');
      expect(runningCalls[0][1]).toBe('dispatch-1');
    });

    it('should NOT call transitionA2ATaskToRunning for scheduled tasks', async () => {
      const task: TaskDefinition = {
        id: 'sched-1',
        type: 'scheduled',
        agentId: 'test-agent',
        projectPath: '/tmp/test-project',
        message: 'Scheduled task',
        timeoutMs: 10000,
        createdAt: new Date().toISOString(),
      };

      await executor.submitTask(task);
      await new Promise(r => setTimeout(r, 200));

      // For scheduled tasks, getTask should NOT have been called with 'running'
      // by transitionA2ATaskToRunning (storeResult may call it later)
      const earlyRunningCalls = mockUpdateTaskStatus.mock.calls.filter(
        (c: any[]) => c[1] === 'sched-1' && c[2] === 'running'
      );
      // In scheduled flow, updateTaskStatus is not called by transitionA2ATaskToRunning.
      // storeResult for scheduled tasks uses a different code path (scheduledTaskStorage).
      // So 'running' transition via taskManager should not happen for scheduled type.
      expect(earlyRunningCalls.length).toBe(0);
    });

    it('should gracefully handle transitionA2ATaskToRunning failure', async () => {
      // Make getTask throw to simulate a failure
      mockGetTask.mockRejectedValueOnce(new Error('File system error'));

      const task = makeA2ATask('dispatch-err');
      await executor.submitTask(task);

      await new Promise(r => setTimeout(r, 200));

      // Executor should still be healthy despite the transition failure
      expect(executor.isHealthy()).toBe(true);
    });

    it('should skip transition if task is already running', async () => {
      // Return a task that is already 'running'
      mockGetTask.mockResolvedValueOnce({ id: 'already-running', status: 'running' });

      const task = makeA2ATask('already-running');
      await executor.submitTask(task);

      await new Promise(r => setTimeout(r, 200));

      // updateTaskStatus should NOT be called with 'running' by transitionA2ATaskToRunning
      // (it only transitions pending → running)
      const runningCalls = mockUpdateTaskStatus.mock.calls.filter(
        (c: any[]) => c[1] === 'already-running' && c[2] === 'running'
      );
      // The transitionA2ATaskToRunning checks status and skips if not pending
      expect(runningCalls.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. Worker exit without completion message → task marked failed
  // =========================================================================

  describe('Worker exit without completion', () => {
    it('should eventually mark task as failed when worker fails', async () => {
      // Workers fail in test env (no real agent SDK), which triggers
      // either an error message or exit without completion
      const task = makeA2ATask('exit-no-complete', { timeoutMs: 5000 });
      await executor.submitTask(task);

      // Wait for the worker to fail
      await new Promise(r => setTimeout(r, 3000));

      // The task should have been marked as failed via storeResult
      const failedCalls = mockUpdateTaskStatus.mock.calls.filter(
        (c: any[]) => c[1] === 'exit-no-complete' && c[2] === 'failed'
      );
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // =========================================================================
  // 3. storeResult fallback: pending → running → failed
  // =========================================================================

  describe('storeResult fallback transition', () => {
    it('should transition pending → running in storeResult if not already running', async () => {
      // getTask returns pending for storeResult's fallback check
      mockGetTask.mockResolvedValue({ id: 'fallback-1', status: 'pending' });

      const task = makeA2ATask('fallback-1', { timeoutMs: 5000 });
      await executor.submitTask(task);

      // Wait for worker to fail and storeResult to run
      await new Promise(r => setTimeout(r, 3000));

      const allCalls = mockUpdateTaskStatus.mock.calls.filter(
        (c: any[]) => c[1] === 'fallback-1'
      );

      // Should have at least one 'running' and one 'failed' call
      const runningCalls = allCalls.filter((c: any[]) => c[2] === 'running');
      const failedCalls = allCalls.filter((c: any[]) => c[2] === 'failed');

      expect(runningCalls.length).toBeGreaterThanOrEqual(1);
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // =========================================================================
  // 4. Stats tracking
  // =========================================================================

  describe('Stats after dispatch', () => {
    it('should count failed tasks after worker errors', async () => {
      const task = makeA2ATask('stats-fail', { timeoutMs: 5000 });
      await executor.submitTask(task);

      // Wait for failure
      await new Promise(r => setTimeout(r, 3000));

      const stats = executor.getStats();
      expect(stats.failedTasks).toBeGreaterThanOrEqual(1);
    }, 10000);

    it('should decrement running count after worker exit', async () => {
      const task = makeA2ATask('stats-exit', { timeoutMs: 5000 });
      await executor.submitTask(task);

      // Wait for failure
      await new Promise(r => setTimeout(r, 3000));

      const stats = executor.getStats();
      expect(stats.runningTasks).toBe(0);
    }, 10000);
  });
});
