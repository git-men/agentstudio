import React from 'react';
import { useTranslation } from 'react-i18next';
import { BaseToolComponent } from '../BaseToolComponent';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { BaseToolExecution } from '../sdk-types';
import type { UpdateTodosToolCallArgs, UpdateTodosToolCallResult, TodoItem } from './types';
import { getCursorToolArgs, getCursorToolResult } from './utils';

interface CursorTodoToolProps {
  execution: BaseToolExecution;
}

/**
 * Todo 状态到图标的映射
 */
const TodoStatusIcon: React.FC<{ status: TodoItem['status'] }> = ({ status }) => {
  switch (status) {
    case 'TODO_STATUS_COMPLETED':
      return <CheckCircle2 className="w-4 h-4 text-green-500 dark:text-green-400" />;
    case 'TODO_STATUS_IN_PROGRESS':
      return <Loader2 className="w-4 h-4 text-blue-500 dark:text-blue-400 animate-spin" />;
    case 'TODO_STATUS_PENDING':
    default:
      return <Circle className="w-4 h-4 text-gray-400 dark:text-gray-500" />;
  }
};

/**
 * Todo 状态颜色
 */
const getStatusClass = (status: TodoItem['status']) => {
  switch (status) {
    case 'TODO_STATUS_COMPLETED':
      return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20';
    case 'TODO_STATUS_IN_PROGRESS':
      return 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20';
    case 'TODO_STATUS_PENDING':
    default:
      return 'text-gray-700 dark:text-gray-400 bg-gray-50 dark:bg-gray-800';
  }
};

/**
 * 单个 Todo 项组件
 */
const TodoItemComponent: React.FC<{ todo: TodoItem }> = ({ todo }) => {
  return (
    <div
      className={`flex items-start p-2 rounded-lg border ${getStatusClass(
        todo.status
      )} border-gray-200 dark:border-gray-700`}
    >
      <div className="flex-shrink-0 mt-0.5">
        <TodoStatusIcon status={todo.status} />
      </div>
      <div className="ml-3 flex-1 min-w-0">
        <p
          className={`text-sm ${
            todo.status === 'TODO_STATUS_COMPLETED' ? 'line-through opacity-60' : ''
          }`}
        >
          {todo.content}
        </p>
        {todo.dependencies.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Dependencies: {todo.dependencies.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * Cursor Todo 管理工具组件
 */
export const CursorTodoTool: React.FC<CursorTodoToolProps> = ({ execution }) => {
  const { t } = useTranslation('components');
  const args = getCursorToolArgs(execution, 'updateTodosToolCall') as UpdateTodosToolCallArgs;
  const result = getCursorToolResult(execution, 'updateTodosToolCall') as
    | UpdateTodosToolCallResult
    | undefined;

  // 使用结果中的 todos 或 args 中的 todos
  const todos = result?.success?.todos || args?.todos || [];

  // 统计各状态数量
  const stats = {
    completed: todos.filter((t) => t.status === 'TODO_STATUS_COMPLETED').length,
    inProgress: todos.filter((t) => t.status === 'TODO_STATUS_IN_PROGRESS').length,
    pending: todos.filter((t) => t.status === 'TODO_STATUS_PENDING').length,
  };

  // 显示统计作为副标题
  const getSubtitle = () => {
    return `${stats.completed}/${todos.length} completed`;
  };

  return (
    <BaseToolComponent
      execution={execution}
      subtitle={getSubtitle()}
      showResult={false}
      hideToolName={false}
      overrideToolName="TodoWrite"
    >
      <div className="space-y-3">
        {/* 统计信息 */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded">
            {t('cursorTodoTool.completed')}: {stats.completed}
          </span>
          <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
            {t('cursorTodoTool.inProgress')}: {stats.inProgress}
          </span>
          <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400 px-2 py-0.5 rounded">
            {t('cursorTodoTool.pending')}: {stats.pending}
          </span>
          {args?.merge !== undefined && (
            <span
              className={`px-2 py-0.5 rounded ${
                args.merge
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                  : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
              }`}
            >
              {args.merge ? t('cursorTodoTool.merge') : t('cursorTodoTool.replace')}
            </span>
          )}
        </div>

        {/* Todo 列表 */}
        {todos.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-auto">
            {todos.map((todo) => (
              <TodoItemComponent key={todo.id} todo={todo} />
            ))}
          </div>
        )}

        {/* 空状态 */}
        {todos.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            {t('cursorTodoTool.noTodos')}
          </div>
        )}
      </div>
    </BaseToolComponent>
  );
};
