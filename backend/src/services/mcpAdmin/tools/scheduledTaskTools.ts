/**
 * Scheduled Task Management Tools
 *
 * MCP tools for managing scheduled tasks in AgentStudio.
 * These tools provide full CRUD operations plus execution control.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import {
  loadScheduledTasks,
  getScheduledTask,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
  getTaskExecutionHistory,
} from '../../scheduledTaskStorage.js';
import {
  executeTask,
  getSchedulerStatus,
  getRunningExecutions,
  stopExecution,
  scheduleTask,
  unscheduleTask,
  rescheduleTask,
  enableScheduler,
  disableScheduler,
} from '../../schedulerService.js';
import type {
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  TaskSchedule,
} from '../../../types/scheduledTasks.js';

/**
 * List all scheduled tasks
 */
export const listScheduledTasksTool: ToolDefinition = {
  tool: {
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Filter by enabled status (optional)',
        },
        agentId: {
          type: 'string',
          description: 'Filter by agent ID (optional)',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      let tasks = loadScheduledTasks();

      // Filter by enabled status
      if (params.enabled !== undefined) {
        tasks = tasks.filter((t) => t.enabled === params.enabled);
      }

      // Filter by agent ID
      if (params.agentId) {
        tasks = tasks.filter((t) => t.agentId === params.agentId);
      }

      const taskList = tasks.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        agentId: t.agentId,
        projectPath: t.projectPath,
        schedule: t.schedule,
        enabled: t.enabled,
        lastRunAt: t.lastRunAt,
        lastRunStatus: t.lastRunStatus,
        nextRunAt: t.nextRunAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                tasks: taskList,
                total: taskList.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing scheduled tasks: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:read'],
};

/**
 * Get scheduled task details
 */
export const getScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'get_scheduled_task',
    description: 'Get detailed information about a specific scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      const task = getScheduledTask(taskId);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(task, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:read'],
};

/**
 * Create a new scheduled task
 */
export const createScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'create_scheduled_task',
    description: 'Create a new scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Task name (1-100 characters)',
        },
        description: {
          type: 'string',
          description: 'Task description (optional, max 500 characters)',
        },
        agentId: {
          type: 'string',
          description: 'Target agent ID to execute',
        },
        projectPath: {
          type: 'string',
          description: 'Project path for agent execution context',
        },
        scheduleType: {
          type: 'string',
          enum: ['interval', 'cron', 'once'],
          description: 'Schedule type: interval (every N minutes), cron (cron expression), once (one-time)',
        },
        intervalMinutes: {
          type: 'number',
          description: 'Interval in minutes (for interval type)',
        },
        cronExpression: {
          type: 'string',
          description: 'Cron expression (for cron type), e.g., "0 9 * * *" for daily at 9am',
        },
        executeAt: {
          type: 'string',
          description: 'ISO 8601 timestamp for one-time execution (for once type)',
        },
        triggerMessage: {
          type: 'string',
          description: 'Message to send to the agent when triggered (1-10000 characters)',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the task is enabled (default: true)',
        },
        modelId: {
          type: 'string',
          description: 'Model ID override (optional), e.g., "sonnet", "opus"',
        },
        versionId: {
          type: 'string',
          description: 'Claude version/supplier ID override (optional)',
        },
      },
      required: ['name', 'agentId', 'projectPath', 'scheduleType', 'triggerMessage'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const description = params.description as string | undefined;
      const agentId = params.agentId as string;
      const projectPath = params.projectPath as string;
      const scheduleType = params.scheduleType as 'interval' | 'cron' | 'once';
      const intervalMinutes = params.intervalMinutes as number | undefined;
      const cronExpression = params.cronExpression as string | undefined;
      const executeAt = params.executeAt as string | undefined;
      const triggerMessage = params.triggerMessage as string;
      const enabled = (params.enabled as boolean) ?? true;
      const modelId = params.modelId as string | undefined;
      const versionId = params.versionId as string | undefined;

      // Validate required fields
      if (!name || !agentId || !projectPath || !scheduleType || !triggerMessage) {
        return {
          content: [{ type: 'text', text: 'Missing required fields: name, agentId, projectPath, scheduleType, triggerMessage' }],
          isError: true,
        };
      }

      // Build schedule configuration
      const schedule: TaskSchedule = { type: scheduleType };

      if (scheduleType === 'interval') {
        if (!intervalMinutes || intervalMinutes < 1) {
          return {
            content: [{ type: 'text', text: 'intervalMinutes is required and must be at least 1 for interval schedule' }],
            isError: true,
          };
        }
        schedule.intervalMinutes = intervalMinutes;
      } else if (scheduleType === 'cron') {
        if (!cronExpression) {
          return {
            content: [{ type: 'text', text: 'cronExpression is required for cron schedule' }],
            isError: true,
          };
        }
        schedule.cronExpression = cronExpression;
      } else if (scheduleType === 'once') {
        if (!executeAt) {
          return {
            content: [{ type: 'text', text: 'executeAt is required for once schedule' }],
            isError: true,
          };
        }
        schedule.executeAt = executeAt;
      }

      // Build request
      const request: CreateScheduledTaskRequest = {
        name,
        description,
        agentId,
        projectPath,
        schedule,
        triggerMessage,
        enabled,
      };

      // Add model override if specified
      if (modelId || versionId) {
        request.modelOverride = {};
        if (modelId) request.modelOverride.modelId = modelId;
        if (versionId) request.modelOverride.versionId = versionId;
      }

      // Create the task
      const task = createScheduledTask(request);

      // Schedule the task if enabled
      if (task.enabled) {
        scheduleTask(task);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task: {
                  id: task.id,
                  name: task.name,
                  enabled: task.enabled,
                  nextRunAt: task.nextRunAt,
                  createdAt: task.createdAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Update a scheduled task
 */
export const updateScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'update_scheduled_task',
    description: 'Update an existing scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to update',
        },
        name: {
          type: 'string',
          description: 'Task name (optional)',
        },
        description: {
          type: 'string',
          description: 'Task description (optional)',
        },
        agentId: {
          type: 'string',
          description: 'Target agent ID (optional)',
        },
        projectPath: {
          type: 'string',
          description: 'Project path (optional)',
        },
        scheduleType: {
          type: 'string',
          enum: ['interval', 'cron', 'once'],
          description: 'Schedule type (optional)',
        },
        intervalMinutes: {
          type: 'number',
          description: 'Interval in minutes (optional)',
        },
        cronExpression: {
          type: 'string',
          description: 'Cron expression (optional)',
        },
        executeAt: {
          type: 'string',
          description: 'Execute at timestamp (optional)',
        },
        triggerMessage: {
          type: 'string',
          description: 'Trigger message (optional)',
        },
        enabled: {
          type: 'boolean',
          description: 'Enabled status (optional)',
        },
        modelId: {
          type: 'string',
          description: 'Model ID override (optional)',
        },
        versionId: {
          type: 'string',
          description: 'Claude version ID override (optional)',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      const existingTask = getScheduledTask(taskId);
      if (!existingTask) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      // Build update request
      const updates: UpdateScheduledTaskRequest = {};

      if (params.name !== undefined) updates.name = params.name as string;
      if (params.description !== undefined) updates.description = params.description as string;
      if (params.agentId !== undefined) updates.agentId = params.agentId as string;
      if (params.projectPath !== undefined) updates.projectPath = params.projectPath as string;
      if (params.triggerMessage !== undefined) updates.triggerMessage = params.triggerMessage as string;
      if (params.enabled !== undefined) updates.enabled = params.enabled as boolean;

      // Handle schedule updates
      if (params.scheduleType !== undefined) {
        const scheduleType = params.scheduleType as 'interval' | 'cron' | 'once';
        const schedule: TaskSchedule = { type: scheduleType };

        if (scheduleType === 'interval') {
          schedule.intervalMinutes = (params.intervalMinutes as number) || existingTask.schedule.intervalMinutes;
        } else if (scheduleType === 'cron') {
          schedule.cronExpression = (params.cronExpression as string) || existingTask.schedule.cronExpression;
        } else if (scheduleType === 'once') {
          schedule.executeAt = (params.executeAt as string) || existingTask.schedule.executeAt;
        }

        updates.schedule = schedule;
      }

      // Handle model override updates
      if (params.modelId !== undefined || params.versionId !== undefined) {
        updates.modelOverride = existingTask.modelOverride || {};
        if (params.modelId !== undefined) updates.modelOverride.modelId = params.modelId as string;
        if (params.versionId !== undefined) updates.modelOverride.versionId = params.versionId as string;
      }

      // Update the task
      const updatedTask = updateScheduledTask(taskId, updates);

      if (!updatedTask) {
        return {
          content: [{ type: 'text', text: `Failed to update task: ${taskId}` }],
          isError: true,
        };
      }

      // Reschedule the task
      rescheduleTask(taskId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task: {
                  id: updatedTask.id,
                  name: updatedTask.name,
                  enabled: updatedTask.enabled,
                  nextRunAt: updatedTask.nextRunAt,
                  updatedAt: updatedTask.updatedAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Delete a scheduled task
 */
export const deleteScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to delete',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      // Unschedule first
      unscheduleTask(taskId);

      // Delete the task
      const deleted = deleteScheduledTask(taskId);

      if (!deleted) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Task ${taskId} deleted successfully`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Toggle scheduled task enabled state
 */
export const toggleScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'toggle_scheduled_task',
    description: 'Toggle the enabled state of a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to toggle',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      const task = toggleScheduledTask(taskId);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      // Update scheduling based on new state
      if (task.enabled) {
        scheduleTask(task);
      } else {
        unscheduleTask(taskId);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task: {
                  id: task.id,
                  name: task.name,
                  enabled: task.enabled,
                  nextRunAt: task.nextRunAt,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error toggling scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Manually run a scheduled task
 */
export const runScheduledTaskTool: ToolDefinition = {
  tool: {
    name: 'run_scheduled_task',
    description: 'Manually trigger execution of a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to execute',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      const task = getScheduledTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      // Execute the task (async, returns immediately after submission)
      executeTask(taskId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: `Task ${taskId} (${task.name}) execution started`,
                task: {
                  id: task.id,
                  name: task.name,
                  agentId: task.agentId,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error running scheduled task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Get task execution history
 */
export const getTaskHistoryTool: ToolDefinition = {
  tool: {
    name: 'get_task_history',
    description: 'Get execution history for a scheduled task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default: 20, max: 100)',
        },
      },
      required: ['taskId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const taskId = params.taskId as string;
      const limit = Math.min((params.limit as number) || 20, 100);

      if (!taskId) {
        return {
          content: [{ type: 'text', text: 'Task ID is required' }],
          isError: true,
        };
      }

      const task = getScheduledTask(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${taskId}` }],
          isError: true,
        };
      }

      const history = getTaskExecutionHistory(taskId, limit);

      // Simplify history output (exclude full logs by default)
      const simplifiedHistory = history.map((h) => ({
        id: h.id,
        startedAt: h.startedAt,
        completedAt: h.completedAt,
        status: h.status,
        error: h.error,
        responseSummary: h.responseSummary,
        sessionId: h.sessionId,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                task: {
                  id: task.id,
                  name: task.name,
                },
                history: simplifiedHistory,
                total: simplifiedHistory.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting task history: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:read'],
};

/**
 * Get scheduler status
 */
export const getSchedulerStatusTool: ToolDefinition = {
  tool: {
    name: 'get_scheduler_status',
    description: 'Get the current status of the task scheduler',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const status = getSchedulerStatus();
      const runningExecutions = getRunningExecutions();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...status,
                runningExecutions,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting scheduler status: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:read'],
};

/**
 * Get running executions
 */
export const getRunningExecutionsTool: ToolDefinition = {
  tool: {
    name: 'get_running_executions',
    description: 'Get list of currently running task executions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const executions = getRunningExecutions();

      // Enrich with task details
      const enrichedExecutions = executions.map((exec) => {
        const task = getScheduledTask(exec.taskId);
        return {
          ...exec,
          taskName: task?.name,
          agentId: task?.agentId,
        };
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                executions: enrichedExecutions,
                total: enrichedExecutions.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting running executions: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:read'],
};

/**
 * Stop a running task execution
 */
export const stopTaskExecutionTool: ToolDefinition = {
  tool: {
    name: 'stop_task_execution',
    description: 'Stop a currently running task execution',
    inputSchema: {
      type: 'object',
      properties: {
        executionId: {
          type: 'string',
          description: 'Execution ID to stop',
        },
      },
      required: ['executionId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const executionId = params.executionId as string;

      if (!executionId) {
        return {
          content: [{ type: 'text', text: 'Execution ID is required' }],
          isError: true,
        };
      }

      const result = stopExecution(executionId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: !result.success,
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error stopping execution: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Enable the scheduler
 */
export const enableSchedulerTool: ToolDefinition = {
  tool: {
    name: 'enable_scheduler',
    description: 'Enable the task scheduler to start executing scheduled tasks',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      enableScheduler();
      const status = getSchedulerStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Scheduler enabled',
                status,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error enabling scheduler: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * Disable the scheduler
 */
export const disableSchedulerTool: ToolDefinition = {
  tool: {
    name: 'disable_scheduler',
    description: 'Disable the task scheduler to stop executing scheduled tasks',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      disableScheduler();
      const status = getSchedulerStatus();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                message: 'Scheduler disabled',
                status,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error disabling scheduler: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['scheduled-tasks:write'],
};

/**
 * All scheduled task tools
 */
export const scheduledTaskTools: ToolDefinition[] = [
  listScheduledTasksTool,
  getScheduledTaskTool,
  createScheduledTaskTool,
  updateScheduledTaskTool,
  deleteScheduledTaskTool,
  toggleScheduledTaskTool,
  runScheduledTaskTool,
  getTaskHistoryTool,
  getSchedulerStatusTool,
  getRunningExecutionsTool,
  stopTaskExecutionTool,
  enableSchedulerTool,
  disableSchedulerTool,
];
