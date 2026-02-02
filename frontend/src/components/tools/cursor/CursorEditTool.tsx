import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { EditToolCallArgs, EditToolCallResult } from './types';
import { extractFileName, getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorEditToolProps {
  execution: BaseToolExecution;
}

/**
 * Try to parse result from toolResult string (for history messages)
 */
function parseToolResult(toolResult: string | undefined): EditToolCallResult | undefined {
  if (!toolResult) return undefined;
  
  try {
    const parsed = JSON.parse(toolResult);
    // Check if it's the expected structure
    if (parsed.success) {
      return parsed as EditToolCallResult;
    }
    // Maybe it's just the success object directly
    if (parsed.diffString || parsed.linesAdded !== undefined) {
      return { success: parsed };
    }
  } catch {
    // Not JSON, ignore
  }
  return undefined;
}

/**
 * Cursor 文件编辑工具组件
 */
export const CursorEditTool: React.FC<CursorEditToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showDiff, setShowDiff] = useState(false);
  const [showRawResult, setShowRawResult] = useState(false);
  const args = getCursorToolArgs(execution, 'editToolCall') as EditToolCallArgs;
  
  // Try to get result from toolUseResult first, then from toolResult string
  const result = useMemo(() => {
    const structuredResult = getCursorToolResult(execution, 'editToolCall') as EditToolCallResult | undefined;
    if (structuredResult?.success) return structuredResult;
    
    // Fallback: try to parse from toolResult string
    return parseToolResult(execution.toolResult);
  }, [execution]);

  // 提取文件名作为副标题
  const getSubtitle = () => {
    if (!args?.path) return undefined;
    const fileName = extractFileName(args.path);
    if (result?.success) {
      const { linesAdded, linesRemoved } = result.success;
      return `${fileName} (+${linesAdded} -${linesRemoved})`;
    }
    return fileName;
  };

  // 渲染 diff 内容
  const renderDiff = (diffString: string) => {
    const lines = diffString.split('\n');
    return lines.map((line, index) => {
      let className = 'text-gray-600 dark:text-gray-400';
      let Icon = null;

      if (line.startsWith('+')) {
        className = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
        Icon = Plus;
      } else if (line.startsWith('-')) {
        className = 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20';
        Icon = Minus;
      }

      return (
        <div key={index} className={`flex items-start ${className} px-2 py-0.5`}>
          {Icon && <Icon className="w-3 h-3 mr-1 mt-0.5 flex-shrink-0" />}
          <span className="font-mono text-xs whitespace-pre-wrap break-all">
            {line.substring(1) || ' '}
          </span>
        </div>
      );
    });
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="Edit"
    >
      <div className="space-y-3">
        {/* 文件路径 */}
        <ToolInput label={t('cursorEditTool.filePath')} value={args?.path} />

        {/* 编辑结果统计 */}
        {result?.success && (
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-green-600 dark:text-green-400">
              +{result.success.linesAdded} {t('cursorEditTool.linesAdded')}
            </span>
            <span className="text-red-600 dark:text-red-400">
              -{result.success.linesRemoved} {t('cursorEditTool.linesRemoved')}
            </span>
          </div>
        )}

        {/* 操作消息 */}
        {result?.success?.message && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {result.success.message}
          </div>
        )}

        {/* Diff 展示区域 */}
        {result?.success?.diffString && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* Diff 头部 */}
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowDiff(!showDiff)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorEditTool.viewDiff')}
              </span>
              {showDiff ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>

            {/* Diff 内容 */}
            {showDiff && (
              <div className="max-h-64 overflow-auto bg-gray-50 dark:bg-gray-800">
                {renderDiff(result.success.diffString)}
              </div>
            )}
          </div>
        )}

        {/* Fallback: 显示原始结果（当没有结构化 diff 时） */}
        {!result?.success?.diffString && execution.toolResult && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowRawResult(!showRawResult)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorEditTool.viewResult', '查看结果')}
              </span>
              {showRawResult ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>
            {showRawResult && (
              <div className="max-h-64 overflow-auto bg-gray-50 dark:bg-gray-800 p-2">
                <pre className="font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all">
                  {execution.toolResult}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
