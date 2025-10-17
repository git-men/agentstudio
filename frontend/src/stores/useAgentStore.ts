import { create } from 'zustand';
import type { AgentConfig, AgentMessage, ToolUsageData } from '../types/index.js';

interface McpStatusData {
  hasError: boolean;
  connectedServers?: Array<{ name: string; status: string }>;
  connectionErrors?: Array<{ name: string; status: string; error?: string }>;
  lastError?: string | null;
  lastErrorDetails?: string;
  lastUpdated?: number;
}

interface AgentState {
  // Current agent (框架层)
  currentAgent: AgentConfig | null;
  
  // Chat state (框架层通用聊天)
  messages: AgentMessage[];
  isAiTyping: boolean;
  currentSessionId: string | null;
  
  // MCP status (MCP工具状态)
  mcpStatus: McpStatusData;
  
  // UI state (框架层通用UI)
  sidebarCollapsed: boolean;
  
  // Actions
  setCurrentAgent: (agent: AgentConfig | null) => void;
  
  addMessage: (message: Omit<AgentMessage, 'id' | 'timestamp' | 'agentId'>) => void;
  updateMessage: (messageId: string, updates: Partial<AgentMessage>) => void;
  addTextPartToMessage: (messageId: string, text: string) => void;
  addThinkingPartToMessage: (messageId: string, thinking: string) => void;
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
  
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  // Initial state
  currentAgent: null,
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
                  id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
              part.type === 'tool' && part.toolData?.id === toolId
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
  
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));