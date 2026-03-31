/**
 * A2A Task Cleanup Service
 *
 * Handles cleanup of orphaned tasks on server startup.
 * Orphaned tasks are tasks with status='running' that were left
 * in that state due to server crash or restart.
 *
 * This service scans all registered projects' task directories and marks
 * any running tasks as 'failed' with an appropriate error message.
 */

import fs from 'fs/promises';
import { taskManager } from './taskManager.js';
import { listAgentMappings } from './agentMappingService.js';
import { getProjectTasksDir } from '../../config/paths.js';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all unique working directories from agent mappings
 */
async function getAllWorkingDirectories(): Promise<string[]> {
  try {
    const mappings = await listAgentMappings();
    // Extract unique working directories
    const workingDirs = new Set<string>();
    for (const mapping of mappings) {
      if (mapping.workingDirectory) {
        workingDirs.add(mapping.workingDirectory);
      }
    }
    return Array.from(workingDirs);
  } catch (error: any) {
    console.warn('[TaskCleanup] Failed to get agent mappings:', error.message);
    return [];
  }
}

/**
 * Check if a task directory exists for a project
 */
async function taskDirectoryExists(workingDirectory: string): Promise<boolean> {
  try {
    const tasksDir = getProjectTasksDir(workingDirectory);
    await fs.access(tasksDir);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Main Cleanup Function
// ============================================================================

/**
 * Clean up orphaned tasks across all projects
 *
 * Scans all registered projects' .a2a/tasks/ directories and marks any tasks
 * with status='running' or 'pending' as 'failed' (indicating they were orphaned
 * due to server restart — no executor is tracking them anymore).
 *
 * @returns Count of tasks cleaned up
 */
export async function cleanupOrphanedTasks(): Promise<number> {
  console.info('[TaskCleanup] Starting orphaned task cleanup...');

  let totalCleaned = 0;
  const startTime = Date.now();

  try {
    // Get all unique working directories from agent mappings
    const workingDirectories = await getAllWorkingDirectories();

    console.info(`[TaskCleanup] Scanning ${workingDirectories.length} project directories...`);

    // Process each project
    for (const workingDirectory of workingDirectories) {
      const hasTasksDir = await taskDirectoryExists(workingDirectory);

      if (!hasTasksDir) {
        continue;
      }

      try {
        // Collect both running and pending tasks — after a restart, neither
        // has an executor/worker backing them, so both are orphaned.
        const runningTasks = await taskManager.listTasks(workingDirectory, 'running');
        const pendingTasks = await taskManager.listTasks(workingDirectory, 'pending');
        const orphanedTasks = [...runningTasks, ...pendingTasks];

        if (orphanedTasks.length === 0) {
          continue;
        }

        console.info(
          `[TaskCleanup] Found ${orphanedTasks.length} orphaned tasks in ${workingDirectory}` +
          ` (${runningTasks.length} running, ${pendingTasks.length} pending)`
        );

        for (const task of orphanedTasks) {
          try {
            // pending tasks must transition through running first
            if (task.status === 'pending') {
              await taskManager.updateTaskStatus(workingDirectory, task.id, 'running', {
                startedAt: task.createdAt,
              });
            }

            await taskManager.updateTaskStatus(workingDirectory, task.id, 'failed', {
              errorDetails: {
                message: `Task was orphaned due to server restart (was ${task.status})`,
                code: 'TASK_ORPHANED',
              },
              completedAt: new Date().toISOString(),
            });

            totalCleaned++;

            console.info(`[TaskCleanup] Cleaned orphaned ${task.status} task: ${task.id}`);
          } catch (error) {
            console.error(`[TaskCleanup] Failed to clean task ${task.id}:`, error);
          }
        }
      } catch (error) {
        console.error(`[TaskCleanup] Error processing ${workingDirectory}:`, error);
      }
    }

    const duration = Date.now() - startTime;

    console.info(`[TaskCleanup] Cleanup complete. Cleaned ${totalCleaned} tasks in ${duration}ms`);

    return totalCleaned;
  } catch (error) {
    console.error('[TaskCleanup] Fatal error during cleanup:', error);
    throw error;
  }
}

/**
 * Clean up timed-out tasks across all projects
 *
 * Scans all registered projects and marks tasks that have exceeded their timeout
 * as 'failed'. This is called periodically by the timeout monitor.
 *
 * @returns Count of tasks marked as timed out
 */
export async function cleanupTimedOutTasks(): Promise<number> {
  let totalTimedOut = 0;
  const now = Date.now();

  try {
    // Get all unique working directories from agent mappings
    const workingDirectories = await getAllWorkingDirectories();

    // Process each project
    for (const workingDirectory of workingDirectories) {
      // Check if project has tasks directory
      const hasTasksDir = await taskDirectoryExists(workingDirectory);

      if (!hasTasksDir) {
        continue;
      }

      try {
        // Get all running tasks for this project
        const runningTasks = await taskManager.listTasks(workingDirectory, 'running');

        // Check each task for timeout
        for (const task of runningTasks) {
          const createdTime = new Date(task.createdAt).getTime();
          const elapsedMs = now - createdTime;

          if (elapsedMs > task.timeoutMs) {
            // Task has timed out
            try {
              await taskManager.updateTaskStatus(workingDirectory, task.id, 'failed', {
                errorDetails: {
                  message: `Task timed out after ${task.timeoutMs}ms (elapsed: ${elapsedMs}ms)`,
                  code: 'TASK_TIMEOUT',
                },
                completedAt: new Date().toISOString(),
              });

              totalTimedOut++;

              console.warn(`[TaskCleanup] Task timed out: ${task.id} (elapsed: ${elapsedMs}ms)`);
            } catch (error) {
              console.error(`[TaskCleanup] Failed to mark task ${task.id} as timed out:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`[TaskCleanup] Error checking timeouts for ${workingDirectory}:`, error);
      }
    }

    if (totalTimedOut > 0) {
      console.info(`[TaskCleanup] Marked ${totalTimedOut} tasks as timed out`);
    }

    return totalTimedOut;
  } catch (error) {
    console.error('[TaskCleanup] Fatal error during timeout cleanup:', error);
    throw error;
  }
}
