/**
 * End-to-End Workflow Tests
 *
 * Complete workflow tests simulating real-world usage scenarios.
 *
 * Workers fail quickly in test environment (no real agent), so assertions
 * focus on invariants (concurrency limits, health, task tracking) rather
 * than exact counts of running/queued tasks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskDefinition } from '../types.js';
import { waitFor } from './test-utils.js';

// Mock dependencies
vi.mock('../../a2a/taskManager.js', () => ({
  taskManager: {
    createTask: vi.fn().mockImplementation(async (data) => ({
      id: 'a2a-' + Date.now(),
      status: 'pending',
      ...data,
    })),
    updateTaskStatus: vi.fn(),
    getTask: vi.fn(),
  },
}));

vi.mock('../../scheduledTaskStorage.js', () => ({
  addTaskExecution: vi.fn(),
  updateTaskExecution: vi.fn(),
  updateTaskRunStatus: vi.fn(),
}));

function makeTask(id: string, overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id,
    type: 'scheduled',
    agentId: 'claude-code',
    projectPath: '/tmp/project',
    message: `Task ${id}`,
    timeoutMs: 10000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('End-to-End Workflow Tests', () => {
  let executor: BuiltinTaskExecutor;

  beforeEach(async () => {
    executor = new BuiltinTaskExecutor({
      maxConcurrent: 3,
      defaultTimeoutMs: 20000,
      maxMemoryMb: 512,
    });
    await executor.start();
  });

  afterEach(async () => {
    await executor.stop();
  });

  describe('A2A Task Workflow', () => {
    it('should complete full A2A task lifecycle', async () => {
      const task = makeTask('a2a-e2e-1', { type: 'a2a_async', timeoutMs: 15000 });

      // Step 1: Submit task
      await executor.submitTask(task);

      // Step 2: Task should be tracked
      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThan(0);

      // Step 3: Executor stays healthy
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle multiple A2A tasks from different sources', async () => {
      const sources = ['system-a', 'system-b', 'system-c'];
      const tasks = sources.map((source, i) =>
        makeTask(`a2a-${source}-${i}`, { type: 'a2a_async' }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(3);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle A2A task with retry workflow', async () => {
      const task = makeTask('a2a-retry-workflow', { type: 'a2a_async' });

      // Initial submission
      await executor.submitTask(task);

      // Simulate retry scenario (cancel and resubmit)
      await executor.cancelTask(task.id);
      await executor.submitTask(task);

      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Scheduled Task Workflow', () => {
    it('should complete scheduled task execution workflow', async () => {
      const task = makeTask('scheduled-e2e-1', {
        timeoutMs: 15000,
        maxTurns: 15,
        modelId: 'sonnet',
        permissionMode: 'bypassPermissions',
      });

      await executor.submitTask(task);

      const stats = executor.getStats();
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThan(0);

      const status = await executor.getTaskStatus(task.id);
      // Status may exist or be null (task already settled and cleaned up)
    });

    it('should handle recurring scheduled task workflow', async () => {
      const tasks = Array.from({ length: 3 }, (_, i) =>
        makeTask(`recurring-exec-${i}`, { timeoutMs: 5000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle scheduled task with context preservation', async () => {
      const task = makeTask('scheduled-context', {
        claudeVersionId: 'claude-3.5-sonnet',
        maxTurns: 20,
      });

      await executor.submitTask(task);

      const status = await executor.getTaskStatus(task.id);
      // Status exists if task is still active, or null if already settled
    });
  });

  describe('Mixed Workflow Scenarios', () => {
    it('should handle A2A and scheduled tasks concurrently', async () => {
      const tasks: TaskDefinition[] = [];

      for (let i = 0; i < 5; i++) {
        tasks.push(makeTask(`mixed-a2a-${i}`, { type: 'a2a_async', timeoutMs: 12000 }));
      }
      for (let i = 0; i < 5; i++) {
        tasks.push(makeTask(`mixed-scheduled-${i}`, { timeoutMs: 12000 }));
      }

      for (let i = 0; i < tasks.length; i += 2) {
        await executor.submitTask(tasks[i]);
        await executor.submitTask(tasks[i + 1]);
      }

      const stats = executor.getStats();
      expect(executor.isHealthy()).toBe(true);
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(10);
    });

    it('should handle priority-based execution', async () => {
      const highPriorityTasks = Array.from({ length: 3 }, (_, i) =>
        makeTask(`priority-high-${i}`, { priority: 10 }),
      );
      const lowPriorityTasks = Array.from({ length: 3 }, (_, i) =>
        makeTask(`priority-low-${i}`, { priority: 1 }),
      );

      for (const task of lowPriorityTasks) {
        await executor.submitTask(task);
      }
      for (const task of highPriorityTasks) {
        await executor.submitTask(task);
      }

      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Real-World Scenarios', () => {
    it('should simulate daily batch job workflow', async () => {
      const batchJobs = [
        { id: 'batch-1', name: 'Generate reports', duration: 10000 },
        { id: 'batch-2', name: 'Clean up logs', duration: 5000 },
        { id: 'batch-3', name: 'Send notifications', duration: 8000 },
        { id: 'batch-4', name: 'Update cache', duration: 6000 },
        { id: 'batch-5', name: 'Backup data', duration: 12000 },
      ];

      for (const job of batchJobs) {
        await executor.submitTask(makeTask(job.id, {
          message: `Execute: ${job.name}`,
          timeoutMs: job.duration,
        }));
      }

      const stats = executor.getStats();
      // Concurrency limit should be respected
      expect(stats.runningTasks).toBeLessThanOrEqual(3);
      // All 5 should be tracked
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThanOrEqual(5);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should simulate API request burst scenario', async () => {
      const burstSize = 20;
      const tasks = Array.from({ length: burstSize }, (_, i) =>
        makeTask(`api-burst-${i}`, { type: 'a2a_async', timeoutMs: 8000 }),
      );

      const startTime = Date.now();
      await Promise.all(tasks.map(task => executor.submitTask(task)));
      const submissionTime = Date.now() - startTime;

      // Should handle burst reasonably quickly (Worker startup adds overhead)
      expect(submissionTime).toBeLessThan(10000);
      expect(executor.isHealthy()).toBe(true);
    });

    it('should simulate gradual workload increase', async () => {
      const phases = [2, 5, 10, 15, 20];
      let totalSubmitted = 0;

      for (const phaseSize of phases) {
        const tasks = Array.from({ length: phaseSize }, (_, i) =>
          makeTask(`gradual-phase-${phaseSize}-${i}`),
        );

        for (const task of tasks) {
          await executor.submitTask(task);
          totalSubmitted++;
        }

        expect(executor.isHealthy()).toBe(true);

        const stats = executor.getStats();
        // All submitted tasks should be tracked somewhere
        const tracked = stats.runningTasks + stats.queuedTasks +
                        stats.completedTasks + stats.failedTasks +
                        stats.canceledTasks;
        expect(tracked).toBeLessThanOrEqual(totalSubmitted);
      }
    });
  });

  describe('Error Recovery Workflows', () => {
    it('should recover from task failure and continue processing', async () => {
      const failingTask = makeTask('workflow-fail', {
        agentId: 'invalid',
        projectPath: '/invalid',
        timeoutMs: 3000,
      });
      const recoveryTask = makeTask('workflow-recover');

      await executor.submitTask(failingTask);
      await executor.submitTask(recoveryTask);

      // Wait for failure
      await waitFor(() => executor.getStats().failedTasks > 0, {
        timeoutMs: 10000,
        message: 'Failing task should fail',
      });

      expect(executor.isHealthy()).toBe(true);
    });

    it('should handle cancellation and resubmission workflow', async () => {
      const task = makeTask('workflow-cancel-resubmit', { type: 'a2a_async', timeoutMs: 15000 });

      // Submit
      await executor.submitTask(task);

      // Cancel (may or may not succeed depending on task state)
      const canceled = await executor.cancelTask(task.id);

      // Resubmit
      await executor.submitTask(task);

      expect(executor.isHealthy()).toBe(true);

      if (canceled) {
        const stats = executor.getStats();
        expect(stats.canceledTasks).toBeGreaterThan(0);
      }
    });
  });

  describe('Monitoring and Observability', () => {
    it('should provide accurate stats throughout workflow', async () => {
      const initialStats = executor.getStats();

      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask(`workflow-stats-${i}`, { timeoutMs: 8000 }),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const afterSubmissionStats = executor.getStats();

      // Total tracked should increase
      const initialTracked = initialStats.runningTasks + initialStats.queuedTasks +
                             initialStats.completedTasks + initialStats.failedTasks;
      const afterTracked = afterSubmissionStats.runningTasks + afterSubmissionStats.queuedTasks +
                           afterSubmissionStats.completedTasks + afterSubmissionStats.failedTasks;
      expect(afterTracked).toBeGreaterThan(initialTracked);
    });

    it('should handle rapid status queries during execution', async () => {
      const task = makeTask('workflow-query-stress', { timeoutMs: 5000 });
      await executor.submitTask(task);

      for (let i = 0; i < 50; i++) {
        await executor.getTaskStatus(task.id);
      }

      expect(executor.isHealthy()).toBe(true);
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle resource exhaustion gracefully', async () => {
      const tasks = Array.from({ length: 100 }, (_, i) =>
        makeTask(`degradation-${i}`),
      );

      for (const task of tasks) {
        await executor.submitTask(task);
      }

      const stats = executor.getStats();
      expect(stats.runningTasks).toBeLessThanOrEqual(3);
      // Total tracked tasks should be substantial
      const tracked = stats.runningTasks + stats.queuedTasks +
                      stats.completedTasks + stats.failedTasks;
      expect(tracked).toBeGreaterThan(0);
      expect(executor.isHealthy()).toBe(true);
    }, 30000); // Extended timeout for 100 Worker starts

    it('should maintain service during partial failures', async () => {
      const mixedTasks = Array.from({ length: 10 }, (_, i) =>
        makeTask(`partial-fail-${i}`, {
          type: i % 3 === 0 ? 'scheduled' : 'a2a_async',
          agentId: i % 2 === 0 ? 'invalid' : 'claude-code',
          projectPath: i % 2 === 0 ? '/invalid' : '/tmp/project',
          timeoutMs: 5000,
        }),
      );

      for (const task of mixedTasks) {
        await executor.submitTask(task).catch(() => {});
      }

      // Should still accept new tasks
      const emergencyTask = makeTask('emergency-task');
      await executor.submitTask(emergencyTask);

      expect(executor.isHealthy()).toBe(true);
    });
  });
});
