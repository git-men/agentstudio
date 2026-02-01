import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import type { BaseToolExecution } from '../sdk-types';
import type { ReadToolCallArgs, ReadToolCallResult } from './types';
import { formatFileSize, extractFileName, getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorReadToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor 文件读取工具组件
 */
export const CursorReadTool: React.FC<CursorReadToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'readToolCall') as ReadToolCallArgs;
  const result = getCursorToolResult(execution, 'readToolCall') as ReadToolCallResult | undefined;

  // 提取文件名作为副标题
  const getSubtitle = () => {
    if (!args?.path) return undefined;
    return extractFileName(args.path);
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Read"
    >
      <div className="space-y-3">
        {/* 文件路径 */}
        <ToolInput label={t('readTool.readFile')} value={args?.path} />

        {/* 行数限制（如果有） */}
        {args?.limit && (
          <ToolInput label={t('readTool.readLines')} value={args.limit} />
        )}

        {/* 读取结果信息 */}
        {result?.success && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2">
            {/* 总行数 */}
            <span>
              {t('cursorReadTool.totalLines', { lines: result.success.totalLines })}
            </span>

            {/* 文件大小 */}
            <span>
              {t('cursorReadTool.fileSize', { size: formatFileSize(result.success.fileSize) })}
            </span>

            {/* 读取范围 */}
            {result.success.readRange && (
              <span>
                {t('cursorReadTool.readRange', {
                  start: result.success.readRange.startLine,
                  end: result.success.readRange.endLine,
                })}
              </span>
            )}

            {/* 超出限制警告 */}
            {result.success.exceededLimit && (
              <span className="text-yellow-500 dark:text-yellow-400">
                {t('cursorReadTool.exceededLimit')}
              </span>
            )}

            {/* 空文件标记 */}
            {result.success.isEmpty && (
              <span className="text-gray-400 dark:text-gray-500">
                {t('cursorReadTool.isEmpty')}
              </span>
            )}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
