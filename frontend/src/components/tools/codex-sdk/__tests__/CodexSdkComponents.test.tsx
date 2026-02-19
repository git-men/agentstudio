import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { CodexFileChangeTool } from '../CodexFileChangeTool';
import { CodexWebSearchTool } from '../CodexWebSearchTool';
import { CodexTodoListTool } from '../CodexTodoListTool';
import { CodexSdkToolRenderer } from '../CodexSdkToolRenderer';
import type { BaseToolExecution } from '../../sdk-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'codexFileChange.title': 'File Changes',
        'codexFileChange.filesCount': 'files',
        'codexFileChange.executing': 'Applying changes...',
        'codexFileChange.added': 'added',
        'codexFileChange.modified': 'modified',
        'codexFileChange.deleted': 'deleted',
        'codexFileChange.status': 'Status',
        'codexWebSearch.title': 'Web Search',
        'codexWebSearch.query': 'Query',
        'codexWebSearch.searching': 'Searching...',
        'codexWebSearch.completed': 'Search completed',
        'codexTodoList.title': 'Todo List',
        'codexTodoList.tasks': 'tasks',
        'codexTodoList.loading': 'Loading tasks...',
        'codexTodoList.completed': `${params?.completed ?? 0}/${params?.total ?? 0} completed`,
        'codexSdkToolRenderer.unknownTool': `Unknown tool: ${params?.toolName ?? ''}`,
      };
      return translations[key] || key;
    },
  }),
}));

function makeExecution(overrides: Partial<BaseToolExecution> = {}): BaseToolExecution {
  return {
    id: 'exec-1',
    toolName: 'test',
    toolInput: {} as any,
    isExecuting: false,
    timestamp: new Date(),
    ...overrides,
  };
}

function expandToolComponent(container: HTMLElement): void {
  const header = container.querySelector('[class*="cursor-pointer"]');
  if (header) fireEvent.click(header);
}

describe('CodexFileChangeTool', () => {
  it('renders subtitle with file count in collapsed state', () => {
    const execution = makeExecution({
      toolName: 'fileChangeToolCall',
      toolInput: {
        files: [
          { path: 'src/main.ts', changeType: 'modified' },
          { path: 'src/new.ts', changeType: 'added' },
          { path: 'src/old.ts', changeType: 'deleted' },
        ],
      } as any,
    });

    render(<CodexFileChangeTool execution={execution} />);
    expect(screen.getByText('3 files')).toBeDefined();
  });

  it('renders file list with change type indicators when expanded', () => {
    const execution = makeExecution({
      toolName: 'fileChangeToolCall',
      toolInput: {
        files: [
          { path: 'src/main.ts', changeType: 'modified' },
          { path: 'src/new.ts', changeType: 'added' },
          { path: 'src/old.ts', changeType: 'deleted' },
        ],
      } as any,
    });

    const { container } = render(<CodexFileChangeTool execution={execution} />);
    expandToolComponent(container);

    expect(screen.getByText('src/main.ts')).toBeDefined();
    expect(screen.getByText('src/new.ts')).toBeDefined();
    expect(screen.getByText('src/old.ts')).toBeDefined();

    expect(screen.getByText('+1 added')).toBeDefined();
    expect(screen.getByText('~1 modified')).toBeDefined();
    expect(screen.getByText('-1 deleted')).toBeDefined();
  });

  it('shows executing state when expanded', () => {
    const execution = makeExecution({
      toolName: 'fileChangeToolCall',
      toolInput: { files: [] } as any,
      isExecuting: true,
    });

    const { container } = render(<CodexFileChangeTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('Applying changes...')).toBeDefined();
  });

  it('shows status when completed with result', () => {
    const execution = makeExecution({
      toolName: 'fileChangeToolCall',
      toolInput: { files: [{ path: 'a.ts', changeType: 'added' }] } as any,
      toolResult: JSON.stringify({ status: 'completed', fileCount: 1, files: [] }),
    });

    const { container } = render(<CodexFileChangeTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText(/Status/)).toBeDefined();
    expect(screen.getByText(/completed/)).toBeDefined();
  });
});

describe('CodexWebSearchTool', () => {
  it('renders query text in subtitle (collapsed)', () => {
    const execution = makeExecution({
      toolName: 'webSearchToolCall',
      toolInput: { query: 'TypeScript async patterns' } as any,
    });

    render(<CodexWebSearchTool execution={execution} />);
    expect(screen.getByText('TypeScript async patterns')).toBeDefined();
  });

  it('renders query in detail when expanded', () => {
    const execution = makeExecution({
      toolName: 'webSearchToolCall',
      toolInput: { query: 'test query' } as any,
    });

    const { container } = render(<CodexWebSearchTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getAllByText('test query').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Search completed')).toBeDefined();
  });

  it('shows searching state when expanded and executing', () => {
    const execution = makeExecution({
      toolName: 'webSearchToolCall',
      toolInput: { query: 'test' } as any,
      isExecuting: true,
    });

    const { container } = render(<CodexWebSearchTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('Searching...')).toBeDefined();
  });
});

describe('CodexTodoListTool', () => {
  it('renders task count in subtitle (collapsed)', () => {
    const execution = makeExecution({
      toolName: 'todoListToolCall',
      toolInput: {
        tasks: [
          { text: 'Setup project', completed: true },
          { text: 'Write tests', completed: false },
        ],
      } as any,
    });

    render(<CodexTodoListTool execution={execution} />);
    expect(screen.getByText('1/2 tasks')).toBeDefined();
  });

  it('renders task items with checkbox states when expanded', () => {
    const execution = makeExecution({
      toolName: 'todoListToolCall',
      toolInput: {
        tasks: [
          { text: 'Setup project', completed: true },
          { text: 'Write tests', completed: false },
        ],
      } as any,
    });

    const { container } = render(<CodexTodoListTool execution={execution} />);
    expandToolComponent(container);

    expect(screen.getByText('Setup project')).toBeDefined();
    expect(screen.getByText('Write tests')).toBeDefined();
    expect(screen.getByText('✓')).toBeDefined();
    expect(screen.getByText('○')).toBeDefined();
  });

  it('shows loading state when executing with no tasks', () => {
    const execution = makeExecution({
      toolName: 'todoListToolCall',
      toolInput: { tasks: [] } as any,
      isExecuting: true,
    });

    const { container } = render(<CodexTodoListTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('Loading tasks...')).toBeDefined();
  });

  it('shows completion summary when not executing', () => {
    const execution = makeExecution({
      toolName: 'todoListToolCall',
      toolInput: {
        tasks: [
          { text: 'Task 1', completed: true },
          { text: 'Task 2', completed: true },
          { text: 'Task 3', completed: false },
        ],
      } as any,
    });

    const { container } = render(<CodexTodoListTool execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('2/3 completed')).toBeDefined();
  });
});

describe('CodexSdkToolRenderer', () => {
  it('dispatches fileChangeToolCall to CodexFileChangeTool', () => {
    const execution = makeExecution({
      toolName: 'fileChangeToolCall',
      toolInput: { files: [{ path: 'a.ts', changeType: 'added' }] } as any,
    });

    const { container } = render(<CodexSdkToolRenderer execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('a.ts')).toBeDefined();
  });

  it('dispatches webSearchToolCall to CodexWebSearchTool', () => {
    const execution = makeExecution({
      toolName: 'webSearchToolCall',
      toolInput: { query: 'test query' } as any,
    });

    render(<CodexSdkToolRenderer execution={execution} />);
    expect(screen.getByText('test query')).toBeDefined();
  });

  it('dispatches todoListToolCall to CodexTodoListTool', () => {
    const execution = makeExecution({
      toolName: 'todoListToolCall',
      toolInput: {
        tasks: [{ text: 'My task', completed: false }],
      } as any,
    });

    const { container } = render(<CodexSdkToolRenderer execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('My task')).toBeDefined();
  });

  it('falls back to BaseToolComponent for unknown tools', () => {
    const execution = makeExecution({
      toolName: 'unknownCodexTool',
      toolInput: { foo: 'bar' } as any,
    });

    const { container } = render(<CodexSdkToolRenderer execution={execution} />);
    expandToolComponent(container);
    expect(screen.getByText('Unknown tool: unknownCodexTool')).toBeDefined();
  });
});
