import { describe, it, expect } from 'vitest';
import { isCodexSdkTool, getCodexSdkToolDisplayName } from '../utils';

describe('isCodexSdkTool()', () => {
  it('identifies fileChangeToolCall', () => {
    expect(isCodexSdkTool('fileChangeToolCall')).toBe(true);
  });

  it('identifies webSearchToolCall', () => {
    expect(isCodexSdkTool('webSearchToolCall')).toBe(true);
  });

  it('identifies todoListToolCall', () => {
    expect(isCodexSdkTool('todoListToolCall')).toBe(true);
  });

  it('rejects non-Codex SDK tools', () => {
    expect(isCodexSdkTool('Bash')).toBe(false);
    expect(isCodexSdkTool('Read')).toBe(false);
    expect(isCodexSdkTool('Edit')).toBe(false);
    expect(isCodexSdkTool('shellToolCall')).toBe(false);
    expect(isCodexSdkTool('')).toBe(false);
    expect(isCodexSdkTool('unknown_tool')).toBe(false);
  });
});

describe('getCodexSdkToolDisplayName()', () => {
  it('returns display name for known tools', () => {
    expect(getCodexSdkToolDisplayName('fileChangeToolCall')).toBe('File Changes');
    expect(getCodexSdkToolDisplayName('webSearchToolCall')).toBe('Web Search');
    expect(getCodexSdkToolDisplayName('todoListToolCall')).toBe('Todo List');
  });

  it('returns raw tool name for unknown tools', () => {
    expect(getCodexSdkToolDisplayName('unknownTool')).toBe('unknownTool');
  });
});
