import type { Meta, StoryObj } from '@storybook/react';
import { CursorShellTool } from './CursorShellTool';
import {
  mockCursorToolInputs,
  mockCursorToolResults,
  mockCursorToolExecutions,
} from './__mocks__/cursorToolTestData';

const meta = {
  title: 'Tools/Cursor/CursorShellTool',
  component: CursorShellTool,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'CursorShellTool 用于显示 Cursor Agent 的 Shell 命令执行结果。',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CursorShellTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExecutionStates: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('shellToolCall', mockCursorToolInputs.shell()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">Shell 命令执行状态</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">等待执行</h4>
          <CursorShellTool
            execution={mockCursorToolExecutions.pending(
              'shellToolCall',
              mockCursorToolInputs.shell()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行中</h4>
          <CursorShellTool
            execution={mockCursorToolExecutions.executing(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'npm install' })
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行成功</h4>
          <CursorShellTool
            execution={mockCursorToolExecutions.success(
              'shellToolCall',
              mockCursorToolInputs.shell(),
              mockCursorToolResults.shell()
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">执行失败</h4>
          <CursorShellTool
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

export const DifferentCommands: Story = {
  args: {
    execution: mockCursorToolExecutions.pending('shellToolCall', mockCursorToolInputs.shell()),
  },
  render: () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold mb-4">不同类型的命令</h3>

      <div className="grid gap-4">
        <div>
          <h4 className="font-medium text-gray-700 mb-2">Git 命令</h4>
          <CursorShellTool
            execution={mockCursorToolExecutions.success(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'git status --short' }),
              {
                success: {
                  command: 'git status --short',
                  workingDirectory: '/Users/kongjie/projects/agent-studio',
                  exitCode: 0,
                  signal: '',
                  stdout: 'M frontend/src/App.tsx\n?? new-file.txt',
                  stderr: '',
                  executionTime: 150,
                  interleavedOutput: 'M frontend/src/App.tsx\n?? new-file.txt',
                },
                isBackground: false,
              }
            )}
          />
        </div>

        <div>
          <h4 className="font-medium text-gray-700 mb-2">包管理命令</h4>
          <CursorShellTool
            execution={mockCursorToolExecutions.success(
              'shellToolCall',
              mockCursorToolInputs.shell({ command: 'pnpm list --depth=0' }),
              {
                success: {
                  command: 'pnpm list --depth=0',
                  workingDirectory: '/Users/kongjie/projects/agent-studio',
                  exitCode: 0,
                  signal: '',
                  stdout: `agent-studio@1.0.0 /Users/kongjie/projects/agent-studio
├── react@18.2.0
├── typescript@5.0.0
└── vite@5.0.0`,
                  stderr: '',
                  executionTime: 500,
                  interleavedOutput: `agent-studio@1.0.0 /Users/kongjie/projects/agent-studio
├── react@18.2.0
├── typescript@5.0.0
└── vite@5.0.0`,
                },
                isBackground: false,
              }
            )}
          />
        </div>
      </div>
    </div>
  ),
};
