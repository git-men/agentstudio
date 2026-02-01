import type { Meta, StoryObj } from '@storybook/react';
import { CursorTodoTool } from './CursorTodoTool';
import {
  mockCursorToolInputs,
  mockCursorToolResults,
  mockCursorToolExecutions,
} from './__mocks__/cursorToolTestData';

const meta = {
  title: 'Tools/Cursor/CursorTodoTool',
  component: CursorTodoTool,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'CursorTodoTool 用于显示 Cursor Agent 的任务管理列表。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CursorTodoTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TodoList: Story = {
  args: {
    execution: mockCursorToolExecutions.success(
      'updateTodosToolCall',
      mockCursorToolInputs.updateTodos(),
      mockCursorToolResults.updateTodos()
    ),
  },
};

export const DifferentStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending(
      'updateTodosToolCall',
      mockCursorToolInputs.updateTodos()
    ),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">不同任务状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">混合状态任务列表</h4>
          <CursorTodoTool
            execution={mockCursorToolExecutions.success(
              'updateTodosToolCall',
              mockCursorToolInputs.updateTodos(),
              mockCursorToolResults.updateTodos()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">全部完成</h4>
          <CursorTodoTool
            execution={mockCursorToolExecutions.success(
              'updateTodosToolCall',
              mockCursorToolInputs.updateTodos({
                todos: [
                  {
                    id: '1',
                    content: '任务 1',
                    status: 'TODO_STATUS_COMPLETED',
                    createdAt: '1769942817550',
                    updatedAt: '1769942817550',
                    dependencies: [],
                  },
                  {
                    id: '2',
                    content: '任务 2',
                    status: 'TODO_STATUS_COMPLETED',
                    createdAt: '1769942817550',
                    updatedAt: '1769942817550',
                    dependencies: [],
                  },
                ],
              }),
              {
                success: {
                  todos: [
                    {
                      id: '1',
                      content: '任务 1',
                      status: 'TODO_STATUS_COMPLETED',
                      createdAt: '1769942817550',
                      updatedAt: '1769942817550',
                      dependencies: [],
                    },
                    {
                      id: '2',
                      content: '任务 2',
                      status: 'TODO_STATUS_COMPLETED',
                      createdAt: '1769942817550',
                      updatedAt: '1769942817550',
                      dependencies: [],
                    },
                  ],
                  totalCount: 2,
                  wasMerge: false,
                },
              }
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">合并模式</h4>
          <CursorTodoTool
            execution={mockCursorToolExecutions.success(
              'updateTodosToolCall',
              mockCursorToolInputs.updateTodos({ merge: true }),
              {
                success: {
                  ...mockCursorToolResults.updateTodos().success,
                  wasMerge: true,
                },
              }
            )}
          />
        </div>
      </div>
    </div>
  ),
};
