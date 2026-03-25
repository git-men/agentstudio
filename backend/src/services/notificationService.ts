/**
 * Notification Service
 *
 * Orchestrates IM notification delivery after scheduled task execution.
 * Provides: shouldNotify(), resolveChannels(), formatMessage(), sendNotification()
 *
 * Design:
 * - Fire-and-forget from BuiltinExecutor.storeResult()
 * - Two-tier channel resolution: task config → project IMBinding → skip
 * - Graceful degradation: notification failures never affect task results
 */

import type {
  ScheduledTask,
  NotificationConfig,
  NotificationStrategy,
} from '../types/scheduledTasks.js';
import type { TaskResult } from './taskExecutor/types.js';
import { sendToIM } from './dispatchService.js';
import { imBindingService, type IMBinding } from './imBindingService.js';

// ============================================================================
// Internal Types
// ============================================================================

interface ResolvedChannel {
  bot_key: string;
  chat_id: string;
  chat_name?: string;
  source: 'task_config' | 'im_binding';
}

interface ChannelResolutionResult {
  channels: ResolvedChannel[];
  source: 'task_config' | 'im_binding' | 'none';
}

interface NotificationPayload {
  taskName: string;
  status: 'success' | 'error';
  executionTimeMs: number;
  summary: string;
  error?: string;
  strategy?: NotificationStrategy;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Determine whether a notification should be sent based on config and result.
 */
export function shouldNotify(
  config: NotificationConfig | undefined,
  result: TaskResult
): boolean {
  if (!config || !config.enabled) {
    return false;
  }

  const succeeded = result.status === 'completed';

  switch (config.strategy) {
    case 'always':
      return true;
    case 'on_success':
      return succeeded;
    case 'on_error':
      return !succeeded;
    case 'agent_decided':
      if (!succeeded) return false;
      if (!result.output) return false;
      return result.output.toLowerCase().includes('[should-notify-user]');
    default:
      return false;
  }
}

/**
 * Resolve notification target channels using two-tier fallback.
 * Tier 1: explicit task channels
 * Tier 2: project IMBinding channels
 * Tier 3: empty (skip + warn)
 */
export function resolveChannels(task: ScheduledTask): ChannelResolutionResult {
  // Tier 1: explicit task channels
  const taskChannels = task.notification?.channels;
  if (taskChannels && taskChannels.length > 0) {
    return {
      channels: taskChannels.map(ch => ({
        bot_key: ch.bot_key,
        chat_id: ch.chat_id,
        chat_name: ch.chat_name,
        source: 'task_config' as const,
      })),
      source: 'task_config',
    };
  }

  // Tier 2: project IMBinding
  // Only wecom platform supports proactive outbound via /api/im/send.
  // weixin/qqbot use polling-based channels without a REST send API.
  const bindings = imBindingService.list();
  const projectBindings = bindings.filter(b => b.project_path === task.projectPath);
  const wecomBindings = projectBindings.filter(b => b.platform === 'wecom');
  const otherBindings = projectBindings.filter(b => b.platform !== 'wecom');

  // Tier 2a: wecom binding with explicit channels (preferred)
  for (const binding of wecomBindings) {
    if (binding.channels && binding.channels.length > 0) {
      return {
        channels: binding.channels.map(ch => ({
          bot_key: binding.bot_key,
          chat_id: ch.chat_id,
          chat_name: ch.chat_name,
          source: 'im_binding' as const,
        })),
        source: 'im_binding',
      };
    }
  }

  // Tier 2b: wecom binding without explicit channels — use bot_key as default webhook target
  for (const binding of wecomBindings) {
    if (binding.bot_key) {
      return {
        channels: [{
          bot_key: binding.bot_key,
          chat_id: binding.bot_key,
          chat_name: binding.name,
          source: 'im_binding' as const,
        }],
        source: 'im_binding',
      };
    }
  }

  // Tier 3: no wecom binding — log why
  if (otherBindings.length > 0) {
    const platforms = [...new Set(otherBindings.map(b => b.platform))].join(', ');
    console.warn(
      `[NotificationService] Project "${task.projectPath}" has IM bindings (${platforms}) but none support outbound notifications. ` +
      `Only wecom (企微) platform supports proactive IM delivery. ` +
      `Add a wecom binding with channels to enable notifications for task "${task.name}".`
    );
  } else {
    console.warn(
      `[NotificationService] No IM bindings found for project "${task.projectPath}". ` +
      `Add a wecom binding to enable notifications for task "${task.name}".`
    );
  }
  return { channels: [], source: 'none' };
}

/**
 * Format a notification message from payload.
 */
export function formatMessage(payload: NotificationPayload): string {
  const statusEmoji = payload.status === 'success' ? '✅' : '❌';
  const statusText = payload.status === 'success' ? '成功' : '失败';
  const duration = formatDuration(payload.executionTimeMs);
  const summary = payload.summary || '（无输出）';

  let message = `📋 定时任务执行通知\n\n`;
  message += `任务：${payload.taskName}\n`;
  message += `状态：${statusEmoji} ${statusText}\n`;
  message += `耗时：${duration}\n\n`;
  message += `摘要：\n${summary}`;

  if (payload.status === 'error' && payload.error) {
    message += `\n\n错误信息：\n${payload.error}`;
  }

  return message;
}

/**
 * Format milliseconds into a human-readable duration string.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Extract summary text after [SHOULD-NOTIFY-USER] marker from Agent output.
 * Falls back to first 200 chars of full output if no text after marker.
 */
export function extractAgentSummary(output: string): string {
  const markerLower = '[should-notify-user]';
  const lowerOutput = output.toLowerCase();
  const markerIndex = lowerOutput.indexOf(markerLower);

  if (markerIndex === -1) {
    return truncateSummary(output);
  }

  const afterMarker = output.substring(markerIndex + markerLower.length).trimStart();

  if (!afterMarker) {
    return truncateSummary(output);
  }

  const doubleNewlineIndex = afterMarker.indexOf('\n\n');
  const extracted = doubleNewlineIndex >= 0 && doubleNewlineIndex < 200
    ? afterMarker.substring(0, doubleNewlineIndex)
    : afterMarker.substring(0, 200);

  return extracted.trim() || truncateSummary(output);
}

/**
 * Orchestrate the full notification flow.
 * Called fire-and-forget from BuiltinExecutor.storeResult().
 */
export async function sendNotification(
  task: ScheduledTask,
  result: TaskResult
): Promise<void> {
  try {
    if (!shouldNotify(task.notification, result)) {
      return;
    }

    const resolution = resolveChannels(task);
    if (resolution.channels.length === 0) {
      return;
    }

    const summary = buildSummary(task, result);

    const payload: NotificationPayload = {
      taskName: task.name,
      status: result.status === 'completed' ? 'success' : 'error',
      executionTimeMs: result.executionTimeMs,
      summary,
      error: result.error,
      strategy: task.notification?.strategy,
    };

    const message = formatMessage(payload);
    const sessionId = `notify_${result.taskId}`;

    const sendPromises = resolution.channels.map(channel =>
      sendToIM({
        sessionId,
        messageContent: message,
        botKey: channel.bot_key,
        chatId: channel.chat_id,
        projectName: task.projectPath.split('/').pop(),
        agentId: task.agentId,
      }).catch(err => {
        console.warn(
          `[NotificationService] Failed to send to channel ${channel.chat_id}:`,
          { service: 'notification', operation: 'sendToIM', error: err }
        );
      })
    );

    await Promise.allSettled(sendPromises);
  } catch (error) {
    console.warn(
      '[NotificationService] Notification failed (non-blocking):',
      { service: 'notification', operation: 'sendNotification', error }
    );
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function truncateSummary(text: string, maxLength = 200): string {
  if (!text) return '（无输出）';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function buildSummary(task: ScheduledTask, result: TaskResult): string {
  if (task.notification?.strategy === 'agent_decided' && result.output) {
    return extractAgentSummary(result.output);
  }
  return truncateSummary(result.output || '');
}
