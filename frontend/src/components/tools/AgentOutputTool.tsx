import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from './BaseToolComponent';
import type { BaseToolExecution } from './sdk-types';
import type { AgentOutputInput } from './sdk-types';
import { Loader2, CheckCircle, XCircle, Clock } from 'lucide-react';

interface AgentOutputToolProps {
  execution: BaseToolExecution;
}

/**
 * AgentOutput 工具组件
 * 
 * 用于显示从后台运行的子 Agent 获取结果的工具调用。
 * 当 Task 工具使用 run_in_background: true 启动后台 Agent 后，
 * Claude 会使用 AgentOutput 来检查/等待后台任务的结果。
 * 
 * SDK 参数:
 * - agentId: 后台 Agent 的 ID
 * - block: 是否阻塞等待结果
 * - wait_up_to: 最大等待时间（秒）
 * 
 * 注意: 实际运行时参数名可能为 task_id / timeout（Claude Code CLI 的内部命名）
 */
export const AgentOutputTool: React.FC<AgentOutputToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const input = execution.toolInput as unknown as AgentOutputInput;

  // 兼容 SDK 类型定义和 CLI 实际参数名
  const agentId = input.agentId || (input as any).task_id || '';
  const isBlocking = input.block ?? (input as any).blocking ?? false;
  const waitUpTo = input.wait_up_to ?? (input as any).timeout;

  // 格式化等待时间
  const formatWaitTime = (value: number | undefined): string | null => {
    if (value === undefined || value === null) return null;
    // SDK 定义为秒，CLI 可能传递毫秒
    const ms = value > 10000 ? value : value * 1000;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  };

  // 构建副标题
  const getSubtitle = () => {
    const parts: string[] = [];
    if (agentId) {
      // 缩短显示的 Agent ID
      const shortId = agentId.length > 12 ? agentId.substring(0, 12) + '...' : agentId;
      parts.push(`Agent ${shortId}`);
    }
    if (isBlocking) {
      parts.push(t('agentOutputTool.blocking'));
    }
    return parts.length > 0 ? parts.join(' • ') : undefined;
  };

  // 解析工具结果
  const parseResult = (): { text: string; isError: boolean } | null => {
    if (!execution.toolUseResult && !execution.toolResult) return null;

    const raw = execution.toolUseResult || execution.toolResult;
    if (typeof raw === 'string') {
      return { text: raw, isError: !!execution.isError };
    }
    if (typeof raw === 'object') {
      return { text: JSON.stringify(raw, null, 2), isError: !!execution.isError };
    }
    return null;
  };

  const result = parseResult();
  const waitTimeDisplay = formatWaitTime(waitUpTo);

  return (
    <BaseToolComponent execution={execution} subtitle={getSubtitle()} showResult={false} hideToolName={false}>
      <div className="space-y-3">
        {/* Agent ID */}
        {agentId && (
          <ToolInput label={t('agentOutputTool.agentId')} value={agentId} isCode />
        )}

        {/* 参数标签 */}
        <div className="flex flex-wrap gap-2">
          {/* 阻塞模式 */}
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
            isBlocking
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
            {isBlocking ? (
              <Clock className="w-3 h-3" />
            ) : null}
            {isBlocking ? t('agentOutputTool.blockingMode') : t('agentOutputTool.nonBlockingMode')}
          </span>

          {/* 等待时间 */}
          {waitTimeDisplay && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
              <Clock className="w-3 h-3" />
              {t('agentOutputTool.timeout')}: {waitTimeDisplay}
            </span>
          )}
        </div>

        {/* 执行中状态 */}
        {execution.isExecuting && (
          <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">
              {isBlocking
                ? t('agentOutputTool.waitingForResult')
                : t('agentOutputTool.fetchingResult')
              }
            </span>
          </div>
        )}

        {/* 结果显示 */}
        {!execution.isExecuting && result && (
          <div>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              {result.isError ? (
                <>
                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  <span className="text-red-700 dark:text-red-400">{t('agentOutputTool.error')}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-green-700 dark:text-green-400">{t('agentOutputTool.completed')}</span>
                </>
              )}
            </div>
            <pre className={`text-sm font-mono rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-words border ${
              result.isError
                ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800'
                : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800'
            }`}>
              {result.text}
            </pre>
          </div>
        )}

        {/* 无结果时的提示 */}
        {!execution.isExecuting && !result && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('agentOutputTool.noResult')}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
