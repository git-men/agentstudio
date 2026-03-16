import { create } from 'zustand';
import type { AgentConfig, AgentMessage, ToolUsageData } from '../types/index.js';
import type { EngineUICapabilities } from '../hooks/useAGUIChat';
import { getDefaultUICapabilities } from '../hooks/useAGUIChat';
import { useSharedStore } from './useSharedStore';
import { sessionStoreManager } from '../services/SessionStoreManager';
import type { SessionState, SessionActions } from './createSessionStore';
import type { StoreApi } from 'zustand';

/**
 * Engine type for AGUI
 */
export type EngineType = 'claude' | 'cursor' | 'codebuddy' | 'codex';

// Re-export for convenience
export type { EngineUICapabilities } from '../hooks/useAGUIChat';

// =============================================================================
// Engine Type Cache (localStorage)
// =============================================================================

const ENGINE_TYPE_CACHE_KEY = 'agentstudio:engine-type';

function getCachedEngineType(): EngineType {
  try {
    const cached = localStorage.getItem(ENGINE_TYPE_CACHE_KEY);
    if (cached === 'claude' || cached === 'cursor' || cached === 'codebuddy' || cached === 'codex') {
      return cached;
    }
  } catch {
    // localStorage might be unavailable
  }
  return 'claude'; // default fallback
}

export function cacheEngineType(engine: EngineType): void {
  try {
    localStorage.setItem(ENGINE_TYPE_CACHE_KEY, engine);
  } catch {
    // localStorage might be unavailable
  }
}

export interface McpStatusData {
  hasError: boolean;
  connectedServers?: Array<{ name: string; status: string }>;
  connectionErrors?: Array<{ name: string; status: string; error?: string }>;
  lastError?: string | null;
  lastErrorDetails?: string;
  lastUpdated?: number;
}

export interface PendingFrontendToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  agentId: string;
  timestamp: number;
}

export interface A2AStreamEvent {
  type: string;
  sessionId?: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string | Array<unknown>;
      is_error?: boolean;
    }>;
  };
  timestamp?: number;
}

export interface A2AStreamData {
  sessionId: string;
  agentUrl: string;
  message: string;
  startedAt: number;
  isStreaming: boolean;
  events: A2AStreamEvent[];
}

// =============================================================================
// AgentState — external contract (UNCHANGED from original)
// =============================================================================

interface AgentState {
  currentAgent: AgentConfig | null;
  selectedEngine: EngineType;
  engineUICapabilities: EngineUICapabilities;
  engineModels: Array<{ id: string; name: string; isVision?: boolean; isThinking?: boolean }>;

  messages: AgentMessage[];
  isAiTyping: boolean;
  currentSessionId: string | null;

  lastToolExecution: { toolName: string; timestamp: number } | null;
  mcpStatus: McpStatusData;
  pendingFrontendTools: Map<string, PendingFrontendToolCall>;
  activeA2AStreams: Record<string, A2AStreamData>;

  sidebarCollapsed: boolean;

  // Actions
  setCurrentAgent: (agent: AgentConfig | null) => void;
  setCurrentAgentAndSession: (agent: AgentConfig, sessionId: string | null) => void;
  setSelectedEngine: (engine: EngineType) => void;
  setEngineUICapabilities: (capabilities: EngineUICapabilities) => void;
  setEngineModels: (models: Array<{ id: string; name: string; isVision?: boolean; isThinking?: boolean }>) => void;

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
  setCurrentSessionId: (sessionId: string | null) => void;
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

  setSidebarCollapsed: (collapsed: boolean) => void;
}

// =============================================================================
// Internal helpers
// =============================================================================

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

// Session subscription management (module-level, outside the store closure)
let _currentSessionUnsub: (() => void) | null = null;

function syncSessionFields(
  facadeSet: (partial: Partial<AgentState>) => void,
  sessionState: SessionState & SessionActions,
) {
  facadeSet({
    messages: sessionState.messages,
    isAiTyping: sessionState.isAiTyping,
    pendingFrontendTools: sessionState.pendingFrontendTools,
    lastToolExecution: sessionState.lastToolExecution,
    activeA2AStreams: sessionState.activeA2AStreams,
    mcpStatus: sessionState.mcpStatus,
  });
}

/**
 * Bind the facade to a specific session store.
 * When sessionId is null, resets session fields to defaults.
 * When sessionId is non-null, creates/gets the session store and subscribes.
 */
function bindToSession(
  sessionId: string | null,
  agentId: string,
  facadeSet: (partial: Partial<AgentState>) => void,
  facadeGet: () => AgentState,
) {
  if (_currentSessionUnsub) {
    _currentSessionUnsub();
    _currentSessionUnsub = null;
  }

  if (!sessionId) {
    facadeSet({
      messages: [],
      isAiTyping: false,
      pendingFrontendTools: new Map(),
      lastToolExecution: null,
      activeA2AStreams: {},
      mcpStatus: { ...DEFAULT_MCP_STATUS },
    });
    return;
  }

  const store = sessionStoreManager.getOrCreate(sessionId, agentId);

  // Transfer any pending facade state to the new session store
  // (handles the case where messages were added before sessionId was assigned)
  const facadeState = facadeGet();
  if (facadeState.messages.length > 0 && store.getState().messages.length === 0) {
    store.getState().loadSessionMessages(facadeState.messages);
  }
  if (facadeState.isAiTyping && !store.getState().isAiTyping) {
    store.setState({ isAiTyping: true });
  }

  // Initial sync from session store to facade
  syncSessionFields(facadeSet, store.getState());

  // Subscribe to ongoing session store changes
  _currentSessionUnsub = store.subscribe((state) => {
    syncSessionFields(facadeSet, state);
  });
}

/**
 * Get the current session's StoreApi (if a session is active).
 */
function getCurrentSessionStore(get: () => AgentState): StoreApi<SessionState & SessionActions> | undefined {
  const sid = get().currentSessionId;
  if (!sid) return undefined;
  return sessionStoreManager.getStore(sid);
}

// =============================================================================
// Facade Store
// =============================================================================

/**
 * Backward-compatible facade that preserves the exact same external API
 * while internally delegating to useSharedStore (shared state) and
 * sessionStoreManager (session-scoped state).
 *
 * All existing consumers (ChatPage, AGUIChatPanel, etc.) continue working
 * without ANY changes.
 */
export const useAgentStore = create<AgentState>((set, get) => {
  // ------------------------------------------------------------------
  // Subscribe to shared store → sync shared fields into facade
  // ------------------------------------------------------------------
  useSharedStore.subscribe((shared) => {
    set({
      currentAgent: shared.currentAgent,
      selectedEngine: shared.selectedEngine,
      engineUICapabilities: shared.engineUICapabilities,
      engineModels: shared.engineModels,
      sidebarCollapsed: shared.sidebarCollapsed,
    });
  });

  // ------------------------------------------------------------------
  // Helper to delegate a session action, or fall back to direct facade mutation
  // ------------------------------------------------------------------
  function withSessionStore<R>(
    fn: (store: StoreApi<SessionState & SessionActions>) => R,
    fallback?: () => R,
  ): R | undefined {
    const store = getCurrentSessionStore(get);
    if (store) return fn(store);
    if (fallback) return fallback();
    return undefined;
  }

  // ------------------------------------------------------------------
  // Initial state — seeded from shared store + empty session state
  // ------------------------------------------------------------------
  const sharedInit = useSharedStore.getState();

  return {
    currentAgent: sharedInit.currentAgent,
    selectedEngine: sharedInit.selectedEngine,
    engineUICapabilities: sharedInit.engineUICapabilities,
    engineModels: sharedInit.engineModels,
    sidebarCollapsed: sharedInit.sidebarCollapsed,

    messages: [],
    isAiTyping: false,
    currentSessionId: null,
    lastToolExecution: null,
    mcpStatus: { ...DEFAULT_MCP_STATUS },
    pendingFrontendTools: new Map(),
    activeA2AStreams: {},

    // ================================================================
    // Shared state actions → delegate to useSharedStore
    // ================================================================

    setCurrentAgent: (agent) => {
      const prevAgentId = get().currentAgent?.id;
      useSharedStore.getState().setCurrentAgent(agent);
      if (prevAgentId !== agent?.id) {
        set({ currentSessionId: null });
        bindToSession(null, agent?.id || 'unknown', set, get);
      }
    },

    setCurrentAgentAndSession: (agent, sessionId) => {
      const prevAgentId = get().currentAgent?.id;
      useSharedStore.getState().setCurrentAgent(agent);
      if (prevAgentId !== agent?.id) {
        set({ currentSessionId: sessionId });
        bindToSession(sessionId, agent.id, set, get);
      } else if (sessionId !== undefined) {
        set({ currentSessionId: sessionId });
        bindToSession(sessionId, agent.id, set, get);
      }
    },

    setSelectedEngine: (engine) => {
      useSharedStore.getState().setSelectedEngine(engine);
      cacheEngineType(engine);
    },

    setEngineUICapabilities: (capabilities) => {
      useSharedStore.getState().setEngineUICapabilities(capabilities);
    },

    setEngineModels: (models) => {
      useSharedStore.getState().setEngineModels(models);
    },

    setSidebarCollapsed: (collapsed) => {
      useSharedStore.getState().setSidebarCollapsed(collapsed);
    },

    // ================================================================
    // Session state actions → delegate to current session store
    // with fallback for no-session scenario
    // ================================================================

    addMessage: (message) => {
      withSessionStore(
        (store) => store.getState().addMessage(message),
        () => {
          set((state) => ({
            messages: [
              ...state.messages,
              {
                ...message,
                id: generateId(),
                timestamp: Date.now(),
                agentId: state.currentAgent?.id || 'unknown',
                messageParts: [],
              },
            ],
          }));
        },
      );
    },

    updateMessage: (messageId, updates) => {
      withSessionStore(
        (store) => store.getState().updateMessage(messageId, updates),
        () => {
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg,
            ),
          }));
        },
      );
    },

    addTextPartToMessage: (messageId, text) => {
      withSessionStore(
        (store) => store.getState().addTextPartToMessage(messageId, text),
        () => {
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
          }));
        },
      );
    },

    addThinkingPartToMessage: (messageId, thinking) => {
      withSessionStore(
        (store) => store.getState().addThinkingPartToMessage(messageId, thinking),
        () => {
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
          }));
        },
      );
    },

    updateTextPartInMessage: (messageId, partId, text) => {
      withSessionStore(
        (store) => store.getState().updateTextPartInMessage(messageId, partId, text),
        () => {
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
          }));
        },
      );
    },

    updateThinkingPartInMessage: (messageId, partId, thinking) => {
      withSessionStore(
        (store) => store.getState().updateThinkingPartInMessage(messageId, partId, thinking),
        () => {
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
          }));
        },
      );
    },

    addCompactSummaryPartToMessage: (messageId, content) => {
      withSessionStore(
        (store) => store.getState().addCompactSummaryPartToMessage(messageId, content),
        () => {
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
          }));
        },
      );
    },

    addCommandPartToMessage: (messageId, command) => {
      withSessionStore(
        (store) => store.getState().addCommandPartToMessage(messageId, command),
        () => {
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
          }));
        },
      );
    },

    addToolPartToMessage: (messageId, tool) => {
      withSessionStore(
        (store) => store.getState().addToolPartToMessage(messageId, tool),
        () => {
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
          }));
        },
      );
    },

    updateToolPartInMessage: (messageId, toolId, updates) => {
      withSessionStore(
        (store) => store.getState().updateToolPartInMessage(messageId, toolId, updates),
        () => {
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
          }));
        },
      );
    },

    interruptAllExecutingTools: () => {
      withSessionStore(
        (store) => store.getState().interruptAllExecutingTools(),
        () => {
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
          }));
        },
      );
    },

    setAiTyping: (typing) => {
      withSessionStore(
        (store) => store.getState().setAiTyping(typing),
        () => set({ isAiTyping: typing }),
      );
    },

    setCurrentSessionId: (sessionId) => {
      const agentId = get().currentAgent?.id || 'unknown';
      set({ currentSessionId: sessionId });
      bindToSession(sessionId, agentId, set, get);
      // Clear pending frontend tools on session switch (matches original behavior)
      if (!sessionId) {
        set({ pendingFrontendTools: new Map() });
      }
    },

    clearMessages: () => {
      withSessionStore(
        (store) => store.getState().clearMessages(),
        () => set({ messages: [] }),
      );
    },

    loadSessionMessages: (messages) => {
      withSessionStore(
        (store) => store.getState().loadSessionMessages(messages),
        () => set({ messages }),
      );
    },

    // ================================================================
    // MCP actions
    // ================================================================

    updateMcpStatus: (status) => {
      withSessionStore(
        (store) => store.getState().updateMcpStatus(status),
        () => {
          set((state) => ({
            mcpStatus: {
              ...state.mcpStatus,
              ...status,
              lastUpdated: Date.now(),
            },
          }));
        },
      );
    },

    clearMcpStatus: () => {
      withSessionStore(
        (store) => store.getState().clearMcpStatus(),
        () => set({ mcpStatus: { ...DEFAULT_MCP_STATUS } }),
      );
    },

    // ================================================================
    // Frontend tool actions
    // ================================================================

    addPendingFrontendTool: (call) => {
      withSessionStore(
        (store) => store.getState().addPendingFrontendTool(call),
        () => {
          set((state) => {
            const next = new Map(state.pendingFrontendTools);
            next.set(call.toolCallId, call);
            return { pendingFrontendTools: next };
          });
        },
      );
    },

    removePendingFrontendTool: (toolCallId) => {
      withSessionStore(
        (store) => store.getState().removePendingFrontendTool(toolCallId),
        () => {
          set((state) => {
            const next = new Map(state.pendingFrontendTools);
            next.delete(toolCallId);
            return { pendingFrontendTools: next };
          });
        },
      );
    },

    getPendingFrontendTool: (toolCallId) => {
      const store = getCurrentSessionStore(get);
      if (store) return store.getState().getPendingFrontendTool(toolCallId);
      return get().pendingFrontendTools.get(toolCallId);
    },

    // ================================================================
    // A2A stream actions
    // ================================================================

    setA2AStreamStart: (agentUrl, sessionId, message) => {
      withSessionStore(
        (store) => store.getState().setA2AStreamStart(agentUrl, sessionId, message),
        () => {
          set((state) => ({
            activeA2AStreams: {
              ...state.activeA2AStreams,
              [agentUrl]: {
                sessionId,
                agentUrl,
                message,
                startedAt: Date.now(),
                isStreaming: true,
                events: [],
              },
            },
          }));
        },
      );
    },

    setA2AStreamEnd: (agentUrl) => {
      withSessionStore(
        (store) => store.getState().setA2AStreamEnd(agentUrl),
        () => {
          set((state) => {
            const stream = state.activeA2AStreams[agentUrl];
            if (!stream) return state;
            return {
              activeA2AStreams: {
                ...state.activeA2AStreams,
                [agentUrl]: { ...stream, isStreaming: false },
              },
            };
          });
        },
      );
    },

    addA2AStreamEvent: (agentUrl, event) => {
      withSessionStore(
        (store) => store.getState().addA2AStreamEvent(agentUrl, event),
        () => {
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
          });
        },
      );
    },

    getA2AStreamByUrl: (agentUrl) => {
      const store = getCurrentSessionStore(get);
      if (store) return store.getState().getA2AStreamByUrl(agentUrl);
      return get().activeA2AStreams[agentUrl];
    },

    // ================================================================
    // Tool execution notification
    // ================================================================

    notifyToolExecution: (toolName) => {
      withSessionStore(
        (store) => store.getState().notifyToolExecution(toolName),
        () => set({ lastToolExecution: { toolName, timestamp: Date.now() } }),
      );
    },
  };
});
