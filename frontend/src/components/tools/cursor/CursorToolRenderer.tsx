import React from 'react';
import type { BaseToolExecution } from '../sdk-types';
import { BaseToolComponent } from '../BaseToolComponent';
import { useTranslation } from 'react-i18next';

// 导入所有 Cursor 工具组件
import { CursorLsTool } from './CursorLsTool';
import { CursorReadTool } from './CursorReadTool';
import { CursorEditTool } from './CursorEditTool';
import { CursorDeleteTool } from './CursorDeleteTool';
import { CursorGlobTool } from './CursorGlobTool';
import { CursorGrepTool } from './CursorGrepTool';
import { CursorShellTool } from './CursorShellTool';
import { CursorTodoTool } from './CursorTodoTool';
import { CursorMcpResourcesTool } from './CursorMcpResourcesTool';
import { CursorWebFetchTool } from './CursorWebFetchTool';
import { CursorSemSearchTool } from './CursorSemSearchTool';
import { CursorMcpTool } from './CursorMcpTool';
import { getCursorToolDisplayName } from './utils';

interface CursorToolRendererProps {
  execution: BaseToolExecution;
}

/**
 * Cursor 工具渲染器
 * 根据工具名称路由到对应的 Cursor 工具组件
 */
export const CursorToolRenderer: React.FC<CursorToolRendererProps> = ({ execution }) => {
  const { t } = useTranslation('components');

  switch (execution.toolName) {
    case 'lsToolCall':
      return <CursorLsTool execution={execution} />;

    case 'readToolCall':
      return <CursorReadTool execution={execution} />;

    case 'editToolCall':
    case 'strReplaceToolCall':  // Cursor uses StrReplace for file edits
      return <CursorEditTool execution={execution} />;

    case 'deleteToolCall':
      return <CursorDeleteTool execution={execution} />;

    case 'globToolCall':
      return <CursorGlobTool execution={execution} />;

    case 'grepToolCall':
      return <CursorGrepTool execution={execution} />;

    case 'shellToolCall':
      return <CursorShellTool execution={execution} />;

    case 'updateTodosToolCall':
      return <CursorTodoTool execution={execution} />;

    case 'listMcpResourcesToolCall':
      return <CursorMcpResourcesTool execution={execution} />;

    case 'webFetchToolCall':
      return <CursorWebFetchTool execution={execution} />;

    case 'semSearchToolCall':
      return <CursorSemSearchTool execution={execution} />;

    case 'mcpToolCall':
      return <CursorMcpTool execution={execution} />;

    default:
      // 未知 Cursor 工具，使用基础组件显示
      return (
        <BaseToolComponent
          execution={execution}
          overrideToolName={getCursorToolDisplayName(execution.toolName)}
        >
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {t('cursorToolRenderer.unknownCursorTool', { toolName: execution.toolName })}
            </p>
            <div className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 p-2 rounded font-mono overflow-auto max-h-64">
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(execution.toolInput, null, 2)}
              </pre>
            </div>
          </div>
        </BaseToolComponent>
      );
  }
};

/**
 * 检查是否为 Cursor 工具
 */
export function isCursorTool(toolName: string): boolean {
  const cursorTools = [
    'lsToolCall',
    'readToolCall',
    'editToolCall',
    'strReplaceToolCall',  // Cursor uses StrReplace for file edits
    'deleteToolCall',
    'globToolCall',
    'grepToolCall',
    'shellToolCall',
    'updateTodosToolCall',
    'listMcpResourcesToolCall',
    'webFetchToolCall',
    'semSearchToolCall',
    'mcpToolCall',
  ];
  return cursorTools.includes(toolName);
}
