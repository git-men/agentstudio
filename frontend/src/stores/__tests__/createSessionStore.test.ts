import { describe, it, expect, beforeEach } from 'vitest';
import { createSessionStore } from '../createSessionStore';
import type { SessionState, SessionActions } from '../createSessionStore';
import type { StoreApi } from 'zustand';

describe('createSessionStore', () => {
  let storeA: StoreApi<SessionState & SessionActions>;
  let storeB: StoreApi<SessionState & SessionActions>;

  beforeEach(() => {
    storeA = createSessionStore('session-a', 'agent-1');
    storeB = createSessionStore('session-b', 'agent-1');
  });

  describe('Factory creates independent stores', () => {
    it('creates stores with correct identity fields', () => {
      expect(storeA.getState().sessionId).toBe('session-a');
      expect(storeA.getState().agentId).toBe('agent-1');
      expect(storeB.getState().sessionId).toBe('session-b');
      expect(storeB.getState().agentId).toBe('agent-1');
    });

    it('creates stores with correct defaults', () => {
      const state = storeA.getState();
      expect(state.messages).toEqual([]);
      expect(state.isAiTyping).toBe(false);
      expect(state.pendingFrontendTools).toBeInstanceOf(Map);
      expect(state.pendingFrontendTools.size).toBe(0);
      expect(state.lastToolExecution).toBeNull();
      expect(state.activeA2AStreams).toEqual({});
      expect(state.mcpStatus.hasError).toBe(false);
      expect(state.subAgentTasks).toBeInstanceOf(Map);
      expect(state.subAgentTasks.size).toBe(0);
      expect(state.status).toBe('idle');
      expect(state.title).toBeNull();
      expect(state.isDisposed).toBe(false);
      expect(state.messagesLoaded).toBe(false);
    });
  });

  describe('State isolation — mutations on A do not affect B', () => {
    it('addMessage to A does not affect B', () => {
      storeA.getState().addMessage({ content: 'Hello from A', role: 'user' });
      expect(storeA.getState().messages.length).toBe(1);
      expect(storeB.getState().messages.length).toBe(0);
    });

    it('setAiTyping on A does not affect B', () => {
      storeA.getState().setAiTyping(true);
      expect(storeA.getState().isAiTyping).toBe(true);
      expect(storeB.getState().isAiTyping).toBe(false);
    });

    it('addPendingFrontendTool on A does not affect B', () => {
      storeA.getState().addPendingFrontendTool({
        toolCallId: 'tc-1',
        toolName: 'test_tool',
        args: {},
        sessionId: 'session-a',
        agentId: 'agent-1',
        timestamp: Date.now(),
      });
      expect(storeA.getState().pendingFrontendTools.size).toBe(1);
      expect(storeB.getState().pendingFrontendTools.size).toBe(0);
    });

    it('setStatus on A does not affect B', () => {
      storeA.getState().setStatus('running');
      expect(storeA.getState().status).toBe('running');
      expect(storeB.getState().status).toBe('idle');
    });

    it('updateMcpStatus on A does not affect B', () => {
      storeA.getState().updateMcpStatus({ hasError: true, lastError: 'fail' });
      expect(storeA.getState().mcpStatus.hasError).toBe(true);
      expect(storeB.getState().mcpStatus.hasError).toBe(false);
    });
  });

  describe('Message actions', () => {
    it('addMessage creates message with id, timestamp, and agentId', () => {
      storeA.getState().addMessage({ content: 'Test', role: 'user' });
      const msg = storeA.getState().messages[0];
      expect(msg.content).toBe('Test');
      expect(msg.role).toBe('user');
      expect(msg.id).toBeDefined();
      expect(msg.timestamp).toBeDefined();
      expect(msg.agentId).toBe('agent-1');
      expect(msg.messageParts).toEqual([]);
    });

    it('updateMessage updates specific message fields', () => {
      storeA.getState().addMessage({ content: 'Old', role: 'user' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().updateMessage(msgId, { content: 'New' });
      expect(storeA.getState().messages[0].content).toBe('New');
    });

    it('addTextPartToMessage adds text part', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addTextPartToMessage(msgId, 'Hello world');
      const parts = storeA.getState().messages[0].messageParts;
      expect(parts).toHaveLength(1);
      expect(parts![0].type).toBe('text');
      expect(parts![0].content).toBe('Hello world');
    });

    it('addThinkingPartToMessage adds thinking part', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addThinkingPartToMessage(msgId, 'Let me think...');
      const parts = storeA.getState().messages[0].messageParts;
      expect(parts).toHaveLength(1);
      expect(parts![0].type).toBe('thinking');
      expect(parts![0].content).toBe('Let me think...');
    });

    it('updateTextPartInMessage updates text content', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addTextPartToMessage(msgId, 'initial');
      const partId = storeA.getState().messages[0].messageParts![0].id;
      storeA.getState().updateTextPartInMessage(msgId, partId, 'updated');
      expect(storeA.getState().messages[0].messageParts![0].content).toBe('updated');
    });

    it('updateThinkingPartInMessage updates thinking content', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addThinkingPartToMessage(msgId, 'initial');
      const partId = storeA.getState().messages[0].messageParts![0].id;
      storeA.getState().updateThinkingPartInMessage(msgId, partId, 'updated');
      expect(storeA.getState().messages[0].messageParts![0].content).toBe('updated');
    });

    it('addToolPartToMessage adds tool part with generated id', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addToolPartToMessage(msgId, {
        toolName: 'read_file',
        toolInput: { path: '/test.txt' },
        isExecuting: true,
        claudeId: 'claude-id-1',
      });
      const parts = storeA.getState().messages[0].messageParts;
      expect(parts).toHaveLength(1);
      expect((parts![0] as any).toolData.toolName).toBe('read_file');
      expect((parts![0] as any).toolData.id).toBeDefined();
    });

    it('clearMessages empties the messages array', () => {
      storeA.getState().addMessage({ content: 'A', role: 'user' });
      storeA.getState().addMessage({ content: 'B', role: 'assistant' });
      expect(storeA.getState().messages.length).toBe(2);
      storeA.getState().clearMessages();
      expect(storeA.getState().messages.length).toBe(0);
    });

    it('loadSessionMessages replaces messages and sets messagesLoaded', () => {
      const msgs = [
        { id: 'msg-1', content: 'Loaded', role: 'user' as const, timestamp: 1, agentId: 'a', messageParts: [] },
      ];
      storeA.getState().loadSessionMessages(msgs as any);
      expect(storeA.getState().messages).toHaveLength(1);
      expect(storeA.getState().messages[0].content).toBe('Loaded');
      expect(storeA.getState().messagesLoaded).toBe(true);
    });

    it('interruptAllExecutingTools marks all executing tools as interrupted', () => {
      storeA.getState().addMessage({ content: '', role: 'assistant' });
      const msgId = storeA.getState().messages[0].id;
      storeA.getState().addToolPartToMessage(msgId, {
        toolName: 'bash',
        toolInput: {},
        isExecuting: true,
      });
      storeA.getState().interruptAllExecutingTools();
      const part = storeA.getState().messages[0].messageParts![0] as any;
      expect(part.toolData.isExecuting).toBe(false);
      expect(part.toolData.isInterrupted).toBe(true);
    });
  });

  describe('Frontend tool actions', () => {
    it('addPendingFrontendTool and removePendingFrontendTool', () => {
      const tool = {
        toolCallId: 'tc-1',
        toolName: 'test',
        args: {},
        sessionId: 'session-a',
        agentId: 'agent-1',
        timestamp: Date.now(),
      };
      storeA.getState().addPendingFrontendTool(tool);
      expect(storeA.getState().pendingFrontendTools.get('tc-1')).toBeDefined();
      storeA.getState().removePendingFrontendTool('tc-1');
      expect(storeA.getState().pendingFrontendTools.get('tc-1')).toBeUndefined();
    });

    it('getPendingFrontendTool returns the tool', () => {
      const tool = {
        toolCallId: 'tc-2',
        toolName: 'test',
        args: { key: 'val' },
        sessionId: 'session-a',
        agentId: 'agent-1',
        timestamp: 1000,
      };
      storeA.getState().addPendingFrontendTool(tool);
      const result = storeA.getState().getPendingFrontendTool('tc-2');
      expect(result?.toolName).toBe('test');
    });
  });

  describe('A2A stream actions', () => {
    it('setA2AStreamStart creates a stream entry', () => {
      storeA.getState().setA2AStreamStart('http://agent.url', 'sid-1', 'test message');
      const streams = storeA.getState().activeA2AStreams;
      expect(streams['http://agent.url']).toBeDefined();
      expect(streams['http://agent.url'].isStreaming).toBe(true);
      expect(streams['http://agent.url'].message).toBe('test message');
    });

    it('setA2AStreamEnd marks stream as not streaming', () => {
      storeA.getState().setA2AStreamStart('http://agent.url', 'sid-1', 'msg');
      storeA.getState().setA2AStreamEnd('http://agent.url');
      expect(storeA.getState().activeA2AStreams['http://agent.url'].isStreaming).toBe(false);
    });

    it('addA2AStreamEvent appends events', () => {
      storeA.getState().setA2AStreamStart('http://agent.url', 'sid-1', 'msg');
      storeA.getState().addA2AStreamEvent('http://agent.url', { type: 'test', timestamp: 1 });
      expect(storeA.getState().activeA2AStreams['http://agent.url'].events).toHaveLength(1);
    });
  });

  describe('Sub-agent actions', () => {
    it('registerTaskTool creates a sub-agent task entry', () => {
      storeA.getState().registerTaskTool('claude-id-1', 'session-a');
      expect(storeA.getState().subAgentTasks.has('claude-id-1')).toBe(true);
      expect(storeA.getState().subAgentTasks.get('claude-id-1')?.sessionId).toBe('session-a');
    });

    it('clearSubAgentTask removes the task', () => {
      storeA.getState().registerTaskTool('claude-id-2', 'session-a');
      storeA.getState().clearSubAgentTask('claude-id-2');
      expect(storeA.getState().subAgentTasks.has('claude-id-2')).toBe(false);
    });
  });

  describe('Session lifecycle', () => {
    it('setStatus updates status and lastActivity', () => {
      const before = storeA.getState().lastActivity;
      storeA.getState().setStatus('running');
      expect(storeA.getState().status).toBe('running');
      expect(storeA.getState().lastActivity).toBeGreaterThanOrEqual(before);
    });

    it('setTitle updates title', () => {
      storeA.getState().setTitle('My Session');
      expect(storeA.getState().title).toBe('My Session');
    });

    it('setMessagesLoaded updates flag', () => {
      storeA.getState().setMessagesLoaded(true);
      expect(storeA.getState().messagesLoaded).toBe(true);
    });

    it('dispose clears all heavyweight state and sets isDisposed', () => {
      storeA.getState().addMessage({ content: 'msg', role: 'user' });
      storeA.getState().addPendingFrontendTool({
        toolCallId: 'tc-x',
        toolName: 'tool',
        args: {},
        sessionId: 's',
        agentId: 'a',
        timestamp: 1,
      });
      storeA.getState().registerTaskTool('task-1', 's');
      storeA.getState().setA2AStreamStart('http://url', 'sid', 'msg');
      storeA.getState().updateMcpStatus({ hasError: true });
      storeA.getState().setAiTyping(true);

      storeA.getState().dispose();

      const state = storeA.getState();
      expect(state.isDisposed).toBe(true);
      expect(state.messages).toEqual([]);
      expect(state.pendingFrontendTools.size).toBe(0);
      expect(state.subAgentTasks.size).toBe(0);
      expect(state.activeA2AStreams).toEqual({});
      expect(state.mcpStatus.hasError).toBe(false);
      expect(state.isAiTyping).toBe(false);
      expect(state.lastToolExecution).toBeNull();
      expect(state.messagesLoaded).toBe(false);
    });
  });

  describe('MCP actions', () => {
    it('updateMcpStatus merges partial status', () => {
      storeA.getState().updateMcpStatus({ hasError: true, lastError: 'test error' });
      const mcp = storeA.getState().mcpStatus;
      expect(mcp.hasError).toBe(true);
      expect(mcp.lastError).toBe('test error');
      expect(mcp.lastUpdated).toBeDefined();
    });

    it('clearMcpStatus resets to defaults', () => {
      storeA.getState().updateMcpStatus({ hasError: true });
      storeA.getState().clearMcpStatus();
      expect(storeA.getState().mcpStatus.hasError).toBe(false);
    });
  });

  describe('notifyToolExecution', () => {
    it('sets lastToolExecution with toolName and timestamp', () => {
      storeA.getState().notifyToolExecution('bash');
      const exec = storeA.getState().lastToolExecution;
      expect(exec?.toolName).toBe('bash');
      expect(exec?.timestamp).toBeDefined();
    });
  });
});
