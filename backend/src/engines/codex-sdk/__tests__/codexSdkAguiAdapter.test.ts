import { describe, it, expect, beforeEach } from 'vitest';
import { CodexSdkAguiAdapter } from '../codexSdkAguiAdapter.js';

describe('CodexSdkAguiAdapter', () => {
  let adapter: CodexSdkAguiAdapter;

  beforeEach(() => {
    adapter = new CodexSdkAguiAdapter('test-thread-id');
  });

  describe('thread.started', () => {
    it('emits RUN_STARTED and session_id_updated CUSTOM event', () => {
      const events = adapter.convertThreadEvent({
        type: 'thread.started',
        thread_id: 'thread-123',
      });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('RUN_STARTED');
      expect((events[0] as any).threadId).toBe('thread-123');
      expect(events[1].type).toBe('CUSTOM');
      expect((events[1] as any).name).toBe('session_id_updated');
      expect((events[1] as any).data.sessionId).toBe('thread-123');
    });

    it('updates threadId returned by getThreadId()', () => {
      adapter.convertThreadEvent({ type: 'thread.started', thread_id: 'new-id' });
      expect(adapter.getThreadId()).toBe('new-id');
    });
  });

  describe('turn.started', () => {
    it('emits RUN_STARTED if not already started', () => {
      const events = adapter.convertThreadEvent({ type: 'turn.started' });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('RUN_STARTED');
    });

    it('emits nothing if run already started', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      const events = adapter.convertThreadEvent({ type: 'turn.started' });
      expect(events).toHaveLength(0);
    });
  });

  describe('turn.completed', () => {
    it('emits RUN_FINISHED', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      const events = adapter.convertThreadEvent({ type: 'turn.completed' });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('RUN_FINISHED');
    });
  });

  describe('turn.failed', () => {
    it('emits RUN_ERROR then RUN_FINISHED', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      const events = adapter.convertThreadEvent({
        type: 'turn.failed',
        error: { message: 'something broke' },
      });

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('RUN_ERROR');
      expect((events[0] as any).error).toBe('something broke');
      expect((events[0] as any).code).toBe('TURN_FAILED');
      expect(events[1].type).toBe('RUN_FINISHED');
    });
  });

  describe('error (top-level)', () => {
    it('emits RUN_ERROR', () => {
      const events = adapter.convertThreadEvent({
        type: 'error',
        message: 'fatal error',
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('RUN_ERROR');
      expect((events[0] as any).error).toBe('fatal error');
      expect((events[0] as any).code).toBe('SDK_ERROR');
    });
  });

  describe('agent_message lifecycle', () => {
    it('handles started → updated → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message' },
      });
      expect(started.some(e => e.type === 'TEXT_MESSAGE_START')).toBe(true);

      const updated = adapter.convertThreadEvent({
        type: 'item.updated',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
      });
      expect(updated).toHaveLength(1);
      expect(updated[0].type).toBe('TEXT_MESSAGE_CONTENT');
      expect((updated[0] as any).content).toBe('Hello');

      const updated2 = adapter.convertThreadEvent({
        type: 'item.updated',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello world' },
      });
      expect(updated2).toHaveLength(1);
      expect((updated2[0] as any).content).toBe(' world');

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'msg-1', type: 'agent_message', text: 'Hello world' },
      });
      expect(completed.some(e => e.type === 'TEXT_MESSAGE_END')).toBe(true);
    });
  });

  describe('reasoning lifecycle', () => {
    it('handles started → updated → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'think-1', type: 'reasoning' },
      });
      expect(started.some(e => e.type === 'THINKING_START')).toBe(true);

      const updated = adapter.convertThreadEvent({
        type: 'item.updated',
        item: { id: 'think-1', type: 'reasoning', text: 'Let me think...' },
      });
      expect(updated[0].type).toBe('THINKING_CONTENT');
      expect((updated[0] as any).content).toBe('Let me think...');

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'think-1', type: 'reasoning', text: 'Let me think...' },
      });
      expect(completed.some(e => e.type === 'THINKING_END')).toBe(true);
    });
  });

  describe('command_execution lifecycle', () => {
    it('handles started → updated → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'ls -la' },
      });
      expect(started.some(e => e.type === 'TOOL_CALL_START' && (e as any).toolName === 'shellToolCall')).toBe(true);
      expect(started.some(e => e.type === 'TOOL_CALL_ARGS')).toBe(true);

      adapter.convertThreadEvent({
        type: 'item.updated',
        item: { id: 'cmd-1', type: 'command_execution', aggregated_output: 'file1.txt\nfile2.txt' },
      });

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'cmd-1', type: 'command_execution', exit_code: 0, aggregated_output: 'file1.txt\nfile2.txt' },
      });
      expect(completed.some(e => e.type === 'TOOL_CALL_END')).toBe(true);
      expect(completed.some(e => e.type === 'TOOL_CALL_RESULT')).toBe(true);

      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      const parsed = JSON.parse(result.result);
      expect(parsed.exit_code).toBe(0);
      expect(result.isError).toBe(false);
    });

    it('marks non-zero exit code as error', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'cmd-2', type: 'command_execution', command: 'false' },
      });
      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'cmd-2', type: 'command_execution', exit_code: 1, aggregated_output: '' },
      });
      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      expect(result.isError).toBe(true);
    });
  });

  describe('file_change lifecycle', () => {
    it('handles started → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: {
          id: 'fc-1',
          type: 'file_change',
          changes: [
            { path: 'src/main.ts', kind: 'update' },
            { path: 'src/new.ts', kind: 'add' },
          ],
        },
      });
      expect(started.some(e => e.type === 'TOOL_CALL_START' && (e as any).toolName === 'fileChangeToolCall')).toBe(true);

      const argsEvent = started.find(e => e.type === 'TOOL_CALL_ARGS') as any;
      const argsData = JSON.parse(argsEvent.args);
      expect(argsData.files[0].changeType).toBe('modified');
      expect(argsData.files[1].changeType).toBe('added');

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: {
          id: 'fc-1',
          type: 'file_change',
          changes: [
            { path: 'src/main.ts', kind: 'update' },
            { path: 'src/new.ts', kind: 'add' },
          ],
          status: 'completed',
        },
      });
      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      const resultData = JSON.parse(result.result);
      expect(resultData.fileCount).toBe(2);
      expect(resultData.status).toBe('completed');
    });
  });

  describe('web_search lifecycle', () => {
    it('handles started → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'ws-1', type: 'web_search', query: 'TypeScript async generators' },
      });
      expect(started.some(e => e.type === 'TOOL_CALL_START' && (e as any).toolName === 'webSearchToolCall')).toBe(true);

      const argsEvent = started.find(e => e.type === 'TOOL_CALL_ARGS') as any;
      expect(JSON.parse(argsEvent.args).query).toBe('TypeScript async generators');

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'ws-1', type: 'web_search', query: 'TypeScript async generators' },
      });
      expect(completed.some(e => e.type === 'TOOL_CALL_END')).toBe(true);
      expect(completed.some(e => e.type === 'TOOL_CALL_RESULT')).toBe(true);
    });
  });

  describe('todo_list lifecycle', () => {
    it('handles started → updated → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [{ text: 'Task 1', completed: false }],
        },
      });
      expect(started.some(e => e.type === 'TOOL_CALL_START' && (e as any).toolName === 'todoListToolCall')).toBe(true);

      const argsEvent = started.find(e => e.type === 'TOOL_CALL_ARGS') as any;
      expect(JSON.parse(argsEvent.args).tasks).toHaveLength(1);

      const updated = adapter.convertThreadEvent({
        type: 'item.updated',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Task 1', completed: true },
            { text: 'Task 2', completed: false },
          ],
        },
      });
      expect(updated).toHaveLength(1);
      expect(updated[0].type).toBe('TOOL_CALL_ARGS');
      const updatedTasks = JSON.parse((updated[0] as any).args).tasks;
      expect(updatedTasks).toHaveLength(2);
      expect(updatedTasks[0].completed).toBe(true);

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: {
          id: 'todo-1',
          type: 'todo_list',
          items: [
            { text: 'Task 1', completed: true },
            { text: 'Task 2', completed: true },
          ],
        },
      });
      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      const resultData = JSON.parse(result.result);
      expect(resultData.taskCount).toBe(2);
      expect(resultData.completedCount).toBe(2);
    });
  });

  describe('mcp_tool_call lifecycle', () => {
    it('handles started → completed', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });

      const started = adapter.convertThreadEvent({
        type: 'item.started',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'my-server',
          tool: 'do_thing',
          arguments: { key: 'value' },
        },
      });

      const startEvent = started.find(e => e.type === 'TOOL_CALL_START') as any;
      expect(startEvent.toolName).toBe('mcp__my-server__do_thing');

      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'my-server',
          tool: 'do_thing',
          result: { content: [], structured_content: {} },
          status: 'completed',
        },
      });
      expect(completed.some(e => e.type === 'TOOL_CALL_END')).toBe(true);
      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      expect(result.isError).toBe(false);
    });

    it('marks failed mcp calls as error', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'mcp-2', type: 'mcp_tool_call', server: 's', tool: 't', arguments: {} },
      });
      const completed = adapter.convertThreadEvent({
        type: 'item.completed',
        item: {
          id: 'mcp-2',
          type: 'mcp_tool_call',
          server: 's',
          tool: 't',
          error: { message: 'boom' },
          status: 'failed',
        },
      });
      const result = completed.find(e => e.type === 'TOOL_CALL_RESULT') as any;
      expect(result.isError).toBe(true);
    });
  });

  describe('error item', () => {
    it('emits RUN_ERROR on item.completed with type error', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      const events = adapter.convertThreadEvent({
        type: 'item.completed',
        item: { id: 'err-1', type: 'error', message: 'Something went wrong' },
      });
      expect(events.some(e => e.type === 'RUN_ERROR' && (e as any).error === 'Something went wrong')).toBe(true);
    });
  });

  describe('finalize()', () => {
    it('emits RUN_FINISHED when stream ends unexpectedly', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      const events = adapter.finalize();
      expect(events.some(e => e.type === 'RUN_FINISHED')).toBe(true);
    });

    it('closes open messages and thinking blocks', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message' },
      });

      const events = adapter.finalize();
      expect(events.some(e => e.type === 'TEXT_MESSAGE_END')).toBe(true);
      expect(events.some(e => e.type === 'RUN_FINISHED')).toBe(true);
    });

    it('closes active tool calls', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'sleep 999' },
      });

      const events = adapter.finalize();
      expect(events.some(e => e.type === 'TOOL_CALL_END')).toBe(true);
      expect(events.some(e => e.type === 'TOOL_CALL_RESULT')).toBe(true);
      expect(events.some(e => e.type === 'RUN_FINISHED')).toBe(true);
    });
  });

  describe('event ordering', () => {
    it('closes thinking before opening message', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'think-1', type: 'reasoning' },
      });

      const events = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message' },
      });

      const thinkingEndIdx = events.findIndex(e => e.type === 'THINKING_END');
      const msgStartIdx = events.findIndex(e => e.type === 'TEXT_MESSAGE_START');
      expect(thinkingEndIdx).toBeLessThan(msgStartIdx);
    });

    it('closes message before opening tool call', () => {
      adapter.convertThreadEvent({ type: 'turn.started' });
      adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'msg-1', type: 'agent_message' },
      });

      const events = adapter.convertThreadEvent({
        type: 'item.started',
        item: { id: 'cmd-1', type: 'command_execution', command: 'ls' },
      });

      const msgEndIdx = events.findIndex(e => e.type === 'TEXT_MESSAGE_END');
      const toolStartIdx = events.findIndex(e => e.type === 'TOOL_CALL_START');
      expect(msgEndIdx).toBeLessThan(toolStartIdx);
    });
  });
});
