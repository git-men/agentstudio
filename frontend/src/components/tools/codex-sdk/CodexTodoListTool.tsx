import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import type { BaseToolExecution } from '../sdk-types';
import type { TodoListToolArgs } from './types';

interface CodexTodoListToolProps {
  execution: BaseToolExecution;
}

export const CodexTodoListTool: React.FC<CodexTodoListToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = execution.toolInput as unknown as TodoListToolArgs | undefined;
  const tasks = args?.tasks || [];

  const completedCount = tasks.filter(t => t.completed).length;
  const subtitle = tasks.length > 0
    ? `${completedCount}/${tasks.length} ${t('codexTodoList.tasks')}`
    : undefined;

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={subtitle}
      showResult={false}
      overrideToolName={t('codexTodoList.title')}
    >
      <div className="space-y-2">
        {execution.isExecuting && tasks.length === 0 && (
          <div className="text-sm text-yellow-600 dark:text-yellow-400 animate-pulse">
            {t('codexTodoList.loading')}
          </div>
        )}

        {tasks.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 flex-shrink-0 ${
                  task.completed
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`}>
                  {task.completed ? '✓' : '○'}
                </span>
                <span className={`${
                  task.completed
                    ? 'text-gray-500 dark:text-gray-400 line-through'
                    : 'text-gray-700 dark:text-gray-300'
                }`}>
                  {task.text}
                </span>
              </div>
            ))}
          </div>
        )}

        {!execution.isExecuting && tasks.length > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {t('codexTodoList.completed', { completed: completedCount, total: tasks.length })}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
