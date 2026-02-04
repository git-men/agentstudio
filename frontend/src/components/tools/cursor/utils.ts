/**
 * Cursor 工具数据转换工具函数
 */

import type { BaseToolExecution } from '../sdk-types';
import type {
  CursorToolCallEvent,
  CursorToolName,
  CursorToolArgsMap,
  CursorToolResultMap,
} from './types';

/**
 * 从 Cursor 工具调用事件中提取工具名称
 */
export function extractCursorToolName(toolCall: Record<string, unknown>): CursorToolName | null {
  const toolNames: CursorToolName[] = [
    'lsToolCall',
    'readToolCall',
    'editToolCall',
    'deleteToolCall',
    'globToolCall',
    'grepToolCall',
    'shellToolCall',
    'updateTodosToolCall',
    'listMcpResourcesToolCall',
    'webFetchToolCall',
    'semSearchToolCall',
    'mcpToolCall',
  ];

  for (const name of toolNames) {
    if (name in toolCall) {
      return name;
    }
  }
  return null;
}

/**
 * 检查是否为 Cursor 工具调用
 */
export function isCursorToolCall(toolName: string): toolName is CursorToolName {
  return toolName.endsWith('ToolCall');
}

/**
 * 将 Cursor 工具调用事件转换为 BaseToolExecution 格式
 */
export function cursorToolCallToExecution(event: CursorToolCallEvent): BaseToolExecution {
  const toolName = extractCursorToolName(event.tool_call);
  if (!toolName) {
    throw new Error(`Unknown Cursor tool call: ${JSON.stringify(Object.keys(event.tool_call))}`);
  }

  const toolData = event.tool_call[toolName];
  if (!toolData) {
    throw new Error(`Missing tool data for ${toolName}`);
  }

  const hasError = toolData.result && 'error' in toolData.result;

  // Cursor 工具参数类型与 SDK 类型不同，使用类型断言
  // Cursor 工具组件会通过 getCursorToolArgs 获取正确类型的参数
  return {
    id: event.call_id,
    toolName: toolName,
    toolInput: toolData.args as BaseToolExecution['toolInput'],
    toolResult: toolData.result ? JSON.stringify(toolData.result, null, 2) : undefined,
    toolUseResult: toolData.result,
    isExecuting: event.subtype === 'started',
    isError: hasError,
    isInterrupted: false,
    timestamp: new Date(event.timestamp_ms),
  };
}

/**
 * 从 BaseToolExecution 中提取 Cursor 工具的参数
 * 类型安全的辅助函数
 */
export function getCursorToolArgs<T extends CursorToolName>(
  execution: BaseToolExecution,
  _toolName: T
): CursorToolArgsMap[T] {
  return execution.toolInput as CursorToolArgsMap[T];
}

/**
 * 从 BaseToolExecution 中提取 Cursor 工具的结果
 * 类型安全的辅助函数
 */
export function getCursorToolResult<T extends CursorToolName>(
  execution: BaseToolExecution,
  _toolName: T
): CursorToolResultMap[T] | undefined {
  return execution.toolUseResult as CursorToolResultMap[T] | undefined;
}

/**
 * 获取 Cursor 工具的显示名称
 */
export function getCursorToolDisplayName(toolName: string): string {
  const displayNames: Record<string, string> = {
    lsToolCall: 'LS',
    readToolCall: 'Read',
    editToolCall: 'Edit',
    strReplaceToolCall: 'StrReplace',  // Cursor uses StrReplace for file edits
    deleteToolCall: 'Delete',
    globToolCall: 'Glob',
    grepToolCall: 'Grep',
    shellToolCall: 'Shell',
    updateTodosToolCall: 'TodoWrite',
    listMcpResourcesToolCall: 'ListMcpResources',
    webFetchToolCall: 'WebFetch',
    semSearchToolCall: 'SemanticSearch',
    mcpToolCall: 'MCP',
  };
  return displayNames[toolName] || toolName;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 格式化执行时间
 */
export function formatExecutionTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

/**
 * 从路径中提取文件名
 */
export function extractFileName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * 从路径中提取目录名
 */
export function extractDirName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || parts[parts.length - 2] || path;
}

/**
 * 截断长字符串
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
