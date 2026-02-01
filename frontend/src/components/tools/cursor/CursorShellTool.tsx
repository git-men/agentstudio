import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import type { BaseToolExecution } from '../sdk-types';
import type { ShellToolCallArgs, ShellToolCallResult } from './types';
import { formatExecutionTime, getCursorToolResult, getCursorToolArgs } from './utils';

interface CursorShellToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor Shell 命令执行工具组件
 */
export const CursorShellTool: React.FC<CursorShellToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'shellToolCall') as ShellToolCallArgs;
  const result = getCursorToolResult(execution, 'shellToolCall') as ShellToolCallResult | undefined;

  // 显示命令作为副标题
  const getSubtitle = () => {
    if (!args?.command) return undefined;
    // 截断过长的命令
    const cmd = args.command.trim();
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  };

  // 获取输出内容
  const getOutput = () => {
    if (!result?.success) return null;
    // 优先使用交错输出，否则使用 stdout + stderr
    return result.success.interleavedOutput || 
           (result.success.stdout + (result.success.stderr ? '\n' + result.success.stderr : ''));
  };

  const output = getOutput();
  const exitCode = result?.success?.exitCode;
  const isError = exitCode !== undefined && exitCode !== 0;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Shell"
    >
      <div className="space-y-3">
        {/* 工作目录（如果有） */}
        {args?.workingDirectory && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium">CWD:</span> {args.workingDirectory}
          </div>
        )}

        {/* 终端样式的命令执行区域 */}
        <div className="bg-gray-900 rounded-lg p-4 font-mono text-sm">
          {/* 命令行提示符和命令 */}
          <div className="flex items-start">
            <span className="text-green-400 mr-2 select-none">$</span>
            <span className="text-white break-all flex-1">{args?.command}</span>
          </div>

          {/* 执行结果 */}
          {!execution.isExecuting && output && (
            <div className="mt-2">
              <pre
                className={`whitespace-pre-wrap break-words ${
                  isError ? 'text-red-400' : 'text-gray-300'
                }`}
              >
                {output}
              </pre>
            </div>
          )}

          {/* 执行中状态 */}
          {execution.isExecuting && (
            <div className="mt-2">
              <span className="text-yellow-400 animate-pulse">
                {t('bashTool.executing')}
              </span>
            </div>
          )}
        </div>

        {/* 执行信息 */}
        {result?.success && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
            {/* 退出码 */}
            <span
              className={`${
                isError
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-green-500 dark:text-green-400'
              }`}
            >
              {t('cursorShellTool.exitCode', { code: exitCode })}
            </span>

            {/* 执行时间 */}
            {result.success.executionTime !== undefined && (
              <span>
                {t('cursorShellTool.executionTime', {
                  time: formatExecutionTime(result.success.executionTime),
                })}
              </span>
            )}

            {/* 后台运行标记 */}
            {result.isBackground && (
              <span className="text-blue-500 dark:text-blue-400">
                {t('cursorShellTool.background')}
              </span>
            )}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
