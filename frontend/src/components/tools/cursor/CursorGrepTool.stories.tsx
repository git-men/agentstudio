import type { Meta, StoryObj } from '@storybook/react';
import { CursorGrepTool } from './CursorGrepTool';
import {
  mockCursorToolInputs,
  mockCursorToolResults,
  mockCursorToolExecutions,
} from './__mocks__/cursorToolTestData';

const meta = {
  title: 'Tools/Cursor/CursorGrepTool',
  component: CursorGrepTool,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'CursorGrepTool 用于显示 Cursor Agent 的内容搜索结果，支持高亮显示匹配内容。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CursorGrepTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SearchResults: Story = {
  args: {
    execution: mockCursorToolExecutions.success(
      'grepToolCall',
      mockCursorToolInputs.grep(),
      mockCursorToolResults.grep()
    ),
  },
};

export const ExecutionStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('grepToolCall', mockCursorToolInputs.grep()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">内容搜索执行状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">等待执行</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.pending(
              'grepToolCall',
              mockCursorToolInputs.grep()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行中</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.executing(
              'grepToolCall',
              mockCursorToolInputs.grep({ pattern: 'useState' })
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">搜索成功</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.success(
              'grepToolCall',
              mockCursorToolInputs.grep(),
              mockCursorToolResults.grep()
            )}
          />
        </div>
      </div>
    </div>
  ),
};

export const SearchOptions: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('grepToolCall', mockCursorToolInputs.grep()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">不同搜索选项</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">忽略大小写</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.success(
              'grepToolCall',
              mockCursorToolInputs.grep({ caseInsensitive: true, pattern: 'error' }),
              mockCursorToolResults.grep()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">多行匹配</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.success(
              'grepToolCall',
              mockCursorToolInputs.grep({ multiline: true, pattern: 'interface.*\\{' }),
              mockCursorToolResults.grep()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">带 Glob 过滤</h4>
          <CursorGrepTool
            execution={mockCursorToolExecutions.success(
              'grepToolCall',
              mockCursorToolInputs.grep({ glob: '*.tsx' }),
              mockCursorToolResults.grep()
            )}
          />
        </div>
      </div>
    </div>
  ),
};
