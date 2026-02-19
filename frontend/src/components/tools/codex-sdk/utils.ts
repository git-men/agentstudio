/**
 * Codex SDK tool utility functions
 */

import type { CodexSdkToolName } from './types';

const CODEX_SDK_TOOLS: Set<string> = new Set([
  'fileChangeToolCall',
  'webSearchToolCall',
  'todoListToolCall',
]);

export function isCodexSdkTool(toolName: string): toolName is CodexSdkToolName {
  return CODEX_SDK_TOOLS.has(toolName);
}

const DISPLAY_NAMES: Record<CodexSdkToolName, string> = {
  fileChangeToolCall: 'File Changes',
  webSearchToolCall: 'Web Search',
  todoListToolCall: 'Todo List',
};

export function getCodexSdkToolDisplayName(toolName: string): string {
  return DISPLAY_NAMES[toolName as CodexSdkToolName] || toolName;
}
