import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent, ToolInput } from '../BaseToolComponent';
import { Globe, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { WebFetchToolCallArgs, WebFetchToolCallResult } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorWebFetchToolProps {
  execution: BaseToolExecution;
}

/**
 * Cursor 网页获取工具组件
 */
export const CursorWebFetchTool: React.FC<CursorWebFetchToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showContent, setShowContent] = useState(false);
  const args = getCursorToolArgs(execution, 'webFetchToolCall') as WebFetchToolCallArgs;
  const result = getCursorToolResult(execution, 'webFetchToolCall') as WebFetchToolCallResult | undefined;

  // 提取域名作为副标题
  const getSubtitle = () => {
    if (!args?.url) return undefined;
    try {
      const url = new URL(args.url);
      return url.hostname;
    } catch {
      return args.url.slice(0, 40);
    }
  };

  const isError = result?.error !== undefined;
  const isSuccess = result?.success !== undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="WebFetch"
      customIcon={<Globe className="w-4 h-4" />}
    >
      <div className="space-y-3">
        {/* URL */}
        <ToolInput label={t('cursorWebFetchTool.url')} value={args?.url} />

        {/* 成功状态 - 显示 Markdown 内容 */}
        {isSuccess && result.success && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {/* 内容头部 */}
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowContent(!showContent)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorWebFetchTool.fetchedContent')}
              </span>
              {showContent ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>

            {/* Markdown 内容 */}
            {showContent && (
              <div className="max-h-64 overflow-auto p-3 bg-gray-50 dark:bg-gray-800">
                <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words font-mono">
                  {result.success.markdown.length > 2000
                    ? result.success.markdown.slice(0, 2000) + '\n\n...(truncated)'
                    : result.success.markdown}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* 错误状态 */}
        {isError && result.error && (
          <div className="flex items-start p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 mr-2 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-300">
                {t('cursorWebFetchTool.fetchFailed')}
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
