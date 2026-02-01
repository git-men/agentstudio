/**
 * Cursor 工具组件的测试数据
 */

import type { BaseToolExecution } from '../../sdk-types';
import type {
  LsToolCallArgs,
  LsToolCallResult,
  ReadToolCallArgs,
  ReadToolCallResult,
  EditToolCallArgs,
  EditToolCallResult,
  DeleteToolCallArgs,
  DeleteToolCallResult,
  GlobToolCallArgs,
  GlobToolCallResult,
  GrepToolCallArgs,
  GrepToolCallResult,
  ShellToolCallArgs,
  ShellToolCallResult,
  UpdateTodosToolCallArgs,
  UpdateTodosToolCallResult,
  SemSearchToolCallArgs,
  SemSearchToolCallResult,
  WebFetchToolCallArgs,
  WebFetchToolCallResult,
  ListMcpResourcesToolCallArgs,
  ListMcpResourcesToolCallResult,
} from '../types';

// 基础工具执行工厂
export function createCursorToolExecution(
  overrides: Partial<BaseToolExecution>
): BaseToolExecution {
  return {
    id: 'cursor-test-execution-123',
    toolName: '',
    toolInput: {} as any,
    isExecuting: false,
    timestamp: new Date(),
    ...overrides,
  };
}

// ==================== Cursor 工具输入测试数据 ====================

export const mockCursorToolInputs = {
  // lsToolCall
  ls: (overrides?: Partial<LsToolCallArgs>): LsToolCallArgs => ({
    path: '/Users/kongjie/projects/agent-studio',
    ignore: ['node_modules', '.git', 'dist'],
    toolCallId: 'tool_ls_001',
    ...overrides,
  }),

  // readToolCall
  read: (overrides?: Partial<ReadToolCallArgs>): ReadToolCallArgs => ({
    path: '/Users/kongjie/projects/agent-studio/package.json',
    limit: 50,
    ...overrides,
  }),

  // editToolCall
  edit: (overrides?: Partial<EditToolCallArgs>): EditToolCallArgs => ({
    path: '/Users/kongjie/projects/agent-studio/README.md',
    streamContent: '# Agent Studio\n\nA powerful AI workspace platform.',
    ...overrides,
  }),

  // deleteToolCall
  delete: (overrides?: Partial<DeleteToolCallArgs>): DeleteToolCallArgs => ({
    path: '/Users/kongjie/projects/agent-studio/temp.txt',
    toolCallId: 'tool_delete_001',
    ...overrides,
  }),

  // globToolCall
  glob: (overrides?: Partial<GlobToolCallArgs>): GlobToolCallArgs => ({
    targetDirectory: '/Users/kongjie/projects/agent-studio',
    globPattern: '**/*.tsx',
    ...overrides,
  }),

  // grepToolCall
  grep: (overrides?: Partial<GrepToolCallArgs>): GrepToolCallArgs => ({
    pattern: 'export default',
    path: '/Users/kongjie/projects/agent-studio/src',
    caseInsensitive: false,
    multiline: false,
    toolCallId: 'tool_grep_001',
    ...overrides,
  }),

  // shellToolCall
  shell: (overrides?: Partial<ShellToolCallArgs>): ShellToolCallArgs => ({
    command: 'ls -la',
    workingDirectory: '/Users/kongjie/projects/agent-studio',
    timeout: 30000,
    simpleCommands: ['ls'],
    hasInputRedirect: false,
    hasOutputRedirect: false,
    parsingResult: {
      parsingFailed: false,
      executableCommands: [
        {
          name: 'ls',
          args: [{ type: 'word', value: '-la' }],
          fullText: 'ls -la',
        },
      ],
      hasRedirects: false,
      hasCommandSubstitution: false,
    },
    isBackground: false,
    ...overrides,
  }),

  // updateTodosToolCall
  updateTodos: (overrides?: Partial<UpdateTodosToolCallArgs>): UpdateTodosToolCallArgs => ({
    todos: [
      {
        id: '1',
        content: '检查代码结构',
        status: 'TODO_STATUS_COMPLETED',
        createdAt: '1769942817550',
        updatedAt: '1769942817550',
        dependencies: [],
      },
      {
        id: '2',
        content: '实现工具组件',
        status: 'TODO_STATUS_IN_PROGRESS',
        createdAt: '1769942817550',
        updatedAt: '1769942817550',
        dependencies: ['1'],
      },
      {
        id: '3',
        content: '编写测试用例',
        status: 'TODO_STATUS_PENDING',
        createdAt: '1769942817550',
        updatedAt: '1769942817550',
        dependencies: ['2'],
      },
    ],
    merge: false,
    ...overrides,
  }),

  // semSearchToolCall
  semSearch: (overrides?: Partial<SemSearchToolCallArgs>): SemSearchToolCallArgs => ({
    query: '如何在项目中使用组件',
    targetDirectories: [],
    explanation: 'Looking for component usage patterns',
    ...overrides,
  }),

  // webFetchToolCall
  webFetch: (overrides?: Partial<WebFetchToolCallArgs>): WebFetchToolCallArgs => ({
    url: 'https://api.github.com',
    toolCallId: 'tool_webfetch_001',
    ...overrides,
  }),

  // listMcpResourcesToolCall
  listMcpResources: (
    overrides?: Partial<ListMcpResourcesToolCallArgs>
  ): ListMcpResourcesToolCallArgs => ({
    ...overrides,
  }),
};

// ==================== Cursor 工具结果测试数据 ====================

export const mockCursorToolResults = {
  // lsToolCall 结果
  ls: (): LsToolCallResult => ({
    success: {
      directoryTreeRoot: {
        absPath: '/Users/kongjie/projects/agent-studio',
        childrenDirs: [
          {
            absPath: '/Users/kongjie/projects/agent-studio/frontend',
            childrenDirs: [
              {
                absPath: '/Users/kongjie/projects/agent-studio/frontend/src',
                childrenDirs: [],
                childrenFiles: [{ name: 'App.tsx' }, { name: 'main.tsx' }],
                childrenWereProcessed: true,
                fullSubtreeExtensionCounts: { '.tsx': 2 },
                numFiles: 2,
              },
            ],
            childrenFiles: [{ name: 'package.json' }, { name: 'vite.config.ts' }],
            childrenWereProcessed: true,
            fullSubtreeExtensionCounts: { '.tsx': 2, '.json': 1, '.ts': 1 },
            numFiles: 4,
          },
          {
            absPath: '/Users/kongjie/projects/agent-studio/backend',
            childrenDirs: [],
            childrenFiles: [{ name: 'index.ts' }],
            childrenWereProcessed: true,
            fullSubtreeExtensionCounts: { '.ts': 1 },
            numFiles: 1,
          },
        ],
        childrenFiles: [{ name: 'package.json' }, { name: 'README.md' }],
        childrenWereProcessed: true,
        fullSubtreeExtensionCounts: { '.tsx': 2, '.ts': 2, '.json': 2, '.md': 1 },
        numFiles: 7,
      },
    },
  }),

  // readToolCall 结果
  read: (): ReadToolCallResult => ({
    success: {
      content:
        '{\n  "name": "agent-studio",\n  "version": "1.0.0",\n  "description": "AI Agent Workspace"\n}',
      isEmpty: false,
      exceededLimit: false,
      totalLines: 5,
      fileSize: 89,
      path: '/Users/kongjie/projects/agent-studio/package.json',
      readRange: {
        startLine: 1,
        endLine: 5,
      },
    },
  }),

  // editToolCall 结果
  edit: (): EditToolCallResult => ({
    success: {
      path: '/Users/kongjie/projects/agent-studio/README.md',
      linesAdded: 3,
      linesRemoved: 1,
      diffString: '-# Agent Studio\n+# Agent Studio\n+\n+A powerful AI workspace platform.',
      beforeFullFileContent: '# Agent Studio\n',
      afterFullFileContent: '# Agent Studio\n\nA powerful AI workspace platform.\n',
      message: 'The file has been updated.',
    },
  }),

  // deleteToolCall 结果
  deleteSuccess: (): DeleteToolCallResult => ({
    success: {
      path: '/Users/kongjie/projects/agent-studio/temp.txt',
      message: 'File deleted successfully.',
    },
  }),

  deleteError: (): DeleteToolCallResult => ({
    error: {
      path: '/Users/kongjie/projects/agent-studio/nonexistent.txt',
      error: 'File not found',
    },
  }),

  // globToolCall 结果
  glob: (): GlobToolCallResult => ({
    success: {
      pattern: '**/*.tsx',
      path: '/Users/kongjie/projects/agent-studio',
      files: [
        'frontend/src/App.tsx',
        'frontend/src/main.tsx',
        'frontend/src/components/Header.tsx',
        'frontend/src/components/Sidebar.tsx',
      ],
      totalFiles: 4,
      clientTruncated: false,
      ripgrepTruncated: false,
    },
  }),

  // grepToolCall 结果
  grep: (): GrepToolCallResult => ({
    success: {
      pattern: 'export default',
      path: '/Users/kongjie/projects/agent-studio/src',
      outputMode: 'content',
      workspaceResults: {
        '/Users/kongjie/projects/agent-studio': {
          content: {
            matches: [
              {
                file: './src/App.tsx',
                matches: [
                  {
                    lineNumber: 45,
                    content: 'export default App;',
                    contentTruncated: false,
                    isContextLine: false,
                  },
                ],
              },
              {
                file: './src/components/Header.tsx',
                matches: [
                  {
                    lineNumber: 23,
                    content: 'export default Header;',
                    contentTruncated: false,
                    isContextLine: false,
                  },
                ],
              },
            ],
          },
        },
      },
    },
  }),

  // shellToolCall 结果
  shell: (): ShellToolCallResult => ({
    success: {
      command: 'ls -la',
      workingDirectory: '/Users/kongjie/projects/agent-studio',
      exitCode: 0,
      signal: '',
      stdout: `total 520
drwxr-xr-x  21 kongjie  staff   672 Jan  9 15:28 .
drwxr-xr-x  15 kongjie  staff   480 Jan  8 10:15 ..
-rw-r--r--   1 kongjie  staff  2048 Jan  9 15:28 package.json
drwxr-xr-x  12 kongjie  staff   384 Jan  9 15:28 frontend`,
      stderr: '',
      executionTime: 243,
      interleavedOutput: `total 520
drwxr-xr-x  21 kongjie  staff   672 Jan  9 15:28 .
drwxr-xr-x  15 kongjie  staff   480 Jan  8 10:15 ..
-rw-r--r--   1 kongjie  staff  2048 Jan  9 15:28 package.json
drwxr-xr-x  12 kongjie  staff   384 Jan  9 15:28 frontend`,
    },
    isBackground: false,
  }),

  shellError: (): ShellToolCallResult => ({
    success: {
      command: 'invalid-command',
      workingDirectory: '/Users/kongjie/projects/agent-studio',
      exitCode: 127,
      signal: '',
      stdout: '',
      stderr: 'command not found: invalid-command',
      executionTime: 50,
      interleavedOutput: 'command not found: invalid-command',
    },
    isBackground: false,
  }),

  // updateTodosToolCall 结果
  updateTodos: (): UpdateTodosToolCallResult => ({
    success: {
      todos: [
        {
          id: '1',
          content: '检查代码结构',
          status: 'TODO_STATUS_COMPLETED',
          createdAt: '1769942817550',
          updatedAt: '1769942817550',
          dependencies: [],
        },
        {
          id: '2',
          content: '实现工具组件',
          status: 'TODO_STATUS_IN_PROGRESS',
          createdAt: '1769942817550',
          updatedAt: '1769942817551',
          dependencies: ['1'],
        },
        {
          id: '3',
          content: '编写测试用例',
          status: 'TODO_STATUS_PENDING',
          createdAt: '1769942817550',
          updatedAt: '1769942817550',
          dependencies: ['2'],
        },
      ],
      totalCount: 3,
      wasMerge: false,
    },
  }),

  // semSearchToolCall 结果
  semSearch: (): SemSearchToolCallResult => ({
    success: {
      results: `<search_result path="showcase/src/App.tsx" startLine="1" endLine="50">
import React from 'react';
import { Button } from './components/Button';

export default function App() {
  return (
    <div className="app">
      <Button onClick={() => console.log('clicked')}>
        Click me
      </Button>
    </div>
  );
}
</search_result>
<search_result path="showcase/src/components/Button.tsx" startLine="1" endLine="25">
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export const Button: React.FC<ButtonProps> = ({ children, onClick }) => {
  return (
    <button className="btn" onClick={onClick}>
      {children}
    </button>
  );
};
</search_result>`,
    },
  }),

  // webFetchToolCall 结果
  webFetchSuccess: (): WebFetchToolCallResult => ({
    success: {
      url: 'https://api.github.com',
      markdown: `# GitHub API
      
This is the GitHub REST API.

## Endpoints

- GET /users - List users
- GET /repos - List repositories
- POST /issues - Create an issue`,
    },
  }),

  webFetchError: (): WebFetchToolCallResult => ({
    error: {
      url: 'https://invalid-url.example.com',
      error: 'Failed to fetch: Network error',
    },
  }),

  // listMcpResourcesToolCall 结果
  listMcpResources: (): ListMcpResourcesToolCallResult => ({
    success: {
      resources: [
        {
          uri: 'resource://config/settings.json',
          name: 'Application Settings',
          description: 'Main application configuration',
          mimeType: 'application/json',
        },
        {
          uri: 'resource://data/users.csv',
          name: 'User Data',
          description: 'User database export',
          mimeType: 'text/csv',
        },
      ],
    },
  }),

  listMcpResourcesEmpty: (): ListMcpResourcesToolCallResult => ({
    success: {
      resources: [],
    },
  }),
};

// ==================== 不同状态的工具执行示例 ====================

export const mockCursorToolExecutions = {
  // 不同执行状态
  pending: (toolName: string, input: any): BaseToolExecution =>
    createCursorToolExecution({ toolName, toolInput: input, isExecuting: false }),

  executing: (toolName: string, input: any): BaseToolExecution =>
    createCursorToolExecution({ toolName, toolInput: input, isExecuting: true }),

  success: (toolName: string, input: any, result?: any): BaseToolExecution =>
    createCursorToolExecution({
      toolName,
      toolInput: input,
      toolResult: result ? JSON.stringify(result) : undefined,
      toolUseResult: result,
      isExecuting: false,
    }),

  error: (toolName: string, input: any, error?: any): BaseToolExecution =>
    createCursorToolExecution({
      toolName,
      toolInput: input,
      toolResult: error ? JSON.stringify(error) : undefined,
      toolUseResult: error,
      isExecuting: false,
      isError: true,
    }),

  interrupted: (toolName: string, input: any): BaseToolExecution =>
    createCursorToolExecution({
      toolName,
      toolInput: input,
      isExecuting: false,
      isInterrupted: true,
    }),
};
