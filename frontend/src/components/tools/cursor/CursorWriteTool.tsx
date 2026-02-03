import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { WriteToolCallArgs, WriteToolCallResult } from './types';
import { extractFileName, getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorWriteToolProps {
  execution: BaseToolExecution;
}

/**
 * Try to parse result from toolResult string (for history messages)
 */
function parseToolResult(toolResult: string | undefined): WriteToolCallResult | undefined {
  if (!toolResult) return undefined;
  
  try {
    const parsed = JSON.parse(toolResult);
    // Check if it's the expected structure
    if (parsed.success || parsed.error) {
      return parsed as WriteToolCallResult;
    }
    // Maybe it's just the success/error object directly
    if (parsed.path && parsed.message) {
      return { success: parsed };
    }
  } catch {
    // Not JSON, ignore
  }
  return undefined;
}

/**
 * Cursor 文件写入工具组件
 */
export const CursorWriteTool: React.FC<CursorWriteToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showContents, setShowContents] = useState(false);
  const args = getCursorToolArgs(execution, 'writeToolCall') as WriteToolCallArgs;
  
  // Try to get result from toolUseResult first, then from toolResult string
  const result = useMemo(() => {
    const structuredResult = getCursorToolResult(execution, 'writeToolCall') as WriteToolCallResult | undefined;
    if (structuredResult?.success || structuredResult?.error) return structuredResult;
    
    // Fallback: try to parse from toolResult string
    return parseToolResult(execution.toolResult);
  }, [execution]);

  // 提取文件名作为副标题
  const getSubtitle = () => {
    if (!args?.path) return undefined;
    return extractFileName(args.path);
  };

  // 计算内容行数
  const getContentLineCount = () => {
    if (!args?.contents) return 0;
    return args.contents.split('\n').length;
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Write"
    >
      <div className="space-y-3">
        {/* 文件路径 */}
        <ToolInput label={t('cursorWriteTool.filePath', '文件路径')} value={args?.path} />

        {/* 写入统计 */}
        {args?.contents && (
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <FileText className="w-3 h-3" />
            <span>{getContentLineCount()} {t('cursorWriteTool.lines', '行')}</span>
          </div>
        )}

        {/* 操作结果 */}
        {result?.success?.message && (
          <div className="text-sm text-green-600 dark:text-green-400">
            {result.success.message}
          </div>
        )}

        {result?.error && (
          <div className="text-sm text-red-600 dark:text-red-400">
            {result.error.error}
          </div>
        )}

        {/* 内容预览 */}
        {args?.contents && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowContents(!showContents)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorWriteTool.viewContents', '查看内容')}
              </span>
              {showContents ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>

            {showContents && (
              <div className="max-h-64 overflow-auto bg-gray-50 dark:bg-gray-800 p-2">
                <pre className="font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all">
                  {args.contents}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
