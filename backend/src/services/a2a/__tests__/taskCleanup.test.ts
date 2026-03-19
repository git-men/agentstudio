/**
 * Unit tests for taskCleanup.ts
 *
 * Tests orphaned task cleanup on server startup, including:
 * - Running tasks marked as failed (existing behavior)
 * - Pending tasks marked as failed (new behavior)
 * - Correct state transitions (pending → running → failed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { TaskManager } from '../taskManager';

// Create a real TaskManager for file-based tests
const taskManager = new TaskManager();

// Use unique temp dirs for test isolation
const TEST_BASE = path.join(os.tmpdir(), 'a2a-cleanup-test');

// Mock agentMappingService to return our test directories
let testWorkingDirs: string[] = [];

vi.mock('../agentMappingService.js', () => ({
  listAgentMappings: vi.fn(() =>
    Promise.resolve(
      testWorkingDirs.map(dir => ({ workingDirectory: dir }))
    )
  ),
}));

// We must import AFTER vi.mock so the mock is active
import { cleanupOrphanedTasks, cleanupTimedOutTasks } from '../taskCleanup';

describe('taskCleanup', () => {
  let workDir1: string;
  let workDir2: string;

  beforeEach(async () => {
    // Create unique working directories for each test
    const testId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    workDir1 = path.join(TEST_BASE, `project-${testId}-1`);
    workDir2 = path.join(TEST_BASE, `project-${testId}-2`);
    testWorkingDirs = [workDir1, workDir2];
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_BASE, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // cleanupOrphanedTasks
  // =========================================================================

  describe('cleanupOrphanedTasks', () => {
    it('should clean up orphaned running tasks (existing behavior)', async () => {
      // Create a task and transition it to running
      const task = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'running task' },
      });
      await taskManager.updateTaskStatus(workDir1, task.id, 'running', {
        startedAt: new Date().toISOString(),
      });

      // Verify it's running
      const before = await taskManager.getTask(workDir1, task.id);
      expect(before?.status).toBe('running');

      // Run cleanup
      const cleaned = await cleanupOrphanedTasks();

      // Verify it's now failed
      const after = await taskManager.getTask(workDir1, task.id);
      expect(after?.status).toBe('failed');
      expect(after?.errorDetails?.code).toBe('TASK_ORPHANED');
      expect(after?.errorDetails?.message).toContain('was running');
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });

    it('should clean up orphaned pending tasks (new behavior)', async () => {
      // Create a task that stays in pending state
      const task = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'pending task' },
      });

      // Verify it's pending
      const before = await taskManager.getTask(workDir1, task.id);
      expect(before?.status).toBe('pending');

      // Run cleanup
      const cleaned = await cleanupOrphanedTasks();

      // Verify it's now failed (went through pending → running → failed)
      const after = await taskManager.getTask(workDir1, task.id);
      expect(after?.status).toBe('failed');
      expect(after?.errorDetails?.code).toBe('TASK_ORPHANED');
      expect(after?.errorDetails?.message).toContain('was pending');
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });

    it('should clean up both pending and running tasks in the same project', async () => {
      // Create one pending and one running task
      const pendingTask = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'pending' },
      });

      const runningTask = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'running' },
      });
      await taskManager.updateTaskStatus(workDir1, runningTask.id, 'running', {
        startedAt: new Date().toISOString(),
      });

      const cleaned = await cleanupOrphanedTasks();

      const afterPending = await taskManager.getTask(workDir1, pendingTask.id);
      const afterRunning = await taskManager.getTask(workDir1, runningTask.id);

      expect(afterPending?.status).toBe('failed');
      expect(afterRunning?.status).toBe('failed');
      expect(cleaned).toBe(2);
    });

    it('should clean up tasks across multiple projects', async () => {
      // Create tasks in two different projects
      const task1 = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'project 1 pending' },
      });

      const task2 = await taskManager.createTask({
        workingDirectory: workDir2,
        projectId: 'proj-2',
        agentId: 'agent-2',
        a2aAgentId: 'a2a-agent-2',
        input: { message: 'project 2 running' },
      });
      await taskManager.updateTaskStatus(workDir2, task2.id, 'running', {
        startedAt: new Date().toISOString(),
      });

      const cleaned = await cleanupOrphanedTasks();

      const after1 = await taskManager.getTask(workDir1, task1.id);
      const after2 = await taskManager.getTask(workDir2, task2.id);

      expect(after1?.status).toBe('failed');
      expect(after2?.status).toBe('failed');
      expect(cleaned).toBe(2);
    });

    it('should NOT touch completed or failed tasks', async () => {
      // Create a completed task
      const completedTask = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'completed task' },
      });
      await taskManager.updateTaskStatus(workDir1, completedTask.id, 'running');
      await taskManager.updateTaskStatus(workDir1, completedTask.id, 'completed', {
        completedAt: new Date().toISOString(),
      });

      // Create a failed task
      const failedTask = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'failed task' },
      });
      await taskManager.updateTaskStatus(workDir1, failedTask.id, 'running');
      await taskManager.updateTaskStatus(workDir1, failedTask.id, 'failed', {
        errorDetails: { message: 'original error', code: 'ORIG' },
      });

      const cleaned = await cleanupOrphanedTasks();

      // Terminal-state tasks should be untouched
      const afterCompleted = await taskManager.getTask(workDir1, completedTask.id);
      const afterFailed = await taskManager.getTask(workDir1, failedTask.id);

      expect(afterCompleted?.status).toBe('completed');
      expect(afterFailed?.status).toBe('failed');
      expect(afterFailed?.errorDetails?.code).toBe('ORIG');
      expect(cleaned).toBe(0);
    });

    it('should return 0 when no projects have tasks directories', async () => {
      // workDir1/workDir2 don't have .a2a/tasks/ yet
      testWorkingDirs = ['/tmp/nonexistent-cleanup-test-dir'];

      const cleaned = await cleanupOrphanedTasks();
      expect(cleaned).toBe(0);
    });

    it('should return 0 when all tasks are in terminal states', async () => {
      const task = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'canceled task' },
      });
      await taskManager.updateTaskStatus(workDir1, task.id, 'canceled', {
        completedAt: new Date().toISOString(),
      });

      const cleaned = await cleanupOrphanedTasks();
      expect(cleaned).toBe(0);
    });
  });

  // =========================================================================
  // cleanupTimedOutTasks — ensure it still works correctly with pending→running flow
  // =========================================================================

  describe('cleanupTimedOutTasks', () => {
    it('should mark timed-out running tasks as failed', async () => {
      // Create a task with a very short timeout
      const task = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'will timeout' },
        timeoutMs: 1, // 1ms timeout
      });
      await taskManager.updateTaskStatus(workDir1, task.id, 'running', {
        startedAt: new Date().toISOString(),
      });

      // Wait a bit so it's definitely timed out
      await new Promise(r => setTimeout(r, 50));

      const timedOut = await cleanupTimedOutTasks();

      const after = await taskManager.getTask(workDir1, task.id);
      expect(after?.status).toBe('failed');
      expect(after?.errorDetails?.code).toBe('TASK_TIMEOUT');
      expect(timedOut).toBe(1);
    });

    it('should not touch running tasks that have not timed out', async () => {
      const task = await taskManager.createTask({
        workingDirectory: workDir1,
        projectId: 'proj-1',
        agentId: 'agent-1',
        a2aAgentId: 'a2a-agent-1',
        input: { message: 'not timed out' },
        timeoutMs: 3600000, // 1 hour
      });
      await taskManager.updateTaskStatus(workDir1, task.id, 'running', {
        startedAt: new Date().toISOString(),
      });

      const timedOut = await cleanupTimedOutTasks();

      const after = await taskManager.getTask(workDir1, task.id);
      expect(after?.status).toBe('running');
      expect(timedOut).toBe(0);
    });
  });
});
