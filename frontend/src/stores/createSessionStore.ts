import { createStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { AgentMessage, ToolUsageData } from '../types/index.js';
import type {
  PendingFrontendToolCall,
  McpStatusData,
  A2AStreamData,
  A2AStreamEvent,
} from './useAgentStore';
import type { ActiveSubAgentTask } from './useSubAgentStore';
import type { SubAgentMessage, SubAgentMessagePart } from '../components/tools/types';

// ---------------------------------------------------------------------------
// Session State Interface
// ---------------------------------------------------------------------------

export interface SessionState {
  sessionId: string;
  agentId: string;

  messages: AgentMessage[];
  isAiTyping: boolean;

  pendingFrontendTools: Map<string, PendingFrontendToolCall>;
  lastToolExecution: { toolName: string; timestamp: number } | null;

  activeA2AStreams: Record<string, A2AStreamData>;

  mcpStatus: McpStatusData;

  subAgentTasks: Map<string, ActiveSubAgentTask>;

  status: 'idle' | 'running' | 'completed' | 'error';
  title: string | null;
  lastActivity: number;
  isDisposed: boolean;
  messagesLoaded: boolean;
}

// ---------------------------------------------------------------------------
// Session Actions Interface
// ---------------------------------------------------------------------------

export interface SessionActions {
  addMessage: (message: Omit<AgentMessage, 'id' | 'timestamp' | 'agentId'>) => void;
  updateMessage: (messageId: string, updates: Partial<AgentMessage>) => void;
  addTextPartToMessage: (messageId: string, text: string) => void;
  addThinkingPartToMessage: (messageId: string, thinking: string) => void;
  updateTextPartInMessage: (messageId: string, partId: string, text: string) => void;
  updateThinkingPartInMessage: (messageId: string, partId: string, thinking: string) => void;
  addCompactSummaryPartToMessage: (messageId: string, content: string) => void;
  addCommandPartToMessage: (messageId: string, command: string) => void;
  addToolPartToMessage: (messageId: string, tool: Omit<ToolUsageData, 'id'>) => void;
  updateToolPartInMessage: (messageId: string, toolId: string, updates: Partial<ToolUsageData>) => void;
  interruptAllExecutingTools: () => void;
  setAiTyping: (typing: boolean) => void;
  clearMessages: () => void;
  loadSessionMessages: (messages: AgentMessage[]) => void;

  updateMcpStatus: (status: Partial<McpStatusData>) => void;
  clearMcpStatus: () => void;

  addPendingFrontendTool: (call: PendingFrontendToolCall) => void;
  removePendingFrontendTool: (toolCallId: string) => void;
  getPendingFrontendTool: (toolCallId: string) => PendingFrontendToolCall | undefined;

  setA2AStreamStart: (agentUrl: string, sessionId: string, message: string) => void;
  setA2AStreamEnd: (agentUrl: string) => void;
  addA2AStreamEvent: (agentUrl: string, event: A2AStreamEvent) => void;
  getA2AStreamByUrl: (agentUrl: string) => A2AStreamData | undefined;

  notifyToolExecution: (toolName: string) => void;

  registerTaskTool: (taskToolClaudeId: string, sessionId: string) => void;
  activateSubAgent: (parentToolUseId: string, sessionId: string) => void;
  addSubAgentMessagePart: (parentToolUseId: string, part: SubAgentMessagePart) => void;
  getSubAgentMessageFlow: (parentToolUseId: string) => SubAgentMessage[];
  clearSubAgentTask: (parentToolUseId: string) => void;

  setStatus: (status: SessionState['status']) => void;
  setTitle: (title: string | null) => void;
  setMessagesLoaded: (loaded: boolean) => void;
  dispose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

const DEFAULT_MCP_STATUS: McpStatusData = {
  hasError: false,
  connectedServers: [],
  connectionErrors: [],
  lastError: null,
  lastErrorDetails: undefined,
  lastUpdated: undefined,
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an independent, session-scoped Zustand store instance.
 * Each call returns a brand-new StoreApi — no shared mutable state.
 */
export function createSessionStore(
  sessionId: string,
  agentId: string,
): StoreApi<SessionState & SessionActions> {
  return createStore<SessionState & SessionActions>((set, get) => ({
    // ---- Identity (immutable) ----
    sessionId,
    agentId,

    // ---- Chat state ----
    messages: [],
    isAiTyping: false,

    // ---- Tool state ----
    pendingFrontendTools: new Map(),
    lastToolExecution: null,

    // ---- A2A state ----
    activeA2AStreams: {},

    // ---- MCP state ----
    mcpStatus: { ...DEFAULT_MCP_STATUS },

    // ---- Sub-agent state ----
    subAgentTasks: new Map(),

    // ---- Session lifecycle ----
    status: 'idle',
    title: null,
    lastActivity: Date.now(),
    isDisposed: false,
    messagesLoaded: false,

    // ==================================================================
    // Message Actions
    // ==================================================================

    addMessage: (message) =>
      set((state) => ({
        messages: [
          ...state.messages,
          {
            ...message,
            id: generateId(),
            timestamp: Date.now(),
            agentId: state.agentId,
            messageParts: [],
          },
        ],
        lastActivity: Date.now(),
      })),

    updateMessage: (messageId, updates) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg,
        ),
      })),

    addTextPartToMessage: (messageId, text) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: [
                  ...(msg.messageParts || []),
                  {
                    id: generateId(),
                    type: 'text' as const,
                    content: text,
                    order: (msg.messageParts || []).length,
                  },
                ],
              }
            : msg,
        ),
      })),

    addThinkingPartToMessage: (messageId, thinking) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: [
                  ...(msg.messageParts || []),
                  {
                    id: generateId(),
                    type: 'thinking' as const,
                    content: thinking,
                    order: (msg.messageParts || []).length,
                  },
                ],
              }
            : msg,
        ),
      })),

    updateTextPartInMessage: (messageId, partId, text) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: msg.messageParts?.map((part: any) =>
                  part.type === 'text' && part.id === partId
                    ? { ...part, content: text }
                    : part,
                ),
              }
            : msg,
        ),
      })),

    updateThinkingPartInMessage: (messageId, partId, thinking) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: msg.messageParts?.map((part: any) =>
                  part.type === 'thinking' && part.id === partId
                    ? { ...part, content: thinking }
                    : part,
                ),
              }
            : msg,
        ),
      })),

    addCompactSummaryPartToMessage: (messageId, content) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: [
                  ...(msg.messageParts || []),
                  {
                    id: generateId(),
                    type: 'compactSummary' as const,
                    content,
                    order: (msg.messageParts || []).length,
                  },
                ],
              }
            : msg,
        ),
      })),

    addCommandPartToMessage: (messageId, command) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: [
                  ...(msg.messageParts || []),
                  {
                    id: generateId(),
                    type: 'command' as const,
                    content: command,
                    order: (msg.messageParts || []).length,
                  },
                ],
              }
            : msg,
        ),
      })),

    addToolPartToMessage: (messageId, tool) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: [
                  ...(msg.messageParts || []),
                  {
                    id: generateId(),
                    type: 'tool' as const,
                    toolData: {
                      ...tool,
                      id: generateId(),
                      isExecuting: tool.isExecuting ?? false,
                    },
                    order: (msg.messageParts || []).length,
                  },
                ],
              }
            : msg,
        ),
      })),

    updateToolPartInMessage: (messageId, toolId, updates) =>
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                messageParts: msg.messageParts?.map((part: any) =>
                  part.type === 'tool' &&
                  (part.toolData?.id === toolId || part.toolData?.claudeId === toolId)
                    ? {
                        ...part,
                        toolData: part.toolData
                          ? { ...part.toolData, ...updates }
                          : undefined,
                      }
                    : part,
                ),
              }
            : msg,
        ),
      })),

    interruptAllExecutingTools: () =>
      set((state) => ({
        messages: state.messages.map((msg) => ({
          ...msg,
          messageParts: msg.messageParts?.map((part: any) =>
            part.type === 'tool' && part.toolData?.isExecuting
              ? {
                  ...part,
                  toolData: {
                    ...part.toolData,
                    isExecuting: false,
                    isInterrupted: true,
                  },
                }
              : part,
          ),
        })),
      })),

    setAiTyping: (typing) => set({ isAiTyping: typing, lastActivity: Date.now() }),

    clearMessages: () => set({ messages: [] }),

    loadSessionMessages: (messages) => set({ messages, messagesLoaded: true }),

    // ==================================================================
    // MCP Actions
    // ==================================================================

    updateMcpStatus: (status) =>
      set((state) => ({
        mcpStatus: {
          ...state.mcpStatus,
          ...status,
          lastUpdated: Date.now(),
        },
      })),

    clearMcpStatus: () => set({ mcpStatus: { ...DEFAULT_MCP_STATUS } }),

    // ==================================================================
    // Frontend Tool Actions
    // ==================================================================

    addPendingFrontendTool: (call) =>
      set((state) => {
        const next = new Map(state.pendingFrontendTools);
        next.set(call.toolCallId, call);
        return { pendingFrontendTools: next };
      }),

    removePendingFrontendTool: (toolCallId) =>
      set((state) => {
        const next = new Map(state.pendingFrontendTools);
        next.delete(toolCallId);
        return { pendingFrontendTools: next };
      }),

    getPendingFrontendTool: (toolCallId) =>
      get().pendingFrontendTools.get(toolCallId),

    // ==================================================================
    // A2A Stream Actions
    // ==================================================================

    setA2AStreamStart: (agentUrl, sid, message) =>
      set((state) => ({
        activeA2AStreams: {
          ...state.activeA2AStreams,
          [agentUrl]: {
            sessionId: sid,
            agentUrl,
            message,
            startedAt: Date.now(),
            isStreaming: true,
            events: [],
          },
        },
      })),

    setA2AStreamEnd: (agentUrl) =>
      set((state) => {
        const stream = state.activeA2AStreams[agentUrl];
        if (!stream) return state;
        return {
          activeA2AStreams: {
            ...state.activeA2AStreams,
            [agentUrl]: { ...stream, isStreaming: false },
          },
        };
      }),

    addA2AStreamEvent: (agentUrl, event) =>
      set((state) => {
        const stream = state.activeA2AStreams[agentUrl];
        if (stream) {
          return {
            activeA2AStreams: {
              ...state.activeA2AStreams,
              [agentUrl]: { ...stream, events: [...stream.events, event] },
            },
          };
        }
        return {
          activeA2AStreams: {
            ...state.activeA2AStreams,
            [agentUrl]: {
              sessionId: event.sessionId || '',
              agentUrl,
              message: '',
              startedAt: Date.now(),
              isStreaming: true,
              events: [event],
            },
          },
        };
      }),

    getA2AStreamByUrl: (agentUrl) => get().activeA2AStreams[agentUrl],

    // ==================================================================
    // Tool Execution Notification
    // ==================================================================

    notifyToolExecution: (toolName) =>
      set({ lastToolExecution: { toolName, timestamp: Date.now() }, lastActivity: Date.now() }),

    // ==================================================================
    // Sub-Agent Actions (merged from useSubAgentStore)
    // ==================================================================

    registerTaskTool: (taskToolClaudeId, sid) =>
      set((state) => {
        const next = new Map(state.subAgentTasks);
        if (!next.has(taskToolClaudeId)) {
          next.set(taskToolClaudeId, {
            parentToolUseId: taskToolClaudeId,
            sessionId: sid,
            messageFlow: [],
            startedAt: Date.now(),
            lastUpdatedAt: Date.now(),
          });
        }
        return { subAgentTasks: next };
      }),

    activateSubAgent: (parentToolUseId, sid) => {
      if (get().subAgentTasks.has(parentToolUseId)) return;
      set((state) => {
        const next = new Map(state.subAgentTasks);
        next.set(parentToolUseId, {
          parentToolUseId,
          sessionId: sid,
          messageFlow: [],
          startedAt: Date.now(),
          lastUpdatedAt: Date.now(),
        });
        return { subAgentTasks: next };
      });
    },

    addSubAgentMessagePart: (parentToolUseId, part) =>
      set((state) => {
        const task = state.subAgentTasks.get(parentToolUseId);
        const next = new Map(state.subAgentTasks);

        if (!task) {
          next.set(parentToolUseId, {
            parentToolUseId,
            sessionId: '',
            messageFlow: [
              {
                id: `msg_${parentToolUseId}_${Date.now()}`,
                role: 'assistant' as const,
                timestamp: new Date().toISOString(),
                messageParts: [part],
              },
            ],
            startedAt: Date.now(),
            lastUpdatedAt: Date.now(),
          });
          return { subAgentTasks: next };
        }

        const existingPartIndex = task.messageFlow.findIndex((msg) =>
          msg.messageParts.some((p) => p.id === part.id),
        );

        let updatedMessageFlow: SubAgentMessage[];

        if (existingPartIndex >= 0) {
          updatedMessageFlow = task.messageFlow.map((msg, idx) => {
            if (idx !== existingPartIndex) return msg;
            return {
              ...msg,
              messageParts: msg.messageParts.map((p) => (p.id === part.id ? part : p)),
            };
          });
        } else {
          const lastMessage = task.messageFlow[task.messageFlow.length - 1];
          if (lastMessage && lastMessage.role === 'assistant') {
            updatedMessageFlow = [
              ...task.messageFlow.slice(0, -1),
              { ...lastMessage, messageParts: [...lastMessage.messageParts, part] },
            ];
          } else {
            updatedMessageFlow = [
              ...task.messageFlow,
              {
                id: `msg_${parentToolUseId}_${Date.now()}`,
                role: 'assistant' as const,
                timestamp: new Date().toISOString(),
                messageParts: [part],
              },
            ];
          }
        }

        next.set(parentToolUseId, {
          ...task,
          messageFlow: updatedMessageFlow,
          lastUpdatedAt: Date.now(),
        });
        return { subAgentTasks: next };
      }),

    getSubAgentMessageFlow: (parentToolUseId) => {
      const task = get().subAgentTasks.get(parentToolUseId);
      return task?.messageFlow || [];
    },

    clearSubAgentTask: (parentToolUseId) =>
      set((state) => {
        const next = new Map(state.subAgentTasks);
        next.delete(parentToolUseId);
        return { subAgentTasks: next };
      }),

    // ==================================================================
    // Session Lifecycle
    // ==================================================================

    setStatus: (status) => set({ status, lastActivity: Date.now() }),

    setTitle: (title) => set({ title }),

    setMessagesLoaded: (loaded) => set({ messagesLoaded: loaded }),

    dispose: () =>
      set({
        isDisposed: true,
        messages: [],
        pendingFrontendTools: new Map(),
        subAgentTasks: new Map(),
        activeA2AStreams: {},
        mcpStatus: { ...DEFAULT_MCP_STATUS },
        isAiTyping: false,
        lastToolExecution: null,
        messagesLoaded: false,
      }),
  }));
}
