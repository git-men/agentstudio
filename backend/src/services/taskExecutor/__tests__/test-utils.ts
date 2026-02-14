/**
 * Test utilities for TaskExecutor tests.
 *
 * Provides polling-based helpers to replace fragile fixed-delay assertions.
 */

import type { BuiltinTaskExecutor } from '../BuiltinExecutor.js';
import type { TaskExecutorStats } from '../types.js';

/**
 * Poll a condition until it becomes true, with timeout.
 *
 * Replaces fragile `setTimeout(resolve, N)` patterns with condition-based waiting.
 *
 * @example
 * // Wait until at least one task has failed
 * await waitFor(() => executor.getStats().failedTasks > 0, { timeoutMs: 5000 });
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const { timeoutMs = 5000, intervalMs = 50, message = 'Condition not met' } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await condition();
    if (result) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${message}`);
}

/**
 * Wait until a certain number of tasks have reached a terminal state (completed + failed + canceled).
 */
export async function waitForTasksSettled(
  executor: BuiltinTaskExecutor,
  count: number,
  options: { timeoutMs?: number } = {},
): Promise<TaskExecutorStats> {
  const { timeoutMs = 10000 } = options;
  await waitFor(
    () => {
      const s = executor.getStats();
      return s.completedTasks + s.failedTasks + s.canceledTasks >= count;
    },
    { timeoutMs, message: `Expected ${count} tasks to settle` },
  );
  return executor.getStats();
}

/**
 * Wait until all running and queued tasks are drained (= 0).
 */
export async function waitForDrain(
  executor: BuiltinTaskExecutor,
  options: { timeoutMs?: number } = {},
): Promise<TaskExecutorStats> {
  const { timeoutMs = 15000 } = options;
  await waitFor(
    () => {
      const s = executor.getStats();
      return s.runningTasks === 0 && s.queuedTasks === 0;
    },
    { timeoutMs, message: 'Expected all tasks to drain' },
  );
  return executor.getStats();
}
