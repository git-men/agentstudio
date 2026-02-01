import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { File, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { GlobToolCallArgs, GlobToolCallResult } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorGlobToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor Glob 文件查找工具组件
 */
export const CursorGlobTool: React.FC<CursorGlobToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showFiles, setShowFiles] = useState(true);
  const args = getCursorToolArgs(execution, 'globToolCall') as GlobToolCallArgs;
  const result = getCursorToolResult(execution, 'globToolCall') as GlobToolCallResult | undefined;

  // 显示模式和数量作为副标题
  const getSubtitle = () => {
    const pattern = args?.globPattern || '';
    const count = result?.success?.totalFiles;
    if (count !== undefined) {
      return `${pattern} (${count} files)`;
    }
    return pattern;
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Glob"
    >
      <div className="space-y-3">
        {/* 搜索模式 */}
        <ToolInput label={t('cursorGlobTool.pattern')} value={args?.globPattern} />

        {/* 目标目录 */}
        <ToolInput label={t('cursorGlobTool.directory')} value={args?.targetDirectory} />

        {/* 搜索结果 */}
        {result?.success && (
          <>
            {/* 结果统计 */}
            <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>
                {t('cursorGlobTool.totalFiles', { count: result.success.totalFiles })}
              </span>
              {result.success.clientTruncated && (
                <span className="text-yellow-500 dark:text-yellow-400">
                  {t('cursorGlobTool.clientTruncated')}
                </span>
              )}
              {result.success.ripgrepTruncated && (
                <span className="text-yellow-500 dark:text-yellow-400">
                  {t('cursorGlobTool.ripgrepTruncated')}
                </span>
              )}
            </div>

            {/* 文件列表 */}
            {result.success.files.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                {/* 列表头部 */}
                <div
                  className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  onClick={() => setShowFiles(!showFiles)}
                >
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {t('cursorGlobTool.matchedFiles')} ({result.success.files.length})
                  </span>
                  {showFiles ? (
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  )}
                </div>

                {/* 文件列表内容 */}
                {showFiles && (
                  <div className="max-h-48 overflow-auto bg-gray-50 dark:bg-gray-800">
                    {result.success.files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                      >
                        <File className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" />
                        <span className="text-sm text-gray-600 dark:text-gray-400 truncate font-mono">
                          {file}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 无结果提示 */}
            {result.success.files.length === 0 && (
              <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                {t('cursorGlobTool.noFilesFound')}
              </div>
            )}
          </>
        )}
      </div>
    </BaseToolComponent>
  );
};
