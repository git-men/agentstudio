import React from 'react';
import { useTranslation } from 'react-i18next';
import type { BaseToolExecution } from '../sdk-types';
import { BaseToolComponent } from '../BaseToolComponent';
import { BashTool } from '../BashTool';
import { CodexFileChangeTool } from './CodexFileChangeTool';
import { CodexWebSearchTool } from './CodexWebSearchTool';
import { CodexTodoListTool } from './CodexTodoListTool';
import { getCodexSdkToolDisplayName } from './utils';

interface CodexSdkToolRendererProps {
  execution: BaseToolExecution;
}

export const CodexSdkToolRenderer: React.FC<CodexSdkToolRendererProps> = ({ execution }) => {
  const { t } = useTranslation('components');

  switch (execution.toolName) {
    case 'shellToolCall':
      return <BashTool execution={execution} />;

    case 'fileChangeToolCall':
      return <CodexFileChangeTool execution={execution} />;

    case 'webSearchToolCall':
      return <CodexWebSearchTool execution={execution} />;

    case 'todoListToolCall':
      return <CodexTodoListTool execution={execution} />;

    default:
      return (
        <BaseToolComponent
          execution={execution}
          overrideToolName={getCodexSdkToolDisplayName(execution.toolName)}
        >
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {t('codexSdkToolRenderer.unknownTool', { toolName: execution.toolName })}
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
