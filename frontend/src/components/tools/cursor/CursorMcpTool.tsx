import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import { Plug, ChevronDown, ChevronRight, AlertCircle, Image as ImageIcon } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { McpToolCallArgs, McpToolCallResult, McpContent } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorMcpToolProps {
  execution: BaseToolExecution;
}

/**
 * 渲染 MCP 内容
 */
const McpContentRenderer: React.FC<{ content: McpContent }> = ({ content }) => {
  if (content.text?.text) {
    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(content.text.text);
      return (
        <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-800 p-2 rounded">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      return (
        <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
          {content.text.text}
        </pre>
      );
    }
  }

  if (content.image) {
    return (
      <div className="flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600 dark:text-gray-400">
          Image ({content.image.mimeType})
        </span>
        {content.image.data && (
          <img
            src={`data:${content.image.mimeType};base64,${content.image.data}`}
            alt="MCP Result"
            className="max-w-xs max-h-32 rounded border border-gray-200 dark:border-gray-700"
          />
        )}
      </div>
    );
  }

  if (content.resource) {
    return (
      <div className="text-sm">
        <div className="text-blue-600 dark:text-blue-400 font-mono text-xs">
          {content.resource.uri}
        </div>
        {content.resource.text && (
          <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words mt-1">
            {content.resource.text}
          </pre>
        )}
      </div>
    );
  }

  return null;
};

/**
 * Cursor MCP 工具调用组件
 */
export const CursorMcpTool: React.FC<CursorMcpToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const [showArgs, setShowArgs] = useState(false);
  const [showResult, setShowResult] = useState(true);

  const args = getCursorToolArgs(execution, 'mcpToolCall') as McpToolCallArgs;
  const result = getCursorToolResult(execution, 'mcpToolCall') as McpToolCallResult | undefined;

  // 显示 MCP 服务和工具名称作为副标题
  const getSubtitle = () => {
    if (!args) return undefined;
    return `${args.providerIdentifier}:${args.toolName}`;
  };

  const isError = result?.success?.isError || result?.error !== undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="MCP"
      customIcon={<Plug className="w-4 h-4" />}
      isMcpTool
    >
      <div className="space-y-3">
        {/* MCP 服务信息 */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
            {t('cursorMcpTool.server')}: {args?.providerIdentifier}
          </span>
          <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded">
            {t('cursorMcpTool.tool')}: {args?.toolName}
          </span>
        </div>

        {/* 工具参数 */}
        {args?.args && Object.keys(args.args).length > 0 && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div
              className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              onClick={() => setShowArgs(!showArgs)}
            >
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t('cursorMcpTool.parameters')}
              </span>
              {showArgs ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>
            {showArgs && (
              <div className="p-2 bg-gray-50 dark:bg-gray-800">
                <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words">
                  {JSON.stringify(args.args, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* 执行结果 */}
        {result && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div
              className={`flex items-center justify-between p-2 cursor-pointer transition-colors ${
                isError
                  ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                  : 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
              }`}
              onClick={() => setShowResult(!showResult)}
            >
              <div className="flex items-center gap-2">
                {isError && <AlertCircle className="w-4 h-4 text-red-500" />}
                <span
                  className={`text-xs font-medium ${
                    isError
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-green-700 dark:text-green-400'
                  }`}
                >
                  {isError ? t('cursorMcpTool.error') : t('cursorMcpTool.result')}
                </span>
              </div>
              {showResult ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )}
            </div>

            {showResult && (
              <div className="p-2 bg-gray-50 dark:bg-gray-800 max-h-64 overflow-auto">
                {/* 成功结果 */}
                {result.success?.content && (
                  <div className="space-y-2">
                    {result.success.content.map((content, index) => (
                      <McpContentRenderer key={index} content={content} />
                    ))}
                  </div>
                )}

                {/* 错误结果 */}
                {result.error && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {result.error.error}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
