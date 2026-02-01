import type { Meta, StoryObj } from '@storybook/react';
import { CursorLsTool } from './CursorLsTool';
import {
  mockCursorToolInputs,
  mockCursorToolResults,
  mockCursorToolExecutions,
} from './__mocks__/cursorToolTestData';

const meta = {
  title: 'Tools/Cursor/CursorLsTool',
  component: CursorLsTool,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'CursorLsTool 用于显示 Cursor Agent 的目录列表结果，支持树形结构展示。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CursorLsTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DirectoryTree: Story = {
  args: {
    execution: mockCursorToolExecutions.success(
      'lsToolCall',
      mockCursorToolInputs.ls(),
      mockCursorToolResults.ls()
    ),
  },
};

export const ExecutionStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('lsToolCall', mockCursorToolInputs.ls()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">目录列表执行状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">等待执行</h4>
          <CursorLsTool
            execution={mockCursorToolExecutions.pending('lsToolCall', mockCursorToolInputs.ls())}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行中</h4>
          <CursorLsTool
            execution={mockCursorToolExecutions.executing('lsToolCall', mockCursorToolInputs.ls())}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行成功</h4>
          <CursorLsTool
            execution={mockCursorToolExecutions.success(
              'lsToolCall',
              mockCursorToolInputs.ls(),
              mockCursorToolResults.ls()
            )}
          />
        </div>
      </div>
    </div>
  ),
};
