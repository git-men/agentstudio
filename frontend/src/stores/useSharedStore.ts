import { create } from 'zustand';
import type { AgentConfig } from '../types/index.js';
import type { EngineUICapabilities } from '../hooks/useAGUIChat';
import { getDefaultUICapabilities } from '../hooks/useAGUIChat';
import type { EngineType } from './useAgentStore';

// ---------------------------------------------------------------------------
// Engine Type Cache (localStorage) — mirrored from useAgentStore
// ---------------------------------------------------------------------------

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
  return 'claude';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharedState {
  currentAgent: AgentConfig | null;
  selectedEngine: EngineType;
  engineUICapabilities: EngineUICapabilities;
  engineModels: Array<{ id: string; name: string; isVision?: boolean; isThinking?: boolean }>;
  sidebarCollapsed: boolean;
  workspaceSidebarWidth: number;
}

export interface SharedActions {
  setCurrentAgent: (agent: AgentConfig | null) => void;
  setSelectedEngine: (engine: EngineType) => void;
  setEngineUICapabilities: (capabilities: EngineUICapabilities) => void;
  setEngineModels: (models: Array<{ id: string; name: string; isVision?: boolean; isThinking?: boolean }>) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setWorkspaceSidebarWidth: (width: number) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSharedStore = create<SharedState & SharedActions>((set) => ({
  currentAgent: null,
  selectedEngine: getCachedEngineType(),
  engineUICapabilities: getDefaultUICapabilities(getCachedEngineType()),
  engineModels: [],
  sidebarCollapsed: false,
  workspaceSidebarWidth: 280,

  setCurrentAgent: (agent) => set({ currentAgent: agent }),

  setSelectedEngine: (engine) =>
    set({
      selectedEngine: engine,
      engineUICapabilities: getDefaultUICapabilities(engine),
    }),

  setEngineUICapabilities: (capabilities) => set({ engineUICapabilities: capabilities }),

  setEngineModels: (models) => set({ engineModels: models }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setWorkspaceSidebarWidth: (width) =>
    set({ workspaceSidebarWidth: Math.max(200, Math.min(600, width)) }),
}));
