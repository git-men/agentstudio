import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import { Plug, Link as LinkIcon } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { ListMcpResourcesToolCallResult, McpResource } from './types';
import { getCursorToolResult } from './utils';

interface CursorMcpResourcesToolProps {
  execution: BaseToolExecution;
}

/**
 * MCP 资源项组件
 */
const McpResourceItem: React.FC<{ resource: McpResource }> = ({ resource }) => {
  return (
    <div className="flex items-start p-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
      <LinkIcon className="w-4 h-4 text-blue-500 dark:text-blue-400 mr-2 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
          {resource.name}
        </p>
        {resource.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {resource.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <code className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded truncate">
            {resource.uri}
          </code>
          {resource.mimeType && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {resource.mimeType}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Cursor MCP 资源列表工具组件
 */
export const CursorMcpResourcesTool: React.FC<CursorMcpResourcesToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const result = getCursorToolResult(execution, 'listMcpResourcesToolCall') as
    | ListMcpResourcesToolCallResult
    | undefined;

  const resources = result?.success?.resources || [];

  // 显示资源数量作为副标题
  const getSubtitle = () => {
    return `${resources.length} resources`;
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="ListMcpResources"
      customIcon={<Plug className="w-4 h-4" />}
    >
      <div className="space-y-3">
        {/* 资源列表 */}
        {resources.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-auto">
            {resources.map((resource, index) => (
              <McpResourceItem key={index} resource={resource} />
            ))}
          </div>
        )}

        {/* 空状态 */}
        {resources.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            {t('cursorMcpResourcesTool.noResources')}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
