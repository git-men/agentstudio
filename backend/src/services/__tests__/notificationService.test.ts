import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shouldNotify,
  resolveChannels,
  formatMessage,
  formatDuration,
  extractAgentSummary,
  sendNotification,
} from '../notificationService.js';
import type { TaskResult } from '../taskExecutor/types.js';
import type { ScheduledTask, NotificationConfig } from '../../types/scheduledTasks.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../dispatchService.js', () => ({
  sendToIM: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../imBindingService.js', () => ({
  imBindingService: {
    list: vi.fn().mockReturnValue([]),
  },
}));

// Re-import mocked modules for assertion access
import { sendToIM } from '../dispatchService.js';
import { imBindingService } from '../imBindingService.js';

const mockedSendToIM = vi.mocked(sendToIM);
const mockedImBindingList = vi.mocked(imBindingService.list);

// ============================================================================
// Helpers
// ============================================================================

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId: 'exec_abc123',
    status: 'completed',
    output: 'Task completed successfully.',
    completedAt: new Date().toISOString(),
    executionTimeMs: 12345,
    ...overrides,
  };
}

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task_001',
    name: '每日检查',
    agentId: 'agent_001',
    projectPath: '/projects/my-project',
    schedule: { type: 'cron', cronExpression: '0 9 * * *' },
    triggerMessage: '请执行检查',
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
  return {
    enabled: true,
    strategy: 'always',
    ...overrides,
  };
}

// ============================================================================
// shouldNotify
// ============================================================================

describe('shouldNotify', () => {
  const successResult = makeResult({ status: 'completed' });
  const errorResult = makeResult({ status: 'failed', error: 'Something broke' });

  it('returns false when config is undefined', () => {
    expect(shouldNotify(undefined, successResult)).toBe(false);
  });

  it('returns false when config.enabled is false', () => {
    expect(shouldNotify(makeConfig({ enabled: false }), successResult)).toBe(false);
  });

  describe('strategy: always', () => {
    const config = makeConfig({ strategy: 'always' });

    it('returns true on success', () => {
      expect(shouldNotify(config, successResult)).toBe(true);
    });

    it('returns true on error', () => {
      expect(shouldNotify(config, errorResult)).toBe(true);
    });
  });

  describe('strategy: on_success', () => {
    const config = makeConfig({ strategy: 'on_success' });

    it('returns true on success', () => {
      expect(shouldNotify(config, successResult)).toBe(true);
    });

    it('returns false on error', () => {
      expect(shouldNotify(config, errorResult)).toBe(false);
    });
  });

  describe('strategy: on_error', () => {
    const config = makeConfig({ strategy: 'on_error' });

    it('returns false on success', () => {
      expect(shouldNotify(config, successResult)).toBe(false);
    });

    it('returns true on error', () => {
      expect(shouldNotify(config, errorResult)).toBe(true);
    });
  });

  describe('strategy: agent_decided', () => {
    it('returns true when output contains [SHOULD-NOTIFY-USER] marker', () => {
      const result = makeResult({ output: 'Report done. [SHOULD-NOTIFY-USER] Here is the summary.' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(true);
    });

    it('returns false when output does not contain marker', () => {
      const result = makeResult({ output: 'Report done. All good.' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(false);
    });

    it('returns false when execution failed', () => {
      const result = makeResult({ status: 'failed', output: '[SHOULD-NOTIFY-USER] error', error: 'crash' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(false);
    });

    it('matches marker case-insensitively', () => {
      const result = makeResult({ output: 'Done [should-notify-user] summary here' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(true);
    });

    it('detects marker at start of output', () => {
      const result = makeResult({ output: '[SHOULD-NOTIFY-USER] Very important' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(true);
    });

    it('detects marker at end of output', () => {
      const result = makeResult({ output: 'All done [SHOULD-NOTIFY-USER]' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(true);
    });

    it('returns false when output is empty', () => {
      const result = makeResult({ output: '', status: 'completed' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(false);
    });

    it('returns false when output is undefined', () => {
      const result = makeResult({ output: undefined, status: 'completed' });
      expect(shouldNotify(makeConfig({ strategy: 'agent_decided' }), result)).toBe(false);
    });
  });
});

// ============================================================================
// extractAgentSummary
// ============================================================================

describe('extractAgentSummary', () => {
  it('extracts text after marker up to 200 chars', () => {
    const output = 'Some preamble [SHOULD-NOTIFY-USER] This is the summary text.';
    expect(extractAgentSummary(output)).toBe('This is the summary text.');
  });

  it('extracts full text after marker including across paragraphs', () => {
    const output = '[SHOULD-NOTIFY-USER] First paragraph.\n\nSecond paragraph.';
    expect(extractAgentSummary(output)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('returns all text after marker regardless of length', () => {
    const longText = 'A'.repeat(300);
    const output = `[SHOULD-NOTIFY-USER] ${longText}`;
    const result = extractAgentSummary(output);
    expect(result.length).toBe(300);
  });

  it('falls back to first 200 chars when no text after marker', () => {
    const output = 'Some long output content here [SHOULD-NOTIFY-USER]';
    const result = extractAgentSummary(output);
    expect(result).toBe(output.substring(0, 200));
  });

  it('falls back to first 200 chars when marker not found', () => {
    const output = 'No marker in this output at all.';
    expect(extractAgentSummary(output)).toBe('No marker in this output at all.');
  });
});

// ============================================================================
// formatMessage
// ============================================================================

describe('formatMessage', () => {
  it('formats success message with all fields', () => {
    const msg = formatMessage({
      taskName: '每日检查',
      status: 'success',
      executionTimeMs: 12300,
      summary: '代码质量良好',
    });
    expect(msg).toContain('📋 定时任务执行通知');
    expect(msg).toContain('任务：每日检查');
    expect(msg).toContain('✅ 成功');
    expect(msg).toContain('12.3s');
    expect(msg).toContain('代码质量良好');
    expect(msg).not.toContain('错误信息');
  });

  it('formats error message with error info', () => {
    const msg = formatMessage({
      taskName: '部署任务',
      status: 'error',
      executionTimeMs: 5000,
      summary: '部署失败',
      error: 'Connection refused',
    });
    expect(msg).toContain('❌ 失败');
    expect(msg).toContain('错误信息');
    expect(msg).toContain('Connection refused');
  });

  it('uses （无输出）for empty summary', () => {
    const msg = formatMessage({
      taskName: '测试',
      status: 'success',
      executionTimeMs: 1000,
      summary: '',
    });
    expect(msg).toContain('（无输出）');
  });

  it('includes duration in human-readable format', () => {
    const msg = formatMessage({
      taskName: '长任务',
      status: 'success',
      executionTimeMs: 135000,
      summary: 'Done',
    });
    expect(msg).toContain('2m 15s');
  });

  it('formats agent_decided summary from extracted text', () => {
    const msg = formatMessage({
      taskName: '智能检查',
      status: 'success',
      executionTimeMs: 8000,
      summary: 'Agent provided summary here',
      strategy: 'agent_decided',
    });
    expect(msg).toContain('Agent provided summary here');
  });
});

// ============================================================================
// formatDuration
// ============================================================================

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds with one decimal', () => {
    expect(formatDuration(12300)).toBe('12.3s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(135000)).toBe('2m 15s');
  });

  it('formats minutes only when seconds are zero', () => {
    expect(formatDuration(120000)).toBe('2m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3900000)).toBe('1h 5m');
  });

  it('formats hours only when minutes are zero', () => {
    expect(formatDuration(3600000)).toBe('1h');
  });
});

// ============================================================================
// resolveChannels
// ============================================================================

describe('resolveChannels', () => {
  beforeEach(() => {
    mockedImBindingList.mockReturnValue([]);
  });

  it('uses task-level channels when present', () => {
    const task = makeTask({
      notification: makeConfig({
        channels: [
          { bot_key: 'bot_1', chat_id: 'chat_1', chat_name: '开发群' },
        ],
      }),
    });
    const result = resolveChannels(task);
    expect(result.source).toBe('task_config');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].bot_key).toBe('bot_1');
  });

  it('falls back to IMBinding when task has no channels', () => {
    mockedImBindingList.mockReturnValue([{
      id: 'im_1',
      platform: 'wecom',
      name: 'Test Bot',
      project_path: '/projects/my-project',
      project_name: 'my-project',
      bot_key: 'bot_binding',
      a2a_endpoint: '',
      channels: [{ chat_id: 'chat_bind', chat_name: '项目群' }],
      created_at: '',
      updated_at: '',
    }]);

    const task = makeTask({ notification: makeConfig({ channels: [] }) });
    const result = resolveChannels(task);
    expect(result.source).toBe('im_binding');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].bot_key).toBe('bot_binding');
    expect(result.channels[0].chat_id).toBe('chat_bind');
  });

  it('returns empty when no channels and no IMBinding', () => {
    const task = makeTask({ notification: makeConfig() });
    const result = resolveChannels(task);
    expect(result.source).toBe('none');
    expect(result.channels).toHaveLength(0);
  });

  it('task channels take priority over IMBinding', () => {
    mockedImBindingList.mockReturnValue([{
      id: 'im_1',
      platform: 'wecom',
      name: 'Test Bot',
      project_path: '/projects/my-project',
      project_name: 'my-project',
      bot_key: 'bot_binding',
      a2a_endpoint: '',
      channels: [{ chat_id: 'chat_bind' }],
      created_at: '',
      updated_at: '',
    }]);

    const task = makeTask({
      notification: makeConfig({
        channels: [{ bot_key: 'bot_task', chat_id: 'chat_task' }],
      }),
    });
    const result = resolveChannels(task);
    expect(result.source).toBe('task_config');
    expect(result.channels[0].bot_key).toBe('bot_task');
  });

  it('ignores non-wecom bindings (weixin, qqbot) since they lack outbound API', () => {
    mockedImBindingList.mockReturnValue([{
      id: 'im_wx',
      platform: 'weixin',
      name: 'jarvis 微信',
      project_path: '/projects/my-project',
      project_name: 'my-project',
      bot_key: 'weixin-proj_abc',
      a2a_endpoint: 'https://example.com/a2a',
      created_at: '',
      updated_at: '',
    }]);

    const task = makeTask({ notification: makeConfig() });
    const result = resolveChannels(task);
    expect(result.source).toBe('none');
    expect(result.channels).toHaveLength(0);
  });

  it('prefers wecom binding with channels over weixin binding', () => {
    mockedImBindingList.mockReturnValue([
      {
        id: 'im_wx',
        platform: 'weixin',
        name: 'jarvis 微信',
        project_path: '/projects/my-project',
        project_name: 'my-project',
        bot_key: 'weixin-proj_abc',
        a2a_endpoint: '',
        created_at: '',
        updated_at: '',
      },
      {
        id: 'im_wc',
        platform: 'wecom',
        name: 'jarvis 企微',
        project_path: '/projects/my-project',
        project_name: 'my-project',
        bot_key: 'wecom-key-123',
        a2a_endpoint: '',
        channels: [{ chat_id: 'wecom_chat_1', chat_name: '企微群' }],
        created_at: '',
        updated_at: '',
      },
    ]);

    const task = makeTask({ notification: makeConfig() });
    const result = resolveChannels(task);
    expect(result.source).toBe('im_binding');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].bot_key).toBe('wecom-key-123');
    expect(result.channels[0].chat_id).toBe('wecom_chat_1');
  });

  it('uses wecom bot_key as fallback channel when no explicit channels', () => {
    mockedImBindingList.mockReturnValue([{
      id: 'im_wc',
      platform: 'wecom',
      name: 'jarvis 企微',
      project_path: '/projects/my-project',
      project_name: 'my-project',
      bot_key: 'wecom-key-456',
      a2a_endpoint: '',
      created_at: '',
      updated_at: '',
    }]);

    const task = makeTask({ notification: makeConfig() });
    const result = resolveChannels(task);
    expect(result.source).toBe('im_binding');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].bot_key).toBe('wecom-key-456');
    expect(result.channels[0].chat_id).toBe('wecom-key-456');
  });
});

// ============================================================================
// sendNotification (orchestration)
// ============================================================================

describe('sendNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedImBindingList.mockReturnValue([]);
  });

  it('sends notification when shouldNotify returns true and channels exist', async () => {
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    const result = makeResult();

    await sendNotification(task, result);

    expect(mockedSendToIM).toHaveBeenCalledTimes(1);
    expect(mockedSendToIM).toHaveBeenCalledWith(
      expect.objectContaining({
        botKey: 'bot_1',
        chatId: 'chat_1',
      })
    );
  });

  it('skips when shouldNotify returns false', async () => {
    const task = makeTask({
      notification: makeConfig({ enabled: false }),
    });
    await sendNotification(task, makeResult());
    expect(mockedSendToIM).not.toHaveBeenCalled();
  });

  it('skips when no channels resolved', async () => {
    const task = makeTask({
      notification: makeConfig({ strategy: 'always' }),
    });
    await sendNotification(task, makeResult());
    expect(mockedSendToIM).not.toHaveBeenCalled();
  });

  it('sends to multiple channels independently', async () => {
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [
          { bot_key: 'bot_1', chat_id: 'chat_1' },
          { bot_key: 'bot_2', chat_id: 'chat_2' },
        ],
      }),
    });
    await sendNotification(task, makeResult());
    expect(mockedSendToIM).toHaveBeenCalledTimes(2);
  });

  it('does not throw when sendToIM fails', async () => {
    mockedSendToIM.mockRejectedValueOnce(new Error('Network error'));
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    await expect(sendNotification(task, makeResult())).resolves.toBeUndefined();
  });

  it('passes through sessionId from result', async () => {
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    const result = makeResult({ taskId: 'exec_12345', sessionId: 'session_abc' });
    await sendNotification(task, result);
    expect(mockedSendToIM).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_abc' })
    );
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedImBindingList.mockReturnValue([]);
  });

  it('handles empty Agent output with "（无输出）" summary', async () => {
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    const result = makeResult({ output: '' });
    await sendNotification(task, result);
    expect(mockedSendToIM).toHaveBeenCalledWith(
      expect.objectContaining({
        messageContent: expect.stringContaining('（无输出）'),
      })
    );
  });

  it('continues sending to other channels when one channel fails', async () => {
    mockedSendToIM
      .mockRejectedValueOnce(new Error('Channel 1 failed'))
      .mockResolvedValueOnce({ success: true });

    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [
          { bot_key: 'bot_1', chat_id: 'chat_1' },
          { bot_key: 'bot_2', chat_id: 'chat_2' },
        ],
      }),
    });
    await sendNotification(task, makeResult());
    expect(mockedSendToIM).toHaveBeenCalledTimes(2);
  });

  it('handles IM service timeout gracefully', async () => {
    mockedSendToIM.mockRejectedValue(new Error('Timeout after 10s'));
    const task = makeTask({
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    await expect(sendNotification(task, makeResult())).resolves.toBeUndefined();
  });

  it('concurrent executions send independent notifications', async () => {
    const task1 = makeTask({
      id: 'task_A',
      name: 'Task A',
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_1', chat_id: 'chat_1' }],
      }),
    });
    const task2 = makeTask({
      id: 'task_B',
      name: 'Task B',
      notification: makeConfig({
        strategy: 'always',
        channels: [{ bot_key: 'bot_2', chat_id: 'chat_2' }],
      }),
    });

    await Promise.all([
      sendNotification(task1, makeResult({ taskId: 'exec_A', sessionId: 'session_A' })),
      sendNotification(task2, makeResult({ taskId: 'exec_B', sessionId: 'session_B' })),
    ]);

    expect(mockedSendToIM).toHaveBeenCalledTimes(2);
    expect(mockedSendToIM).toHaveBeenCalledWith(
      expect.objectContaining({ botKey: 'bot_1', sessionId: 'session_A' })
    );
    expect(mockedSendToIM).toHaveBeenCalledWith(
      expect.objectContaining({ botKey: 'bot_2', sessionId: 'session_B' })
    );
  });
});
