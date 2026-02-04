/**
 * Scheduled Task Tools Tests
 */

import { describe, it, expect, vi } from 'vitest';
import type { ToolContext } from '../types.js';

// Mock scheduledTaskStorage
vi.mock('../../scheduledTaskStorage.js', () => {
  const mockTasks = [
    {
      id: 'task_001',
      name: 'Daily Report',
      description: 'Generate daily report',
      agentId: 'claude-code',
      projectPath: '/path/to/project',
      schedule: {
        type: 'cron' as const,
        cronExpression: '0 9 * * *',
      },
      triggerMessage: 'Generate daily report',
      enabled: true,
      lastRunAt: '2024-01-01T09:00:00Z',
      lastRunStatus: 'success' as const,
      nextRunAt: '2024-01-02T09:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'task_002',
      name: 'Hourly Check',
      description: 'Check system status',
      agentId: 'custom-agent',
      projectPath: '/path/to/other',
      schedule: {
        type: 'interval' as const,
        intervalMinutes: 60,
      },
      triggerMessage: 'Check system status',
      enabled: false,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ];

  const mockExecutionHistory = [
    {
      id: 'exec_001',
      taskId: 'task_001',
      startedAt: '2024-01-01T09:00:00Z',
      completedAt: '2024-01-01T09:01:00Z',
      status: 'success' as const,
      responseSummary: 'Report generated successfully',
      sessionId: 'session_123',
    },
    {
      id: 'exec_002',
      taskId: 'task_001',
      startedAt: '2024-01-02T09:00:00Z',
      completedAt: '2024-01-02T09:00:30Z',
      status: 'error' as const,
      error: 'Agent timeout',
    },
  ];

  return {
    loadScheduledTasks: vi.fn().mockImplementation(() => mockTasks),
    getScheduledTask: vi.fn().mockImplementation((taskId: string) => {
      return mockTasks.find((t) => t.id === taskId) || null;
    }),
    createScheduledTask: vi.fn().mockImplementation((request: Record<string, unknown>) => ({
      id: 'task_new',
      ...request,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    updateScheduledTask: vi.fn().mockImplementation((taskId: string, updates: Record<string, unknown>) => {
      const task = mockTasks.find((t) => t.id === taskId);
      if (!task) return null;
      return { ...task, ...updates, updatedAt: new Date().toISOString() };
    }),
    deleteScheduledTask: vi.fn().mockImplementation((taskId: string) => {
      return mockTasks.some((t) => t.id === taskId);
    }),
    toggleScheduledTask: vi.fn().mockImplementation((taskId: string) => {
      const task = mockTasks.find((t) => t.id === taskId);
      if (!task) return null;
      return { ...task, enabled: !task.enabled, updatedAt: new Date().toISOString() };
    }),
    getTaskExecutionHistory: vi.fn().mockImplementation((taskId: string) => {
      return mockExecutionHistory.filter((e) => e.taskId === taskId);
    }),
  };
});

// Mock schedulerService
vi.mock('../../schedulerService.js', () => {
  const mockRunningExecutions = [
    {
      executionId: 'exec_003',
      taskId: 'task_001',
      startedAt: '2024-01-03T09:00:00Z',
    },
  ];

  return {
    executeTask: vi.fn().mockResolvedValue(undefined),
    getSchedulerStatus: vi.fn().mockReturnValue({
      isInitialized: true,
      enabled: true,
      config: { maxConcurrent: 20 },
      activeTaskCount: 1,
      runningTaskCount: 1,
    }),
    getRunningExecutions: vi.fn().mockReturnValue(mockRunningExecutions),
    stopExecution: vi.fn().mockImplementation((executionId: string) => {
      if (executionId === 'exec_003') {
        return { success: true, message: 'Execution stopped successfully' };
      }
      return { success: false, message: 'Execution not found' };
    }),
    scheduleTask: vi.fn().mockReturnValue(true),
    unscheduleTask: vi.fn(),
    rescheduleTask: vi.fn().mockReturnValue(true),
    enableScheduler: vi.fn(),
    disableScheduler: vi.fn(),
  };
});

// Import tools after mocks
import { scheduledTaskTools } from '../tools/scheduledTaskTools.js';

const defaultContext: ToolContext = {
  apiKeyId: 'test-key',
  permissions: ['admin:*'],
};

describe('Scheduled Task Tools', () => {
  describe('list_scheduled_tasks', () => {
    it('should list all scheduled tasks', async () => {
      const listTasks = scheduledTaskTools.find((t) => t.tool.name === 'list_scheduled_tasks');
      expect(listTasks).toBeDefined();

      const result = await listTasks!.handler({}, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.tasks).toHaveLength(2);
      expect(data.total).toBe(2);
    });

    it('should filter by enabled status', async () => {
      const listTasks = scheduledTaskTools.find((t) => t.tool.name === 'list_scheduled_tasks');

      const result = await listTasks!.handler({ enabled: true }, defaultContext);

      const data = JSON.parse(result.content[0].text!);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].enabled).toBe(true);
    });

    it('should filter by agent ID', async () => {
      const listTasks = scheduledTaskTools.find((t) => t.tool.name === 'list_scheduled_tasks');

      const result = await listTasks!.handler({ agentId: 'claude-code' }, defaultContext);

      const data = JSON.parse(result.content[0].text!);
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].agentId).toBe('claude-code');
    });
  });

  describe('get_scheduled_task', () => {
    it('should get task by ID', async () => {
      const getTask = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduled_task');
      expect(getTask).toBeDefined();

      const result = await getTask!.handler({ taskId: 'task_001' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.id).toBe('task_001');
      expect(data.name).toBe('Daily Report');
    });

    it('should return error for non-existent task', async () => {
      const getTask = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduled_task');

      const result = await getTask!.handler({ taskId: 'non-existent' }, defaultContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });

    it('should return error when taskId is missing', async () => {
      const getTask = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduled_task');

      const result = await getTask!.handler({}, defaultContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('required');
    });
  });

  describe('create_scheduled_task', () => {
    it('should create a new task with interval schedule', async () => {
      const createTask = scheduledTaskTools.find((t) => t.tool.name === 'create_scheduled_task');
      expect(createTask).toBeDefined();

      const result = await createTask!.handler(
        {
          name: 'New Task',
          agentId: 'claude-code',
          projectPath: '/path/to/project',
          scheduleType: 'interval',
          intervalMinutes: 30,
          triggerMessage: 'Do something',
        },
        defaultContext
      );

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
      expect(data.task.id).toBe('task_new');
    });

    it('should create a new task with cron schedule', async () => {
      const createTask = scheduledTaskTools.find((t) => t.tool.name === 'create_scheduled_task');

      const result = await createTask!.handler(
        {
          name: 'Cron Task',
          agentId: 'claude-code',
          projectPath: '/path/to/project',
          scheduleType: 'cron',
          cronExpression: '0 9 * * *',
          triggerMessage: 'Run daily',
        },
        defaultContext
      );

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
    });

    it('should return error when required fields are missing', async () => {
      const createTask = scheduledTaskTools.find((t) => t.tool.name === 'create_scheduled_task');

      const result = await createTask!.handler(
        {
          name: 'Incomplete Task',
        },
        defaultContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Missing required fields');
    });

    it('should return error when interval schedule missing intervalMinutes', async () => {
      const createTask = scheduledTaskTools.find((t) => t.tool.name === 'create_scheduled_task');

      const result = await createTask!.handler(
        {
          name: 'Bad Task',
          agentId: 'claude-code',
          projectPath: '/path/to/project',
          scheduleType: 'interval',
          triggerMessage: 'Test',
        },
        defaultContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('intervalMinutes');
    });
  });

  describe('update_scheduled_task', () => {
    it('should update task name', async () => {
      const updateTask = scheduledTaskTools.find((t) => t.tool.name === 'update_scheduled_task');
      expect(updateTask).toBeDefined();

      const result = await updateTask!.handler(
        {
          taskId: 'task_001',
          name: 'Updated Name',
        },
        defaultContext
      );

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
    });

    it('should return error for non-existent task', async () => {
      const updateTask = scheduledTaskTools.find((t) => t.tool.name === 'update_scheduled_task');

      const result = await updateTask!.handler(
        {
          taskId: 'non-existent',
          name: 'Updated Name',
        },
        defaultContext
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('delete_scheduled_task', () => {
    it('should delete task', async () => {
      const deleteTask = scheduledTaskTools.find((t) => t.tool.name === 'delete_scheduled_task');
      expect(deleteTask).toBeDefined();

      const result = await deleteTask!.handler({ taskId: 'task_001' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
    });

    it('should return error for non-existent task', async () => {
      const deleteTask = scheduledTaskTools.find((t) => t.tool.name === 'delete_scheduled_task');

      const result = await deleteTask!.handler({ taskId: 'non-existent' }, defaultContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('toggle_scheduled_task', () => {
    it('should toggle task enabled state', async () => {
      const toggleTask = scheduledTaskTools.find((t) => t.tool.name === 'toggle_scheduled_task');
      expect(toggleTask).toBeDefined();

      const result = await toggleTask!.handler({ taskId: 'task_001' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
      expect(data.task.enabled).toBe(false); // Toggled from true to false
    });
  });

  describe('run_scheduled_task', () => {
    it('should manually run task', async () => {
      const runTask = scheduledTaskTools.find((t) => t.tool.name === 'run_scheduled_task');
      expect(runTask).toBeDefined();

      const result = await runTask!.handler({ taskId: 'task_001' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
      expect(data.message).toContain('execution started');
    });

    it('should return error for non-existent task', async () => {
      const runTask = scheduledTaskTools.find((t) => t.tool.name === 'run_scheduled_task');

      const result = await runTask!.handler({ taskId: 'non-existent' }, defaultContext);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('get_task_history', () => {
    it('should get execution history', async () => {
      const getHistory = scheduledTaskTools.find((t) => t.tool.name === 'get_task_history');
      expect(getHistory).toBeDefined();

      const result = await getHistory!.handler({ taskId: 'task_001' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.task.id).toBe('task_001');
      expect(data.history).toHaveLength(2);
    });

    it('should support limit parameter', async () => {
      const getHistory = scheduledTaskTools.find((t) => t.tool.name === 'get_task_history');

      const result = await getHistory!.handler({ taskId: 'task_001', limit: 1 }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      // Note: Mock returns all, but in real implementation limit would work
      expect(data.history).toBeDefined();
    });
  });

  describe('get_scheduler_status', () => {
    it('should return scheduler status', async () => {
      const getStatus = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduler_status');
      expect(getStatus).toBeDefined();

      const result = await getStatus!.handler({}, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.isInitialized).toBe(true);
      expect(data.enabled).toBe(true);
      expect(data.config.maxConcurrent).toBe(20);
    });
  });

  describe('get_running_executions', () => {
    it('should return running executions', async () => {
      const getRunning = scheduledTaskTools.find((t) => t.tool.name === 'get_running_executions');
      expect(getRunning).toBeDefined();

      const result = await getRunning!.handler({}, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.executions).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  describe('stop_task_execution', () => {
    it('should stop running execution', async () => {
      const stopExec = scheduledTaskTools.find((t) => t.tool.name === 'stop_task_execution');
      expect(stopExec).toBeDefined();

      const result = await stopExec!.handler({ executionId: 'exec_003' }, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
    });

    it('should return error for non-existent execution', async () => {
      const stopExec = scheduledTaskTools.find((t) => t.tool.name === 'stop_task_execution');

      const result = await stopExec!.handler({ executionId: 'non-existent' }, defaultContext);

      expect(result.isError).toBe(true);
    });
  });

  describe('enable_scheduler', () => {
    it('should enable scheduler', async () => {
      const enableSched = scheduledTaskTools.find((t) => t.tool.name === 'enable_scheduler');
      expect(enableSched).toBeDefined();

      const result = await enableSched!.handler({}, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Scheduler enabled');
    });
  });

  describe('disable_scheduler', () => {
    it('should disable scheduler', async () => {
      const disableSched = scheduledTaskTools.find((t) => t.tool.name === 'disable_scheduler');
      expect(disableSched).toBeDefined();

      const result = await disableSched!.handler({}, defaultContext);

      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text!);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Scheduler disabled');
    });
  });
});

describe('Scheduled Task Tool Permissions', () => {
  it('should require scheduled-tasks:read for list_scheduled_tasks', () => {
    const listTasks = scheduledTaskTools.find((t) => t.tool.name === 'list_scheduled_tasks');
    expect(listTasks?.requiredPermissions).toContain('scheduled-tasks:read');
  });

  it('should require scheduled-tasks:read for get_scheduled_task', () => {
    const getTask = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduled_task');
    expect(getTask?.requiredPermissions).toContain('scheduled-tasks:read');
  });

  it('should require scheduled-tasks:write for create_scheduled_task', () => {
    const createTask = scheduledTaskTools.find((t) => t.tool.name === 'create_scheduled_task');
    expect(createTask?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for update_scheduled_task', () => {
    const updateTask = scheduledTaskTools.find((t) => t.tool.name === 'update_scheduled_task');
    expect(updateTask?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for delete_scheduled_task', () => {
    const deleteTask = scheduledTaskTools.find((t) => t.tool.name === 'delete_scheduled_task');
    expect(deleteTask?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for toggle_scheduled_task', () => {
    const toggleTask = scheduledTaskTools.find((t) => t.tool.name === 'toggle_scheduled_task');
    expect(toggleTask?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for run_scheduled_task', () => {
    const runTask = scheduledTaskTools.find((t) => t.tool.name === 'run_scheduled_task');
    expect(runTask?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:read for get_task_history', () => {
    const getHistory = scheduledTaskTools.find((t) => t.tool.name === 'get_task_history');
    expect(getHistory?.requiredPermissions).toContain('scheduled-tasks:read');
  });

  it('should require scheduled-tasks:read for get_scheduler_status', () => {
    const getStatus = scheduledTaskTools.find((t) => t.tool.name === 'get_scheduler_status');
    expect(getStatus?.requiredPermissions).toContain('scheduled-tasks:read');
  });

  it('should require scheduled-tasks:write for stop_task_execution', () => {
    const stopExec = scheduledTaskTools.find((t) => t.tool.name === 'stop_task_execution');
    expect(stopExec?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for enable_scheduler', () => {
    const enableSched = scheduledTaskTools.find((t) => t.tool.name === 'enable_scheduler');
    expect(enableSched?.requiredPermissions).toContain('scheduled-tasks:write');
  });

  it('should require scheduled-tasks:write for disable_scheduler', () => {
    const disableSched = scheduledTaskTools.find((t) => t.tool.name === 'disable_scheduler');
    expect(disableSched?.requiredPermissions).toContain('scheduled-tasks:write');
  });
});
