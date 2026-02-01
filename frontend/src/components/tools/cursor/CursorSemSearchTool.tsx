import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { SemSearchToolCallArgs, SemSearchToolCallResult } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorSemSearchToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor 语义搜索工具组件
 */
export const CursorSemSearchTool: React.FC<CursorSemSearchToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showResults, setShowResults] = useState(true);
  const args = getCursorToolArgs(execution, 'semSearchToolCall') as SemSearchToolCallArgs;
  const result = getCursorToolResult(execution, 'semSearchToolCall') as
    | SemSearchToolCallResult
    | undefined;

  // 显示查询作为副标题
  const getSubtitle = () => {
    if (!args?.query) return undefined;
    const query = args.query.trim();
    return query.length > 50 ? query.slice(0, 50) + '...' : query;
  };

  // 解析 XML 格式的搜索结果
  const parseSearchResults = (xmlResults: string) => {
    const results: Array<{
      path: string;
      startLine: string;
      endLine: string;
      content: string;
    }> = [];

    // 简单的 XML 解析，匹配 <search_result> 标签
    const regex = /<search_result\s+path="([^"]+)"\s+startLine="(\d+)"\s+endLine="(\d+)">([\s\S]*?)<\/search_result>/g;
    let match;

    while ((match = regex.exec(xmlResults)) !== null) {
      results.push({
        path: match[1],
        startLine: match[2],
        endLine: match[3],
        content: match[4].trim(),
      });
    }

    return results;
  };

  const searchResults = result?.success?.results ? parseSearchResults(result.success.results) : [];

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="SemanticSearch"
      customIcon={<Search className="w-4 h-4" />}
    >
      <div className="space-y-3">
        {/* 搜索查询 */}
        <ToolInput label={t('cursorSemSearchTool.query')} value={args?.query} />

        {/* 目标目录 */}
        {args?.targetDirectories && args.targetDirectories.length > 0 && (
          <ToolInput
            label={t('cursorSemSearchTool.targetDirectories')}
            value={args.targetDirectories.join(', ')}
          />
        )}

        {/* 搜索说明 */}
        {args?.explanation && (
          <ToolInput label={t('cursorSemSearchTool.explanation')} value={args.explanation} />
        )}

        {/* 搜索结果 */}
        {searchResults.length > 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* 结果头部 */}
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowResults(!showResults)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorSemSearchTool.results', { count: searchResults.length })}
              </span>
              {showResults ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>

            {/* 结果内容 */}
            {showResults && (
              <div className="max-h-96 overflow-auto">
                {searchResults.map((item, index) => (
                  <div
                    key={index}
                    className="border-b border-gray-200 dark:border-gray-700 last:border-b-0"
                  >
                    {/* 文件信息 */}
                    <div className="flex items-center px-3 py-2 bg-gray-50 dark:bg-gray-800">
                      <span className="text-sm font-mono text-blue-600 dark:text-blue-400 truncate">
                        {item.path}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        L{item.startLine}-{item.endLine}
                      </span>
                    </div>
                    {/* 代码内容 */}
                    <div className="p-2 bg-gray-900 dark:bg-gray-950">
                      <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words overflow-auto max-h-40">
                        {item.content.length > 500
                          ? item.content.slice(0, 500) + '\n...(truncated)'
                          : item.content}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 原始结果（如果无法解析） */}
        {result?.success?.results && searchResults.length === 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="p-2 bg-gray-100 dark:bg-gray-700">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorSemSearchTool.rawResults')}
              </span>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-800 max-h-64 overflow-auto">
              <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                {result.success.results}
              </pre>
            </div>
          </div>
        )}

        {/* 无结果提示 */}
        {result?.success && !result.success.results && (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            {t('cursorSemSearchTool.noResults')}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
