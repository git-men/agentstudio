import { create } from 'zustand';
import type { AgentConfig, AgentMessage, ToolUsageData } from '../types/index.js';
import type { EngineUICapabilities } from '../hooks/useAGUIChat';
import { getDefaultUICapabilities } from '../hooks/useAGUIChat';

/**
 * Engine type for AGUI
 */
export type EngineType = 'claude' | 'cursor';

// Re-export for convenience
export type { EngineUICapabilities } from '../hooks/useAGUIChat';

// =============================================================================
// Engine Type Cache (localStorage)
// =============================================================================

const ENGINE_TYPE_CACHE_KEY = 'agentstudio:engine-type';

/**
 * Get cached engine type from localStorage.
 * This allows the store to initialize with the correct engine type
 * immediately, avoiding a flash of wrong engine mode on page load.
 */
function getCachedEngineType(): EngineType {
  try {
    const cached = localStorage.getItem(ENGINE_TYPE_CACHE_KEY);
    if (cached === 'claude' || cached === 'cursor') {
      return cached;
    }
  } catch {
    // localStorage might be unavailable
  }
  return 'claude'; // default fallback
}

/**
 * Save engine type to localStorage for faster initialization on next load.
 */
export function cacheEngineType(engine: EngineType): void {
  try {
    localStorage.setItem(ENGINE_TYPE_CACHE_KEY, engine);
  } catch {
    // localStorage might be unavailable
  }
}

interface McpStatusData {
  hasError: boolean;
  connectedServers?: Array<{ name: string; status: string }>;
  connectionErrors?: Array<{ name: string; status: string; error?: string }>;
  lastError?: string | null;
  lastErrorDetails?: string;
  lastUpdated?: number;
}

// 待回答的用户问题状态（用于 AskUserQuestion 工具）
interface PendingUserQuestion {
  toolUseId: string;
  toolName: string;
  questions: Array<{
    question: string;
    options: Array<{
      label: string;
      description?: string;
    }>;
    multiSelect?: boolean;
    header?: string;
  }>;
  timestamp: number;
}

/**
 * A2A Stream Event - SDK message received from external agent
 */
interface A2AStreamEvent {
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

/**
 * Active A2A Stream data
 * Keyed by agentUrl to allow matching with A2ACallTool component
 */
interface A2AStreamData {
  sessionId: string;
  agentUrl: string;
  message: string;
  startedAt: number;
  isStreaming: boolean;
  events: A2AStreamEvent[];  // Real-time events received during streaming
}

interface AgentState {
  // Current agent (框架层)
  currentAgent: AgentConfig | null;
  
  // Engine selection (AGUI)
  selectedEngine: EngineType;
  
  // Engine UI capabilities - controls which UI elements to show
  engineUICapabilities: EngineUICapabilities;
  
  // Engine models - models available for the current engine
  engineModels: Array<{ id: string; name: string; isVision?: boolean; isThinking?: boolean }>;
  
  // Chat state (框架层通用聊天)
  messages: AgentMessage[];
  isAiTyping: boolean;
  currentSessionId: string | null;
  
  // MCP status (MCP工具状态)
  mcpStatus: McpStatusData;
  
  // AskUserQuestion 状态（等待用户回答的问题）
  pendingUserQuestion: PendingUserQuestion | null;
  
  // A2A streaming state (keyed by agentUrl for matching with tool components)
  activeA2AStreams: Record<string, A2AStreamData>;
  
  // UI state (框架层通用UI)
  sidebarCollapsed: boolean;
  
  // Actions
  setCurrentAgent: (agent: AgentConfig | null) => void;
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
  
  // AskUserQuestion actions
  setPendingUserQuestion: (question: PendingUserQuestion | null) => void;
  
  // A2A stream actions
  setA2AStreamStart: (agentUrl: string, sessionId: string, message: string) => void;
  setA2AStreamEnd: (agentUrl: string) => void;
  addA2AStreamEvent: (agentUrl: string, event: A2AStreamEvent) => void;
  getA2AStreamByUrl: (agentUrl: string) => A2AStreamData | undefined;
  
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  // Initial state - use cached engine type for immediate correct rendering
  currentAgent: null,
  selectedEngine: getCachedEngineType(),
  engineUICapabilities: getDefaultUICapabilities(getCachedEngineType()),
  engineModels: [], // Will be populated when engine info is fetched
  messages: [],
  isAiTyping: false,
  currentSessionId: null,
  mcpStatus: {
    hasError: false,
    connectedServers: [],
    connectionErrors: [],
    lastError: null,
    lastErrorDetails: undefined,
    lastUpdated: undefined
  },
  pendingUserQuestion: null,
  activeA2AStreams: {},
  sidebarCollapsed: false,
  
  // Actions
  setCurrentAgent: (agent) => set((state) => ({
    currentAgent: agent,
    // Only clear messages and session when actually switching to a different agent
    ...(state.currentAgent?.id !== agent?.id ? {
      messages: [],
      isAiTyping: false,
      currentSessionId: null
    } : {})
  })),
  
  setSelectedEngine: (engine) => set((state) => ({
    selectedEngine: engine,
    // Update UI capabilities when switching engines
    engineUICapabilities: getDefaultUICapabilities(engine),
    // Clear session when switching engines
    ...(state.selectedEngine !== engine ? {
      messages: [],
      isAiTyping: false,
      currentSessionId: null
    } : {})
  })),
  
  setEngineUICapabilities: (capabilities) => set({ engineUICapabilities: capabilities }),
  
  setEngineModels: (models) => set({ engineModels: models }),
  
  addMessage: (message) => set((state) => ({
    messages: [
      ...state.messages,
      {
        ...message,
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        agentId: state.currentAgent?.id || 'unknown',
        messageParts: []
      }
    ]
  })),
  
  updateMessage: (messageId, updates) => set((state) => ({
    messages: state.messages.map((msg) => 
      msg.id === messageId ? { ...msg, ...updates } : msg
    )
  })),
  
  addTextPartToMessage: (messageId, text) => set((state) => ({
    messages: state.messages.map((msg) => 
      msg.id === messageId 
        ? {
            ...msg,
            messageParts: [
              ...(msg.messageParts || []),
              {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'text' as const,
                content: text,
                order: (msg.messageParts || []).length
              }
            ]
          }
        : msg
    )
  })),
  
  addThinkingPartToMessage: (messageId, thinking) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: [
              ...(msg.messageParts || []),
              {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'thinking' as const,
                content: thinking,
                order: (msg.messageParts || []).length
              }
            ]
          }
        : msg
    )
  })),

  updateTextPartInMessage: (messageId, partId, text) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: msg.messageParts?.map((part: any) =>
              part.type === 'text' && part.id === partId
                ? { ...part, content: text }
                : part
            )
          }
        : msg
    )
  })),

  updateThinkingPartInMessage: (messageId, partId, thinking) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: msg.messageParts?.map((part: any) =>
              part.type === 'thinking' && part.id === partId
                ? { ...part, content: thinking }
                : part
            )
          }
        : msg
    )
  })),

  addCompactSummaryPartToMessage: (messageId, content) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: [
              ...(msg.messageParts || []),
              {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'compactSummary' as const,
                content,
                order: (msg.messageParts || []).length
              }
            ]
          }
        : msg
    )
  })),

  addCommandPartToMessage: (messageId, command) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: [
              ...(msg.messageParts || []),
              {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'command' as const,
                content: command,
                order: (msg.messageParts || []).length
              }
            ]
          }
        : msg
    )
  })),

  addToolPartToMessage: (messageId, tool) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: [
              ...(msg.messageParts || []),
              {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'tool' as const,
                toolData: {
                  ...tool,
                  id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  isExecuting: tool.isExecuting ?? false  // 确保 isExecuting 是 boolean
                },
                order: (msg.messageParts || []).length
              }
            ]
          }
        : msg
    )
  })),
  
  updateToolPartInMessage: (messageId, toolId, updates) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            messageParts: msg.messageParts?.map((part: any) =>
              // Support finding tool by either id or claudeId (for AGUI events)
              part.type === 'tool' && (part.toolData?.id === toolId || part.toolData?.claudeId === toolId)
                ? {
                    ...part,
                    toolData: part.toolData ? { ...part.toolData, ...updates } : undefined
                  }
                : part
            )
          }
        : msg
    )
  })),

  interruptAllExecutingTools: () => set((state) => ({
    messages: state.messages.map((msg) => ({
      ...msg,
      messageParts: msg.messageParts?.map((part: any) =>
        part.type === 'tool' && part.toolData?.isExecuting
          ? {
              ...part,
              toolData: {
                ...part.toolData,
                isExecuting: false,
                isInterrupted: true
              }
            }
          : part
      )
    }))
  })),

  setAiTyping: (typing) => set({ isAiTyping: typing }),
  
  setCurrentSessionId: (sessionId) => set({ currentSessionId: sessionId }),
  
  clearMessages: () => set({ messages: [] }),
  
  loadSessionMessages: (messages) => set({ messages }),
  
  updateMcpStatus: (status) => set((state) => ({
    mcpStatus: {
      ...state.mcpStatus,
      ...status,
      lastUpdated: Date.now()
    }
  })),
  
  clearMcpStatus: () => set({
    mcpStatus: {
      hasError: false,
      connectedServers: [],
      connectionErrors: [],
      lastError: null,
      lastErrorDetails: undefined,
      lastUpdated: undefined
    }
  }),
  
  // AskUserQuestion actions
  setPendingUserQuestion: (question) => set({ pendingUserQuestion: question }),
  
  // A2A stream actions
  setA2AStreamStart: (agentUrl, sessionId, message) => set((state) => ({
    activeA2AStreams: {
      ...state.activeA2AStreams,
      [agentUrl]: {
        sessionId,
        agentUrl,
        message,
        startedAt: Date.now(),
        isStreaming: true,
        events: [],  // Initialize empty events array
      }
    }
  })),
  
  setA2AStreamEnd: (agentUrl) => set((state) => {
    const stream = state.activeA2AStreams[agentUrl];
    if (stream) {
      return {
        activeA2AStreams: {
          ...state.activeA2AStreams,
          [agentUrl]: {
            ...stream,
            isStreaming: false,
          }
        }
      };
    }
    return state;
  }),
  
  // Add a new event to the A2A stream's events array for real-time display
  addA2AStreamEvent: (agentUrl, event) => set((state) => {
    const stream = state.activeA2AStreams[agentUrl];
    if (stream) {
      return {
        activeA2AStreams: {
          ...state.activeA2AStreams,
          [agentUrl]: {
            ...stream,
            events: [...stream.events, event],
          }
        }
      };
    }
    // If no stream exists yet, create one with the event
    // This can happen if a2a_stream_data arrives before a2a_stream_start
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
        }
      }
    };
  }),
  
  getA2AStreamByUrl: (agentUrl) => get().activeA2AStreams[agentUrl],
  
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));