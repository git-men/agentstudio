/**
 * Scheduled Tasks Types (Frontend)
 * 
 * Type definitions for scheduled task management.
 */

/**
 * Schedule configuration for a task
 */
export interface TaskSchedule {
  type: 'interval' | 'cron' | 'once';
  intervalMinutes?: number;
  cronExpression?: string;
  /** ISO 8601 timestamp for one-time execution (for 'once' type) */
  executeAt?: string;
  /** IANA timezone for cron scheduling (e.g., 'Asia/Shanghai'). Defaults to 'Asia/Shanghai'. */
  timezone?: string;
}

/**
 * Status of a scheduled task execution
 */
export type TaskRunStatus = 'running' | 'success' | 'error' | 'stopped';

/**
 * Notification strategy for scheduled task completion
 */
export type NotificationStrategy = 'always' | 'on_success' | 'on_error' | 'agent_decided';

/**
 * Notification delivery channel
 */
export interface NotificationChannel {
  bot_key: string;
  chat_id: string;
  chat_name?: string;
}

/**
 * Notification configuration embedded in a scheduled task
 */
export interface NotificationConfig {
  enabled: boolean;
  strategy: NotificationStrategy;
  channels?: NotificationChannel[];
}

/**
 * Model override configuration for scheduled tasks
 */
export interface ModelOverride {
  /** Claude version/supplier ID to use (optional, uses agent default if not specified) */
  versionId?: string;
  /** Model ID to use (e.g., 'sonnet', 'opus') */
  modelId?: string;
}

/**
 * Scheduled task configuration
 */
export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  agentId: string;
  projectPath: string;
  schedule: TaskSchedule;
  triggerMessage: string;
  enabled: boolean;
  /** Model override configuration (optional) */
  modelOverride?: ModelOverride;
  /** Optional notification configuration */
  notification?: NotificationConfig;
  /** Task execution timeout in milliseconds (10s ~ 2h). Defaults to 30 minutes if not set. */
  timeoutMs?: number;
  /** Maximum number of agent turns. Defaults to agent config if not set. */
  maxTurns?: number;
  lastRunAt?: string;
  lastRunStatus?: TaskRunStatus;
  lastRunError?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Log entry for task execution
 */
export interface ExecutionLogEntry {
  timestamp: string;
  level: 'info' | 'debug' | 'warn' | 'error';
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Task execution history record
 */
export interface TaskExecution {
  id: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  status: TaskRunStatus;
  error?: string;
  errorStack?: string;
  responseSummary?: string;
  sessionId?: string;
  logs?: ExecutionLogEntry[];
  /** Agent ID used for this execution (for "continue chat" functionality) */
  agentId?: string;
  /** Project path used for this execution (for "continue chat" functionality) */
  projectPath?: string;
}

/**
 * Request body for creating a new scheduled task
 */
export interface CreateScheduledTaskRequest {
  name: string;
  description?: string;
  agentId: string;
  projectPath: string;
  schedule: TaskSchedule;
  triggerMessage: string;
  enabled?: boolean;
  modelOverride?: ModelOverride;
  notification?: NotificationConfig;
  /** Task execution timeout in milliseconds (10s ~ 2h). Defaults to 30 minutes if not set. */
  timeoutMs?: number;
  /** Maximum number of agent turns. Defaults to agent config if not set. */
  maxTurns?: number;
}

/**
 * Request body for updating a scheduled task
 */
export interface UpdateScheduledTaskRequest {
  name?: string;
  description?: string | null;
  agentId?: string;
  projectPath?: string;
  schedule?: TaskSchedule;
  triggerMessage?: string;
  enabled?: boolean;
  modelOverride?: ModelOverride;
  notification?: NotificationConfig;
  /** Task execution timeout in milliseconds (10s ~ 2h). Defaults to 30 minutes if not set. */
  timeoutMs?: number;
  /** Maximum number of agent turns. Defaults to agent config if not set. */
  maxTurns?: number;
}

/**
 * Scheduler status response
 */
export interface SchedulerStatus {
  isInitialized: boolean;
  /** Whether the scheduler is enabled (not disabled by ENABLE_SCHEDULER=false) */
  enabled: boolean;
  config: {
    maxConcurrent: number;
  };
  activeTaskCount: number;
  runningTaskCount: number;
}

/**
 * Common cron presets for UI
 */
export const CRON_PRESETS = [
  { label: '每 5 分钟', value: '*/5 * * * *' },
  { label: '每 15 分钟', value: '*/15 * * * *' },
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每月 1 日 9:00', value: '0 9 1 * *' },
] as const;

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)', short: 'CST' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)', short: 'JST' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (UTC+8)', short: 'SGT' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (UTC+5:30)', short: 'IST' },
  { value: 'Europe/London', label: 'Europe/London (UTC+0/+1)', short: 'GMT' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (UTC+1/+2)', short: 'CET' },
  { value: 'America/New_York', label: 'America/New_York (UTC-5/-4)', short: 'EST' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-8/-7)', short: 'PST' },
  { value: 'UTC', label: 'UTC (UTC+0)', short: 'UTC' },
] as const;
