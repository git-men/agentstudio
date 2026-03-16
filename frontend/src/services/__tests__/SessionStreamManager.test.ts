import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionStreamManager } from '../SessionStreamManager';
import { createSessionStore } from '../../stores/createSessionStore';
import type { SessionState, SessionActions } from '../../stores/createSessionStore';
import type { StoreApi } from 'zustand';

vi.mock('../frontendToolRegistry', () => ({
  isFrontendToolName: () => false,
  extractFrontendToolShortName: (name: string) => name,
}));

describe('SessionStreamManager', () => {
  let store: StoreApi<SessionState & SessionActions>;
  let manager: SessionStreamManager;

  beforeEach(() => {
    store = createSessionStore('session-1', 'agent-1');
    manager = new SessionStreamManager(store);
    manager.setTranslateFn((key) => key);
  });

  describe('SSE event processing', () => {
    it('processes message_start and creates assistant message', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
        sessionId: 'session-1',
      });

      expect(store.getState().messages.length).toBe(1);
      expect(store.getState().messages[0].role).toBe('assistant');
    });

    it('processes text content_block_start and content_block_delta', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hello world' },
        },
      });

      const msg = store.getState().messages[0];
      expect(msg.messageParts).toBeDefined();
      expect(msg.messageParts!.length).toBeGreaterThan(0);
      expect(msg.messageParts![0].type).toBe('text');
    });

    it('processes thinking content block', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        },
      });

      const msg = store.getState().messages[0];
      expect(msg.messageParts!.some((p: any) => p.type === 'thinking')).toBe(true);
    });

    it('processes tool_use content block with JSON accumulation', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'read_file', input: {} },
        },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"path": "/test' },
        },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '.txt"}' },
        },
      });

      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 0 },
      });

      const msg = store.getState().messages[0];
      const toolPart = msg.messageParts!.find((p: any) => p.type === 'tool') as any;
      expect(toolPart).toBeDefined();
      expect(toolPart.toolData.toolName).toBe('read_file');
      expect(toolPart.toolData.toolInput).toEqual({ path: '/test.txt' });
    });

    it('processes non-streaming assistant message', () => {
      manager.handleStreamMessage({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello' }],
          role: 'assistant',
        },
      });

      expect(store.getState().messages.length).toBe(1);
      const msg = store.getState().messages[0];
      expect(msg.messageParts!.some((p: any) => p.type === 'text' && p.content === 'Hello')).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('handleStreamError writes error to bound store only', () => {
      manager.handleStreamError(new Error('Network failed'));

      expect(store.getState().isAiTyping).toBe(false);
      expect(store.getState().status).toBe('error');
      expect(store.getState().messages.length).toBe(1);
      expect(store.getState().messages[0].role).toBe('assistant');
    });

    it('handleStreamError ignores AbortError', () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      manager.handleStreamError(abortError);

      expect(store.getState().messages.length).toBe(0);
    });

    it('error event sets status to error via handleErrorEvent', () => {
      manager.handleStreamMessage({
        type: 'error',
        error: 'test error',
        message: 'Something went wrong',
      });

      expect(store.getState().isAiTyping).toBe(false);
      expect(store.getState().messages.length).toBe(1);
    });
  });

  describe('abort()', () => {
    it('calls AbortController.abort()', () => {
      const controller = new AbortController();
      const abortSpy = vi.spyOn(controller, 'abort');
      manager.setAbortController(controller);
      manager.abort();
      expect(abortSpy).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('cancels RAF, aborts controller, clears internal state', () => {
      const controller = new AbortController();
      manager.setAbortController(controller);

      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      manager.dispose();

      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe('Multi-instance isolation (3 concurrent instances per F02)', () => {
    it('three SessionStreamManagers writing to different stores do not cross-contaminate', () => {
      const storeA = createSessionStore('session-a', 'agent-1');
      const storeB = createSessionStore('session-b', 'agent-1');
      const storeC = createSessionStore('session-c', 'agent-1');

      const managerA = new SessionStreamManager(storeA);
      const managerB = new SessionStreamManager(storeB);
      const managerC = new SessionStreamManager(storeC);

      managerA.setTranslateFn((k) => k);
      managerB.setTranslateFn((k) => k);
      managerC.setTranslateFn((k) => k);

      managerA.handleStreamMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'From A' }], role: 'assistant' },
      });

      managerB.handleStreamMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'From B' }], role: 'assistant' },
      });

      managerC.handleStreamMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'From C' }], role: 'assistant' },
      });

      expect(storeA.getState().messages.length).toBe(1);
      expect(storeB.getState().messages.length).toBe(1);
      expect(storeC.getState().messages.length).toBe(1);

      const textA = storeA.getState().messages[0].messageParts!.find((p: any) => p.type === 'text') as any;
      const textB = storeB.getState().messages[0].messageParts!.find((p: any) => p.type === 'text') as any;
      const textC = storeC.getState().messages[0].messageParts!.find((p: any) => p.type === 'text') as any;

      expect(textA.content).toBe('From A');
      expect(textB.content).toBe('From B');
      expect(textC.content).toBe('From C');
    });

    it('error in one manager does not affect others', () => {
      const storeA = createSessionStore('session-a', 'agent-1');
      const storeB = createSessionStore('session-b', 'agent-1');
      const storeC = createSessionStore('session-c', 'agent-1');

      const managerA = new SessionStreamManager(storeA);
      const managerB = new SessionStreamManager(storeB);
      const managerC = new SessionStreamManager(storeC);

      managerA.setTranslateFn((k) => k);
      managerB.setTranslateFn((k) => k);
      managerC.setTranslateFn((k) => k);

      managerA.handleStreamError(new Error('Session A failed'));

      managerB.handleStreamMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'B is fine' }], role: 'assistant' },
      });

      managerC.handleStreamMessage({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'C is fine' }], role: 'assistant' },
      });

      expect(storeA.getState().status).toBe('error');
      expect(storeA.getState().messages.length).toBe(1);

      expect(storeB.getState().status).toBe('idle');
      expect(storeB.getState().messages.length).toBe(1);

      expect(storeC.getState().status).toBe('idle');
      expect(storeC.getState().messages.length).toBe(1);
    });
  });

  describe('Result event', () => {
    it('result success sets status to completed and stops typing', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      store.getState().setAiTyping(true);

      manager.handleStreamMessage({
        type: 'result',
        subtype: 'success',
        result: 'Task done',
      });

      expect(store.getState().isAiTyping).toBe(false);
      expect(store.getState().status).toBe('completed');
    });
  });

  describe('MCP status events', () => {
    it('processes mcp_status connection_success', () => {
      manager.handleStreamMessage({
        type: 'mcp_status',
        subtype: 'connection_success',
        connectedServers: [{ name: 'server-1', status: 'ok' }],
      });

      expect(store.getState().mcpStatus.connectedServers).toHaveLength(1);
      expect(store.getState().mcpStatus.hasError).toBe(false);
    });

    it('processes mcp_status connection_failed', () => {
      manager.handleStreamMessage({
        type: 'mcp_status',
        subtype: 'connection_failed',
        failedServers: [{ name: 'server-1', status: 'error' }],
      });

      expect(store.getState().mcpStatus.hasError).toBe(true);
    });
  });

  describe('resetMessageId', () => {
    it('resets message tracking state', () => {
      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-1', role: 'assistant', content: [] } },
      });

      manager.resetMessageId();

      manager.handleStreamMessage({
        type: 'stream_event',
        event: { type: 'message_start', message: { id: 'msg-2', role: 'assistant', content: [] } },
      });

      expect(store.getState().messages.length).toBe(2);
    });
  });
});
