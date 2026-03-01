/**
 * Codex SDK tool type definitions
 */

export type CodexSdkToolName =
  | 'shellToolCall'
  | 'fileChangeToolCall'
  | 'webSearchToolCall'
  | 'todoListToolCall';

export interface ShellToolArgs {
  command: string;
  workingDirectory?: string;
}

export interface ShellToolResult {
  output: string;
  exit_code: number;
}

export interface FileChangeToolArgs {
  files: Array<{
    path: string;
    changeType: 'added' | 'modified' | 'deleted';
  }>;
}

export interface FileChangeToolResult {
  status: 'completed' | 'failed';
  fileCount: number;
}

export interface WebSearchToolArgs {
  query: string;
}

export interface WebSearchToolResult {
  status: 'completed' | 'failed';
}

export interface TodoListToolArgs {
  tasks: Array<{
    text: string;
    completed: boolean;
  }>;
}

export interface TodoListToolResult {
  status: 'completed' | 'failed';
  taskCount: number;
  completedCount: number;
}
