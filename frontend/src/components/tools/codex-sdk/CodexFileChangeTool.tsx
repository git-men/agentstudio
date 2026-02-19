import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import type { BaseToolExecution } from '../sdk-types';
import type { FileChangeToolArgs, FileChangeToolResult } from './types';

interface CodexFileChangeToolProps {
  execution: BaseToolExecution;
}

export const CodexFileChangeTool: React.FC<CodexFileChangeToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = execution.toolInput as unknown as FileChangeToolArgs | undefined;
  const files = args?.files || [];

  let result: FileChangeToolResult | undefined;
  try {
    if (execution.toolResult) {
      result = JSON.parse(execution.toolResult) as FileChangeToolResult;
    }
  } catch {
    // ignore parse errors
  }

  const added = files.filter(f => f.changeType === 'added').length;
  const modified = files.filter(f => f.changeType === 'modified').length;
  const deleted = files.filter(f => f.changeType === 'deleted').length;

  const subtitle = files.length > 0
    ? `${files.length} ${t('codexFileChange.filesCount', { count: files.length })}`
    : undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={subtitle}
      showResult={false}
      overrideToolName={t('codexFileChange.title')}
    >
      <div className="space-y-2">
        {execution.isExecuting && (
          <div className="text-sm text-yellow-600 dark:text-yellow-400 animate-pulse">
            {t('codexFileChange.executing')}
          </div>
        )}

        {files.length > 0 && (
          <>
            <div className="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
              {added > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  +{added} {t('codexFileChange.added')}
                </span>
              )}
              {modified > 0 && (
                <span className="text-orange-600 dark:text-orange-400">
                  ~{modified} {t('codexFileChange.modified')}
                </span>
              )}
              {deleted > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  -{deleted} {t('codexFileChange.deleted')}
                </span>
              )}
            </div>

            <div className="space-y-1 max-h-48 overflow-y-auto">
              {files.map((file, i) => (
                <div key={i} className="flex items-center gap-2 text-sm font-mono">
                  <span className={
                    file.changeType === 'added' ? 'text-green-600 dark:text-green-400' :
                    file.changeType === 'deleted' ? 'text-red-600 dark:text-red-400' :
                    'text-orange-600 dark:text-orange-400'
                  }>
                    {file.changeType === 'added' ? '+' : file.changeType === 'deleted' ? '-' : '~'}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300 truncate">{file.path}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {result && !execution.isExecuting && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('codexFileChange.status')}: {result.status}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
