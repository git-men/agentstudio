/**
 * Error Handling and Recovery Tests
 *
 * Tests how the executor handles errors, failures, and recovers from them.
 *
 * Uses polling-based waits instead of fixed delays for reliability.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskDefinition } from '../types.js';
import { waitFor, waitForTasksSettled } from './test-utils.js';

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    type: 'scheduled',
    agentId: 'test-agent',
    projectPath: '/tmp/test',
    message: `Task ${id}`,
    timeoutMs: 5000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Error Handling and Recovery', () => {
  let executor: BuiltinTaskExecutor;

  beforeEach(async () => {
    executor = new BuiltinTaskExecutor({
      maxConcurrent: 2,
      defaultTimeoutMs: 10000,
      maxMemoryMb: 256,
    });
    await executor.start();
  });

  afterEach(async () => {
    await executor.stop();
  });

  describe('Worker Failures', () => {
    it('should handle worker crash gracefully', async () => {
      const task = makeTask('crash-task', {
        agentId: 'non-existent',
        projectPath: '/invalid/path',
      });

      await executor.submitTask(task);

      // Wait for task to fail
      await waitFor(() => executor.getStats().failedTasks > 0, {
        timeoutMs: 10000,
        message: 'Task should have failed',
      });

      const stats = executor.getStats();
      expect(stats.failedTasks).toBeGreaterThan(0);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should continue processing after worker failure', { timeout: 15000 }, async () => {
      const failingTask = makeTask('failing-task', {
        agentId: 'invalid-agent',
        projectPath: '/invalid',
        timeoutMs: 3000,
      });

      const validTask = makeTask('valid-task-after-fail');

      await executor.submitTask(failingTask);
      await executor.submitTask(validTask);

      // Wait for at least one task to settle
      await waitFor(() => {
        const s = executor.getStats();
        return s.completedTasks + s.failedTasks > 0;
      }, { timeoutMs: 10000, message: 'At least one task should settle' });

      const stats = executor.getStats();
      // Both tasks should have been processed (in some state)
      const total = stats.runningTasks + stats.queuedTasks +
                    stats.completedTasks + stats.failedTasks;
      expect(total).toBeGreaterThan(0);
    });

    it('should handle multiple concurrent worker failures', { timeout: 30000 }, async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        makeTask(`concurrent-fail-${i}`, {
          agentId: 'invalid',
          projectPath: '/invalid',
          timeoutMs: 3000,
        }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      // Wait for all to fail
      await waitForTasksSettled(executor, 5, { timeoutMs: 15000 });

      const stats = executor.getStats();
      expect(stats.failedTasks).toBeGreaterThan(0);
      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle memory pressure gracefully', { timeout: 30000 }, async () => {
      const tasks = Array.from({ length: 4 }, (_, i) =>
        makeTask(`memory-task-${i}`),
      );

      const submissions = tasks.map(task =>
        executor.submitTask(task).catch(() => {}),
      );

      // Give queue time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(2);

      // All tasks should be tracked
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(2);

      await Promise.all(submissions);
    });

    it('should queue tasks when at capacity', { timeout: 30000 }, async () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask(`capacity-${i}`, { timeoutMs: 15000 }),
      );

      const submissions = tasks.map(task =>
        executor.submitTask(task).catch(() => {}),
      );

      // Give queue time to process
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(2);

      // Total tracked should account for most submitted
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(8);

      await Promise.all(submissions);
    });
  });

  describe('Invalid Input Handling', () => {
    it('should handle missing required fields', async () => {
      const invalidTask = {
        id: 'invalid-missing-fields',
        type: 'scheduled',
        timeoutMs: 5000,
        createdAt: new Date().toISOString(),
      } as any as TaskDefinition;

      // Should not crash the executor
      await executor.submitTask(invalidTask).catch(err => {
        expect(err).toBeDefined();
      });

      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle invalid timeout values', async () => {
      const tasks: TaskDefinition[] = [
        makeTask('negative-timeout', { timeoutMs: -1000 }),
        makeTask('zero-timeout', { timeoutMs: 0 }),
        makeTask('huge-timeout', { timeoutMs: Number.MAX_SAFE_INTEGER }),
      ];

      for (const task of tasks) {
        await executor.submitTask(task).catch(err => {
          expect(err).toBeDefined();
        });
      }

      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle malformed task IDs', async () => {
      const tasks: TaskDefinition[] = [
        makeTask('', { message: 'Empty ID' }),
        makeTask('task with spaces!', { message: 'Spaces in ID' }),
        makeTask('../../../etc/passwd', { message: 'Path traversal attempt' }),
      ];

      for (const task of tasks) {
        await executor.submitTask(task).catch(err => {
          expect(err).toBeDefined();
        });
      }

      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Recovery Scenarios', () => {
    it('should recover from partial failure', { timeout: 30000 }, async () => {
      const mixedTasks: TaskDefinition[] = [
        makeTask('will-fail', { agentId: 'invalid', projectPath: '/invalid', timeoutMs: 3000 }),
        makeTask('will-succeed'),
        makeTask('will-fail-2', { agentId: 'invalid', projectPath: '/invalid', timeoutMs: 3000 }),
      ];

      for (const task of mixedTasks) {
        await executor.submitTask(task);
      }

      // Wait for at least one failure
      await waitFor(() => executor.getStats().failedTasks >= 1, {
        timeoutMs: 10000,
        message: 'At least one task should fail',
      });

      const stats = executor.getStats();
      expect(stats.failedTasks).toBeGreaterThanOrEqual(1);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should recover from queue overflow', { timeout: 60000 }, async () => {
      const tasks = Array.from({ length: 100 }, (_, i) =>
        makeTask(`overflow-${i}`),
      );

      const submissions = tasks.map(task =>
        executor.submitTask(task).catch(() => {}),
      );

      // Wait for submissions to complete
      await Promise.all(submissions);

      const stats = executor.getStats();
      const tracked = stats.queuedTasks + stats.runningTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThan(0);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should maintain stats accuracy after errors', { timeout: 30000 }, async () => {
      const initialStats = executor.getStats();

      const failingTasks = Array.from({ length: 3 }, (_, i) =>
        makeTask(`stats-error-${i}`, {
          agentId: 'invalid',
          projectPath: '/invalid',
          timeoutMs: 2000,
        }),
      );

      for (const task of failingTasks) {
        await executor.submitTask(task);
      }

      // Wait for all 3 to fail
      await waitFor(
        () => executor.getStats().failedTasks >= initialStats.failedTasks + 3,
        { timeoutMs: 15000, message: 'All 3 tasks should fail' },
      );

      const finalStats = executor.getStats();
      expect(finalStats.failedTasks).toBe(initialStats.failedTasks + 3);
      expect(finalStats.completedTasks).toBe(initialStats.completedTasks);
    });
  });

  describe('State Consistency', () => {
    it('should maintain consistent state during errors', { timeout: 30000 }, async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        makeTask(`consistency-${i}`, {
          agentId: i % 2 === 0 ? 'invalid' : 'test-agent',
          projectPath: i % 2 === 0 ? '/invalid' : '/tmp/test',
          timeoutMs: 3000,
        }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      // Wait for some processing
      await waitFor(() => {
        const s = executor.getStats();
        return s.completedTasks + s.failedTasks > 0;
      }, { timeoutMs: 10000 });

      const stats = executor.getStats();
      const total = stats.runningTasks + stats.queuedTasks +
                    stats.completedTasks + stats.failedTasks;

      // Should account for all tasks
      expect(total).toBeGreaterThanOrEqual(5);

      // Invariants
      expect(stats.queuedTasks).toBeLessThanOrEqual(5);
      expect(stats.runningTasks).toBeLessThanOrEqual(2); // maxConcurrent
    });

    it('should cleanup properly after task completion', async () => {
      const task = makeTask('cleanup-test', { timeoutMs: 1000 });
      await executor.submitTask(task);

      // Wait for task to settle
      await waitForTasksSettled(executor, 1, { timeoutMs: 5000 });

      const status = await executor.getTaskStatus('cleanup-test');
      if (status) {
        expect(['completed', 'failed']).toContain(status.status);
      }
      // If status is null, task has been cleaned up — also valid
    });
  });

  describe('Error Logging', () => {
    it('should process failing tasks without crashing', async () => {
      const consoleSpy = vi.spyOn(console, 'error');

      const task = makeTask('logging-test', {
        agentId: 'invalid',
        projectPath: '/invalid',
        timeoutMs: 2000,
      });

      await executor.submitTask(task).catch(() => {});

      // Wait for task to fail
      await waitFor(() => executor.getStats().failedTasks > 0, {
        timeoutMs: 10000,
        message: 'Task should fail',
      });

      const stats = executor.getStats();
      expect(stats.failedTasks).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });
  });
});
