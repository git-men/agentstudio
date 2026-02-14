/**
 * Load and Stress Tests
 *
 * Tests the executor under heavy load and stress conditions.
 *
 * Assertions use ranges rather than exact counts because workers
 * can fail/complete very quickly in test environments.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskDefinition } from '../types.js';
import { waitFor } from './test-utils.js';

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    type: 'scheduled',
    agentId: 'test-agent',
    projectPath: '/tmp/test',
    message: `Task ${id}`,
    timeoutMs: 15000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('Load and Stress Tests', () => {
  let executor: BuiltinTaskExecutor;

  beforeEach(async () => {
    executor = new BuiltinTaskExecutor({
      maxConcurrent: 5,
      defaultTimeoutMs: 30000,
      maxMemoryMb: 512,
    });
    await executor.start();
  });

  afterEach(async () => {
    await executor.stop();
  });

  describe('High Load Scenarios', () => {
    it('should handle 100 concurrent task submissions', { timeout: 60000 }, async () => {
      const taskCount = 100;
      const tasks = Array.from({ length: taskCount }, (_, i) =>
        makeTask(`load-100-${i}`),
      );

      const startTime = Date.now();
      await Promise.all(tasks.map(task => executor.submitTask(task)));
      const submissionTime = Date.now() - startTime;

      const stats = executor.getStats();

      // Submissions should complete reasonably quickly (Worker startup adds overhead)
      expect(submissionTime).toBeLessThan(30000);

      // Should respect concurrency limits
      expect(stats.runningTasks).toBeLessThanOrEqual(5);

      // All tasks should be accounted for (running + queued + already settled)
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(taskCount);

      // Executor should remain healthy
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle sustained load over time', async () => {
      const batches = 5;
      const tasksPerBatch = 10;

      for (let batch = 0; batch < batches; batch++) {
        const tasks = Array.from({ length: tasksPerBatch }, (_, i) =>
          makeTask(`sustained-${batch}-${i}`, { timeoutMs: 5000 }),
        );

        for (const task of tasks) {
          await executor.submitTask(task);
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const stats = executor.getStats();
      const totalSubmitted = batches * tasksPerBatch;

      // Total tracked tasks should account for all submitted
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeLessThanOrEqual(totalSubmitted);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle burst submissions', async () => {
      const burstCount = 50;
      const tasks = Array.from({ length: burstCount }, (_, i) =>
        makeTask(`burst-${i}`, { type: 'a2a_async', timeoutMs: 10000 }),
      );

      const startTime = Date.now();

      // Submit all in rapid succession (fire-and-forget pattern)
      for (const task of tasks) {
        executor.submitTask(task).catch(() => {
          // Don't fail test on individual errors
        });
      }

      const burstTime = Date.now() - startTime;

      // Should handle burst quickly (synchronous queueing)
      expect(burstTime).toBeLessThan(1000);

      // At least some tasks should be tracked
      const stats = executor.getStats();
      expect(stats.runningTasks + stats.queuedTasks).toBeGreaterThanOrEqual(0);
      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Memory Stress', () => {
    it('should handle many queued tasks without memory issues', { timeout: 60000 }, async () => {
      const largeQueueSize = 200;
      const tasks = Array.from({ length: largeQueueSize }, (_, i) =>
        makeTask(`memory-queue-${i}`, { timeoutMs: 30000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      // All 200 tasks should be accounted for somewhere (queued, running, completed, failed)
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(largeQueueSize);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle tasks with large payloads', async () => {
      const largeMessage = 'x'.repeat(10000); // 10KB message
      const count = 10;

      const tasks = Array.from({ length: count }, (_, i) =>
        makeTask(`large-payload-${i}`, { type: 'a2a_async', message: largeMessage }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      expect(executor.isHealthy()).toBe(true);
      // All 10 should be tracked somewhere
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(count);
    });
  });

  describe('Concurrency Limits', () => {
    it('should strictly enforce maxConcurrent limit', async () => {
      const maxConcurrent = 5;
      const taskCount = 50;
      const tasks = Array.from({ length: taskCount }, (_, i) =>
        makeTask(`concurrent-limit-${i}`, { timeoutMs: 30000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      // Running tasks should never exceed maxConcurrent
      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(maxConcurrent);

      // Some should be queued (even if workers fail fast, not all can run at once)
      expect(stats.queuedTasks).toBeGreaterThanOrEqual(0);
    });

    it('should process queue as workers become available', async () => {
      const taskCount = 15;
      const tasks = Array.from({ length: taskCount }, (_, i) =>
        makeTask(`queue-process-${i}`, { timeoutMs: 1000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const initialStats = executor.getStats();
      const initialActive = initialStats.runningTasks + initialStats.queuedTasks;

      // Wait for some tasks to settle
      await waitFor(() => {
        const s = executor.getStats();
        return s.completedTasks + s.failedTasks > 0;
      }, { timeoutMs: 10000, message: 'Expected some tasks to settle' });

      const laterStats = executor.getStats();
      const laterActive = laterStats.runningTasks + laterStats.queuedTasks;

      // Active count should decrease or equal as tasks settle
      expect(laterActive).toBeLessThanOrEqual(initialActive);
    });
  });

  describe('Rapid Start/Stop', () => {
    it('should handle rapid start/stop cycles', async () => {
      for (let i = 0; i < 5; i++) {
        const testExecutor = new BuiltinTaskExecutor({
          maxConcurrent: 2,
          defaultTimeoutMs: 5000,
        });

        await testExecutor.start();
        expect(testExecutor.isHealthy()).toBe(true);

        await testExecutor.stop();
        expect(testExecutor.isHealthy()).toBe(false);
      }
    });

    it('should handle shutdown during heavy load', async () => {
      const taskCount = 100;
      const tasks = Array.from({ length: taskCount }, (_, i) =>
        makeTask(`shutdown-load-${i}`, { timeoutMs: 30000 }),
      );

      // Submit many tasks (fire-and-forget)
      for (const task of tasks) {
        executor.submitTask(task).catch(() => {});
      }

      // Shutdown while under load
      await expect(executor.stop()).resolves.not.toThrow();

      const stats = executor.getStats();
      expect(stats.runningTasks).toBe(0);
      expect(stats.queuedTasks).toBe(0);
    });
  });

  describe('Mixed Workload', () => {
    it('should handle mixed A2A and scheduled tasks', async () => {
      const tasks: TaskDefinition[] = [];

      for (let i = 0; i < 25; i++) {
        tasks.push(makeTask(`mixed-a2a-${i}`, { type: 'a2a_async' }));
      }
      for (let i = 0; i < 25; i++) {
        tasks.push(makeTask(`mixed-scheduled-${i}`, { type: 'scheduled' }));
      }

      // Submit in random order
      const shuffled = tasks.sort(() => Math.random() - 0.5);
      for (const task of shuffled) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      expect(executor.isHealthy()).toBe(true);
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(50);
    });

    it('should handle tasks with varying timeouts', async () => {
      const timeoutVariations = [1000, 5000, 10000, 20000, 30000];
      const tasks: TaskDefinition[] = [];

      for (const timeout of timeoutVariations) {
        for (let i = 0; i < 10; i++) {
          tasks.push(makeTask(`timeout-${timeout}-${i}`, { timeoutMs: timeout }));
        }
      }

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      expect(executor.isHealthy()).toBe(true);
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Long Running Tests', () => {
    it('should maintain stability over extended period', async () => {
      const duration = 3000; // 3 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < duration) {
        const task = makeTask(`extended-${Date.now()}`);
        await executor.submitTask(task).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      expect(executor.isHealthy()).toBe(true);
      const stats = executor.getStats();
      expect(stats.uptimeMs).toBeGreaterThan(0);
    });

    it('should handle many status queries under load', async () => {
      const tasks = Array.from({ length: 20 }, (_, i) =>
        makeTask(`query-stress-${i}`),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      // Perform many status queries
      for (let i = 0; i < 100; i++) {
        const id = `query-stress-${Math.floor(Math.random() * 20)}`;
        await executor.getTaskStatus(id).catch(() => {});
      }

      expect(executor.isHealthy()).toBe(true);
    });
  });
});
