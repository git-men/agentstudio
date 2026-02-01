import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { DeleteToolCallArgs, DeleteToolCallResult } from './types';
import { extractFileName, getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorDeleteToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor 文件删除工具组件
 */
export const CursorDeleteTool: React.FC<CursorDeleteToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'deleteToolCall') as DeleteToolCallArgs;
  const result = getCursorToolResult(execution, 'deleteToolCall') as DeleteToolCallResult | undefined;

  // 提取文件名作为副标题
  const getSubtitle = () => {
    if (!args?.path) return undefined;
    return extractFileName(args.path);
  };

  const isError = result?.error !== undefined;
  const isSuccess = result?.success !== undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Delete"
      customIcon={<Trash2 className="w-4 h-4" />}
    >
      <div className="space-y-3">
        {/* 文件路径 */}
        <ToolInput label={t('cursorDeleteTool.path')} value={args?.path} />

        {/* 成功状态 */}
        {isSuccess && result.success && (
          <div className="flex items-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle2 className="w-5 h-5 text-green-500 dark:text-green-400 mr-2 flex-shrink-0" />
            <span className="text-sm text-green-700 dark:text-green-300">
              {result.success.message || t('cursorDeleteTool.deleteSuccess')}
            </span>
          </div>
        )}

        {/* 错误状态 */}
        {isError && result.error && (
          <div className="flex items-start p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {t('cursorDeleteTool.deleteFailed')}
              </p>
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                {result.error.error}
              </p>
            </div>
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
