import { describe, it, expect } from 'vitest';
import { CodexAguiAdapter } from '../aguiAdapter.js';

function parse(adapter: CodexAguiAdapter, event: Record<string, unknown>) {
  return adapter.parseStreamLine(JSON.stringify(event));
}

describe('CodexAguiAdapter', () => {
  it('maps thread.started to RUN_STARTED and session update', () => {
    const adapter = new CodexAguiAdapter('initial-thread', 'run-1');
    const events = parse(adapter, { type: 'thread.started', thread_id: 'thread-123' });

    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'CUSTOM']);
    expect((events[0] as any).threadId).toBe('thread-123');
    expect((events[1] as any).name).toBe('session_id_updated');
    expect((events[1] as any).data.sessionId).toBe('thread-123');
  });

  it('maps item.completed(reasoning) to thinking events', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const events = parse(adapter, {
      type: 'item.completed',
      item: { id: 'item-1', type: 'reasoning', text: 'thinking...' },
    });

    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'THINKING_START',
      'THINKING_CONTENT',
      'THINKING_END',
    ]);
    expect((events[2] as any).content).toBe('thinking...');
  });

  it('maps item.completed(agent_message) to text message events', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const events = parse(adapter, {
      type: 'item.completed',
      item: { id: 'item-2', type: 'agent_message', text: 'hello from codex' },
    });

    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ]);
    expect((events[2] as any).content).toBe('hello from codex');
  });

  it('closes open text stream on turn.completed and emits RUN_FINISHED once', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const deltaEvents = parse(adapter, { type: 'agent_message.delta', delta: 'partial' });
    expect(deltaEvents.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
    ]);

    const doneEvents = parse(adapter, { type: 'turn.completed' });
    expect(doneEvents.map((e) => e.type)).toEqual(['TEXT_MESSAGE_END', 'RUN_FINISHED']);

    const finalized = adapter.finalize();
    expect(finalized).toHaveLength(0);
  });

  it('maps exec command lifecycle to tool events', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');

    const beginEvents = parse(adapter, {
      type: 'exec_command.begin',
      call_id: 'tool-1',
      parsed_cmd: ['echo', 'hello'],
      cwd: '/tmp',
    });

    expect(beginEvents.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
    ]);
    expect((beginEvents[1] as any).toolName).toBe('shellToolCall');

    parse(adapter, {
      type: 'exec_command.output_delta',
      call_id: 'tool-1',
      chunk: 'hello\\n',
    });

    const endEvents = parse(adapter, {
      type: 'exec_command.end',
      call_id: 'tool-1',
      exit_code: 0,
      status: 'completed',
    });

    expect(endEvents.map((e) => e.type)).toEqual(['TOOL_CALL_END', 'TOOL_CALL_RESULT']);
    expect((endEvents[1] as any).result).toContain('hello');
    expect((endEvents[1] as any).isError).toBe(false);
  });

  it('maps mcp_tool_call_begin to normalized MCP tool name', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const events = parse(adapter, {
      type: 'mcp_tool_call.begin',
      call_id: 'mcp-1',
      invocation: {
        server: 'filesystem',
        tool: 'read_file',
        arguments: { path: '/tmp/a.txt' },
      },
    });

    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
    ]);
    expect((events[1] as any).toolName).toBe('mcp__filesystem__read_file');
  });

  it('maps stream error to RUN_ERROR', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const events = parse(adapter, { type: 'stream.error', message: 'boom' });

    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_ERROR']);
    expect((events[1] as any).error).toContain('boom');
  });

  it('finalize emits minimum lifecycle when no events were seen', () => {
    const adapter = new CodexAguiAdapter('thread-1', 'run-1');
    const events = adapter.finalize();

    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
  });
});
