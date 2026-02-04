/**
 * Unit tests for CursorA2AAdapter
 * Tests AGUI to A2A protocol conversion functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CursorA2AAdapter,
  convertAGUIEventsToA2A,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
  type A2AStreamingResponse,
  type A2ATaskStatusUpdateEvent,
  type A2ATaskArtifactUpdateEvent,
  type A2AMessage,
} from '../a2aAdapter.js';
import type { AGUIEvent } from '../../types.js';

describe('CursorA2AAdapter', () => {
  let adapter: CursorA2AAdapter;

  beforeEach(() => {
    adapter = new CursorA2AAdapter({
      taskId: 'test-task-123',
      contextId: 'test-context-456',
      requestId: 'test-request-789',
    });
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      expect(adapter.getTaskId()).toBe('test-task-123');
      expect(adapter.getContextId()).toBe('test-context-456');
    });

    it('should generate UUIDs when options not provided', () => {
      const defaultAdapter = new CursorA2AAdapter();
      expect(defaultAdapter.getTaskId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(defaultAdapter.getContextId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('convertEvent - RUN_STARTED', () => {
    it('should emit status-update with working state', () => {
      const event: AGUIEvent = { type: 'RUN_STARTED' };
      const responses = adapter.convertEvent(event);

      expect(responses).toHaveLength(1);
      expect(responses[0].jsonrpc).toBe('2.0');
      expect(responses[0].id).toBe('test-request-789');

      const result = responses[0].result as A2ATaskStatusUpdateEvent;
      expect(result.kind).toBe('status-update');
      expect(result.taskId).toBe('test-task-123');
      expect(result.contextId).toBe('test-context-456');
      expect(result.status.state).toBe('working');
      expect(result.final).toBe(false);
    });
  });

  describe('convertEvent - TEXT_MESSAGE flow', () => {
    it('should accumulate text content across TEXT_MESSAGE events', () => {
      // Start message
      adapter.convertEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' } as AGUIEvent);

      // Add content incrementally
      const contentResponse1 = adapter.convertEvent({
        type: 'TEXT_MESSAGE_CONTENT',
        content: 'Hello ',
      } as AGUIEvent);

      expect(contentResponse1).toHaveLength(1);
      const msg1 = contentResponse1[0].result as A2AMessage;
      expect(msg1.kind).toBe('message');
      expect(msg1.role).toBe('agent');
      expect(msg1.parts[0]).toMatchObject({
        kind: 'text',
        text: 'Hello ',
        metadata: { partial: true },
      });

      // Add more content
      const contentResponse2 = adapter.convertEvent({
        type: 'TEXT_MESSAGE_CONTENT',
        content: 'World!',
      } as AGUIEvent);

      const msg2 = contentResponse2[0].result as A2AMessage;
      expect(msg2.parts[0]).toMatchObject({
        kind: 'text',
        text: 'Hello World!',
        metadata: { partial: true },
      });

      // End message
      const endResponse = adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);

      expect(endResponse).toHaveLength(1);
      const finalMsg = endResponse[0].result as A2AMessage;
      expect(finalMsg.parts[0]).toMatchObject({
        kind: 'text',
        text: 'Hello World!',
      });
      // Final message should not have partial flag
      expect(finalMsg.parts[0].metadata?.partial).toBeUndefined();
    });

    it('should handle empty content gracefully', () => {
      adapter.convertEvent({ type: 'TEXT_MESSAGE_START' } as AGUIEvent);
      const response = adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);

      // No message emitted for empty content
      expect(response).toHaveLength(0);
    });
  });

  describe('convertEvent - TOOL_CALL flow', () => {
    it('should emit artifact updates for tool calls', () => {
      // Start tool call
      const startResponse = adapter.convertEvent({
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-1',
        toolName: 'read_file',
      } as AGUIEvent);

      expect(startResponse).toHaveLength(1);
      const startArtifact = startResponse[0].result as A2ATaskArtifactUpdateEvent;
      expect(startArtifact.kind).toBe('artifact-update');
      expect(startArtifact.artifact.name).toBe('Tool: read_file');
      expect(startArtifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'tool_invocation',
          toolName: 'read_file',
          status: 'started',
        },
      });

      // Add arguments
      adapter.convertEvent({
        type: 'TOOL_CALL_ARGS',
        args: '{"path": "/test/file.ts"}',
      } as AGUIEvent);

      // End tool call
      const endResponse = adapter.convertEvent({ type: 'TOOL_CALL_END' } as AGUIEvent);

      expect(endResponse).toHaveLength(1);
      const endArtifact = endResponse[0].result as A2ATaskArtifactUpdateEvent;
      expect(endArtifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'tool_invocation',
          toolName: 'read_file',
          arguments: { path: '/test/file.ts' },
          status: 'executing',
        },
      });

      // Tool result
      const resultResponse = adapter.convertEvent({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tool-1',
        result: '{"content": "file contents"}',
        isError: false,
      } as AGUIEvent);

      expect(resultResponse).toHaveLength(1);
      const resultArtifact = resultResponse[0].result as A2ATaskArtifactUpdateEvent;
      expect(resultArtifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'tool_result',
          toolCallId: 'tool-1',
          result: { content: 'file contents' },
          isError: false,
          status: 'completed',
        },
      });
      expect(resultArtifact.lastChunk).toBe(true);
    });

    it('should handle tool errors correctly', () => {
      adapter.convertEvent({
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-2',
        toolName: 'execute_command',
      } as AGUIEvent);

      const resultResponse = adapter.convertEvent({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tool-2',
        result: 'Command failed: permission denied',
        isError: true,
      } as AGUIEvent);

      const resultArtifact = resultResponse[0].result as A2ATaskArtifactUpdateEvent;
      expect(resultArtifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'tool_result',
          isError: true,
        },
      });
    });
  });

  describe('convertEvent - RUN_FINISHED', () => {
    it('should emit completed status with final message', () => {
      // Add some message content first
      adapter.convertEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_CONTENT', content: 'Task done!' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);

      const response = adapter.convertEvent({ type: 'RUN_FINISHED' } as AGUIEvent);

      expect(response).toHaveLength(1);
      const status = response[0].result as A2ATaskStatusUpdateEvent;
      expect(status.kind).toBe('status-update');
      expect(status.status.state).toBe('completed');
      expect(status.final).toBe(true);
      expect(status.status.message?.parts[0]).toMatchObject({
        kind: 'text',
        text: 'Task done!',
      });
    });
  });

  describe('convertEvent - RUN_ERROR', () => {
    it('should emit failed status with error message', () => {
      const response = adapter.convertEvent({
        type: 'RUN_ERROR',
        error: 'Something went wrong',
        code: 'EXECUTION_ERROR',
      } as AGUIEvent);

      expect(response).toHaveLength(1);
      const status = response[0].result as A2ATaskStatusUpdateEvent;
      expect(status.kind).toBe('status-update');
      expect(status.status.state).toBe('failed');
      expect(status.final).toBe(true);
      expect(status.status.message?.parts[0]).toMatchObject({
        kind: 'text',
        text: 'Error: Something went wrong',
      });
    });
  });

  describe('convertEvent - THINKING events', () => {
    it('should emit thinking content as internal artifact', () => {
      const response = adapter.convertEvent({
        type: 'THINKING_CONTENT',
        content: 'Let me analyze this...',
      } as AGUIEvent);

      expect(response).toHaveLength(1);
      const artifact = response[0].result as A2ATaskArtifactUpdateEvent;
      expect(artifact.kind).toBe('artifact-update');
      expect(artifact.artifact.name).toBe('Agent Thinking');
      expect(artifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'thinking',
          content: 'Let me analyze this...',
        },
      });
      expect(artifact.artifact.metadata?.internal).toBe(true);
    });

    it('should not emit for THINKING_START and THINKING_END', () => {
      const startResponse = adapter.convertEvent({ type: 'THINKING_START' } as AGUIEvent);
      const endResponse = adapter.convertEvent({ type: 'THINKING_END' } as AGUIEvent);

      expect(startResponse).toHaveLength(0);
      expect(endResponse).toHaveLength(0);
    });
  });

  describe('convertEvent - RAW', () => {
    it('should pass through raw events as artifacts', () => {
      const response = adapter.convertEvent({
        type: 'RAW',
        source: 'cursor',
        event: { type: 'system', action: 'init' },
      } as AGUIEvent);

      expect(response).toHaveLength(1);
      const artifact = response[0].result as A2ATaskArtifactUpdateEvent;
      expect(artifact.artifact.name).toBe('Raw Event');
      expect(artifact.artifact.parts[0]).toMatchObject({
        kind: 'data',
        data: {
          type: 'raw_event',
          source: 'cursor',
          event: { type: 'system', action: 'init' },
        },
      });
    });
  });

  describe('createTask', () => {
    it('should create a complete A2A Task object', () => {
      // Simulate a complete flow
      adapter.convertEvent({ type: 'RUN_STARTED' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_CONTENT', content: 'Result' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);
      adapter.convertEvent({ type: 'RUN_FINISHED' } as AGUIEvent);

      const task = adapter.createTask();

      expect(task.id).toBe('test-task-123');
      expect(task.contextId).toBe('test-context-456');
      expect(task.status.state).toBe('completed');
      expect(task.history).toHaveLength(1);
      expect(task.history![0].parts[0]).toMatchObject({
        kind: 'text',
        text: 'Result',
      });
    });

    it('should include artifacts when tool calls were made', () => {
      adapter.convertEvent({ type: 'RUN_STARTED' } as AGUIEvent);
      adapter.convertEvent({
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-1',
        toolName: 'test_tool',
      } as AGUIEvent);
      adapter.convertEvent({
        type: 'TOOL_CALL_RESULT',
        toolCallId: 'tool-1',
        result: 'success',
        isError: false,
      } as AGUIEvent);
      adapter.convertEvent({ type: 'RUN_FINISHED' } as AGUIEvent);

      const task = adapter.createTask();

      expect(task.artifacts).toBeDefined();
      expect(task.artifacts!.length).toBeGreaterThan(0);
    });
  });

  describe('getResponseText', () => {
    it('should return concatenated text from all agent messages', () => {
      adapter.convertEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_CONTENT', content: 'First ' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);

      adapter.convertEvent({ type: 'TEXT_MESSAGE_START', messageId: 'msg-2' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_CONTENT', content: 'Second' } as AGUIEvent);
      adapter.convertEvent({ type: 'TEXT_MESSAGE_END' } as AGUIEvent);

      const text = adapter.getResponseText();
      expect(text).toBe('First \nSecond');
    });

    it('should return empty string when no messages', () => {
      const text = adapter.getResponseText();
      expect(text).toBe('');
    });
  });

  describe('formatAsSSE', () => {
    it('should format response as SSE data line', () => {
      const response: A2AStreamingResponse = {
        jsonrpc: '2.0',
        id: 'test-id',
        result: {
          kind: 'status-update',
          taskId: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'working' },
        },
      };

      const sse = CursorA2AAdapter.formatAsSSE(response);
      expect(sse).toBe(`data: ${JSON.stringify(response)}\n\n`);
    });
  });
});

describe('convertAGUIEventsToA2A', () => {
  it('should convert a batch of events', () => {
    const events: AGUIEvent[] = [
      { type: 'RUN_STARTED' },
      { type: 'TEXT_MESSAGE_START', messageId: 'msg-1' } as AGUIEvent,
      { type: 'TEXT_MESSAGE_CONTENT', content: 'Hello' } as AGUIEvent,
      { type: 'TEXT_MESSAGE_END' } as AGUIEvent,
      { type: 'RUN_FINISHED' },
    ];

    const responses = convertAGUIEventsToA2A(events, {
      taskId: 'batch-task',
      contextId: 'batch-context',
      requestId: 'batch-request',
    });

    // Should have: status-update(working), message(partial), message(final), status-update(completed)
    expect(responses.length).toBeGreaterThanOrEqual(4);

    // First response should be working status
    expect((responses[0].result as A2ATaskStatusUpdateEvent).status.state).toBe('working');

    // Last response should be completed status
    const lastResponse = responses[responses.length - 1];
    expect((lastResponse.result as A2ATaskStatusUpdateEvent).status.state).toBe('completed');
  });

  it('should use provided task/context IDs', () => {
    const events: AGUIEvent[] = [{ type: 'RUN_STARTED' }];

    const responses = convertAGUIEventsToA2A(events, {
      taskId: 'custom-task',
      contextId: 'custom-context',
    });

    const result = responses[0].result as A2ATaskStatusUpdateEvent;
    expect(result.taskId).toBe('custom-task');
    expect(result.contextId).toBe('custom-context');
  });
});

describe('createA2AErrorResponse', () => {
  it('should create proper JSON-RPC error response', () => {
    const error = createA2AErrorResponse(
      'Task not found',
      A2A_ERROR_CODES.TASK_NOT_FOUND,
      'req-123',
      { taskId: 'missing-task' }
    );

    expect(error).toEqual({
      jsonrpc: '2.0',
      id: 'req-123',
      error: {
        code: -32001,
        message: 'Task not found',
        data: { taskId: 'missing-task' },
      },
    });
  });

  it('should work without optional data', () => {
    const error = createA2AErrorResponse(
      'Internal error',
      A2A_ERROR_CODES.INTERNAL_ERROR,
      'req-456'
    );

    expect(error.error.data).toBeUndefined();
    expect(error.error.code).toBe(-32603);
  });
});

describe('A2A_ERROR_CODES', () => {
  it('should have standard JSON-RPC error codes', () => {
    expect(A2A_ERROR_CODES.PARSE_ERROR).toBe(-32700);
    expect(A2A_ERROR_CODES.INVALID_REQUEST).toBe(-32600);
    expect(A2A_ERROR_CODES.METHOD_NOT_FOUND).toBe(-32601);
    expect(A2A_ERROR_CODES.INVALID_PARAMS).toBe(-32602);
    expect(A2A_ERROR_CODES.INTERNAL_ERROR).toBe(-32603);
  });

  it('should have A2A-specific error codes', () => {
    expect(A2A_ERROR_CODES.TASK_NOT_FOUND).toBe(-32001);
    expect(A2A_ERROR_CODES.TASK_CANCELED).toBe(-32002);
    expect(A2A_ERROR_CODES.TASK_FAILED).toBe(-32003);
    expect(A2A_ERROR_CODES.UNAUTHORIZED).toBe(-32004);
    expect(A2A_ERROR_CODES.RATE_LIMITED).toBe(-32005);
  });
});
