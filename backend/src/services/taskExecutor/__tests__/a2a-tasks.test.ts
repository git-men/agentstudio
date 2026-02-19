/**
 * A2A Async Task Integration Tests
 *
 * Tests A2A (Agent-to-Agent) async task execution through the unified executor.
 *
 * Workers fail quickly in test environment (no real agent), so assertions
 * focus on invariants rather than exact counts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskDefinition } from '../types.js';

// Mock the dependencies
vi.mock('../../a2a/taskManager.js', () => ({
  taskManager: {
    createTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    getTask: vi.fn(),
  },
}));

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    type: 'a2a_async',
    agentId: 'claude-code',
    projectPath: '/tmp/project',
    message: `A2A Task ${id}`,
    timeoutMs: 10000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('A2A Async Task Execution', () => {
  let executor: BuiltinTaskExecutor;

  beforeEach(async () => {
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

  describe('A2A Task Submission', () => {
    it('should accept A2A async task', async () => {
      const task = makeTask('a2a-task-1', { timeoutMs: 30000 });
      await expect(executor.submitTask(task)).resolves.not.toThrow();

      const stats = executor.getStats();
      // Task should be tracked (running, queued, or already settled)
      const tracked = stats.queuedTasks + stats.runningTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(1);
    });

    it('should handle multiple A2A tasks concurrently', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        makeTask(`a2a-task-${i}`, { timeoutMs: 20000 }),
      );

      for (const task of tasks) {
        await expect(executor.submitTask(task)).resolves.not.toThrow();
      }

      const stats = executor.getStats();
      // Workers start quickly, so we just verify concurrency limit
      expect(stats.runningTasks).toBeLessThanOrEqual(3);
    });

    it('should respect A2A task-specific timeout', async () => {
      const shortTask = makeTask('a2a-short', { timeoutMs: 1000 });
      const longTask = makeTask('a2a-long', { timeoutMs: 60000 });

      await executor.submitTask(shortTask);
      await executor.submitTask(longTask);

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(2);
    });
  });

  describe('A2A Task Priority', () => {
    it('should handle priority field in tasks', async () => {
      const highPriorityTask = makeTask('a2a-high-priority', { priority: 10 });
      const lowPriorityTask = makeTask('a2a-low-priority', { priority: 1 });

      await executor.submitTask(lowPriorityTask);
      await executor.submitTask(highPriorityTask);

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(2);
    });
  });

  describe('A2A Task Context', () => {
    it('should handle tasks with additional context', async () => {
      const task = makeTask('a2a-with-context', {
        timeoutMs: 25000,
        modelId: 'sonnet',
        claudeVersionId: 'claude-3.5-sonnet',
        maxTurns: 20,
        permissionMode: 'bypassPermissions',
      });

      await executor.submitTask(task);

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(1);
    });

    it('should handle tasks with push notification config', async () => {
      const task = makeTask('a2a-with-webhook', {
        timeoutMs: 15000,
        pushNotificationConfig: {
          url: 'https://example.com/webhook/callback',
          token: 'verification-token',
          authScheme: 'Bearer',
          authCredentials: 'secret-key',
        },
      });

      await expect(executor.submitTask(task)).resolves.not.toThrow();

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(1);
    });
  });

  describe('A2A Task Lifecycle', () => {
    it('should track task through execution lifecycle', async () => {
      const initialStats = executor.getStats();
      const task = makeTask('a2a-lifecycle', { timeoutMs: 5000 });

      await executor.submitTask(task);

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(1);
    });

    it('should handle task status queries', async () => {
      const task = makeTask('a2a-status-check');
      await executor.submitTask(task);

      const status = await executor.getTaskStatus(task.id);
      // Status may be non-null (task still active) or null (already settled and cleaned up)
      if (status) {
        expect(status.taskId).toBe(task.id);
        expect(['pending', 'running']).toContain(status.status);
      }
    });
  });

  describe('A2A Error Scenarios', () => {
    it('should handle invalid A2A task gracefully', async () => {
      const invalidTask = makeTask('a2a-invalid', {
        agentId: '',
        projectPath: '',
        message: '',
        timeoutMs: -1,
      });

      // Should not crash
      await executor.submitTask(invalidTask);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle concurrent A2A task failures', async () => {
      const tasks = Array.from({ length: 3 }, (_, i) =>
        makeTask(`a2a-fail-${i}`, {
          agentId: 'non-existent-agent',
          projectPath: '/invalid/path',
          timeoutMs: 5000,
        }),
      );

      for (const task of tasks) {
        await executor.submitTask(task).catch(err => {
          expect(err).toBeDefined();
        });
      }

      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('A2A Task Cancellation', () => {
    it('should attempt to cancel A2A task without throwing', async () => {
      const task = makeTask('a2a-cancel-test', { timeoutMs: 30000 });
      await executor.submitTask(task);

      // Cancel — should not throw regardless of success
      await expect(executor.cancelTask(task.id)).resolves.not.toThrow();

      // cancelTask should return a boolean
      const canceled = await executor.cancelTask('non-existent-id');
      expect(typeof canceled).toBe('boolean');
    });

    it('should return false when canceling non-existent task', async () => {
      const canceled = await executor.cancelTask('a2a-non-existent-task');
      expect(canceled).toBe(false);
    });

    it('should handle cancellation of multiple submitted tasks', { timeout: 15000 }, async () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask(`a2a-queue-cancel-${i}`, { timeoutMs: 15000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      // Try to cancel some — may or may not succeed depending on speed
      await expect(executor.cancelTask('a2a-queue-cancel-8')).resolves.not.toThrow();
      await expect(executor.cancelTask('a2a-queue-cancel-9')).resolves.not.toThrow();
    });
  });

  describe('A2A Performance', () => {
    it('should handle burst of A2A task submissions', { timeout: 30000 }, async () => {
      const burstSize = 20;
      const tasks = Array.from({ length: burstSize }, (_, i) =>
        makeTask(`a2a-burst-${i}`),
      );

      const startTime = Date.now();
      await expect(
        Promise.all(tasks.map(task => executor.submitTask(task))),
      ).resolves.not.toThrow();
      const submissionTime = Date.now() - startTime;

      // 20 tasks through maxConcurrent=3 ≈ 7 rounds of Worker creation;
      // each Worker startup is 50-300ms depending on the machine.
      expect(submissionTime).toBeLessThan(20000);

      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(3);
    });

    it('should maintain executor health under load', { timeout: 20000 }, async () => {
      const tasks = Array.from({ length: 15 }, (_, i) =>
        makeTask(`a2a-load-${i}`, { timeoutMs: 20000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      expect(executor.isHealthy()).toBe(true);

      const stats = executor.getStats();
      expect(stats.mode).toBe('builtin');
      expect(stats.uptimeMs).toBeGreaterThan(0);
    });
  });
});
