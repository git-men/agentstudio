import type { Meta, StoryObj } from '@storybook/react';
import { CursorToolRenderer } from './CursorToolRenderer';
import {
  mockCursorToolInputs,
  mockCursorToolResults,
  mockCursorToolExecutions,
} from './__mocks__/cursorToolTestData';

const meta = {
  title: 'Tools/Cursor/CursorToolRenderer',
  component: CursorToolRenderer,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'CursorToolRenderer 是 Cursor Agent 工具的路由器，根据工具名称渲染对应的组件。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CursorToolRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

// 所有工具概览
export const AllTools: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('shellToolCall', mockCursorToolInputs.shell()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">Cursor 工具组件概览</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Shell 命令执行</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'shellToolCall',
              mockCursorToolInputs.shell(),
              mockCursorToolResults.shell()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">文件读取</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'readToolCall',
              mockCursorToolInputs.read(),
              mockCursorToolResults.read()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">文件编辑</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'editToolCall',
              mockCursorToolInputs.edit(),
              mockCursorToolResults.edit()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">目录列表</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'lsToolCall',
              mockCursorToolInputs.ls(),
              mockCursorToolResults.ls()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">文件查找 (Glob)</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'globToolCall',
              mockCursorToolInputs.glob(),
              mockCursorToolResults.glob()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">内容搜索 (Grep)</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'grepToolCall',
              mockCursorToolInputs.grep(),
              mockCursorToolResults.grep()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">Todo 管理</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'updateTodosToolCall',
              mockCursorToolInputs.updateTodos(),
              mockCursorToolResults.updateTodos()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">语义搜索</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'semSearchToolCall',
              mockCursorToolInputs.semSearch(),
              mockCursorToolResults.semSearch()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">网页获取</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'webFetchToolCall',
              mockCursorToolInputs.webFetch(),
              mockCursorToolResults.webFetchSuccess()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">文件删除</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'deleteToolCall',
              mockCursorToolInputs.delete(),
              mockCursorToolResults.deleteSuccess()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">MCP 资源列表</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'listMcpResourcesToolCall',
              mockCursorToolInputs.listMcpResources(),
              mockCursorToolResults.listMcpResources()
            )}
          />
        </div>
      </div>
    </div>
  ),
};

// 执行状态展示
export const ExecutionStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('shellToolCall', mockCursorToolInputs.shell()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">工具执行状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">等待执行</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.pending(
              'shellToolCall',
              mockCursorToolInputs.shell()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行中</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.executing(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'npm install' })
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行成功</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.success(
              'shellToolCall',
              mockCursorToolInputs.shell(),
              mockCursorToolResults.shell()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行失败</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.error(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'invalid-command' }),
              mockCursorToolResults.shellError()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行中断</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.interrupted(
              'shellToolCall',
              mockCursorToolInputs.shell()
            )}
          />
        </div>
      </div>
    </div>
  ),
};

// 错误状态展示
export const ErrorStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('deleteToolCall', mockCursorToolInputs.delete()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">错误状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">文件删除失败</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.error(
              'deleteToolCall',
              mockCursorToolInputs.delete({ path: '/nonexistent/file.txt' }),
              mockCursorToolResults.deleteError()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">网页获取失败</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.error(
              'webFetchToolCall',
              mockCursorToolInputs.webFetch({ url: 'https://invalid-url.example.com' }),
              mockCursorToolResults.webFetchError()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">Shell 命令失败</h4>
          <CursorToolRenderer
            execution={mockCursorToolExecutions.error(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'invalid-command' }),
              mockCursorToolResults.shellError()
            )}
          />
        </div>
      </div>
    </div>
  ),
};
