import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import type { BaseToolExecution } from '../sdk-types';
import type { WebSearchToolArgs } from './types';

interface CodexWebSearchToolProps {
  execution: BaseToolExecution;
}

export const CodexWebSearchTool: React.FC<CodexWebSearchToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = execution.toolInput as unknown as WebSearchToolArgs | undefined;
  const query = args?.query || '';

  const subtitle = query
    ? (query.length > 50 ? query.slice(0, 50) + '...' : query)
    : undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={subtitle}
      showResult={false}
      overrideToolName={t('codexWebSearch.title')}
    >
      <div className="space-y-2">
        {query && (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('codexWebSearch.query')}:
            </span>{' '}
            {query}
          </div>
        )}

        {execution.isExecuting && (
          <div className="text-sm text-yellow-600 dark:text-yellow-400 animate-pulse">
            {t('codexWebSearch.searching')}
          </div>
        )}

        {!execution.isExecuting && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('codexWebSearch.completed')}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
