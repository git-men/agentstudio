/**
 * Backward-compatible shim for sub-agent state.
 *
 * Sub-agent tasks are now part of SessionState (managed by createSessionStore).
 * This file preserves the original useSubAgentStore API so that existing
 * consumers (TaskTool, SubAgentPanel, useAIStreamHandler, etc.) continue to
 * work unchanged.
 *
 * Internally the shim delegates reads/writes to the "current" session store
 * obtained via sessionStoreManager + useAgentStore.currentSessionId.
 */

import { create } from 'zustand';
import type { SubAgentMessage, SubAgentMessagePart } from '../components/tools/types';
import { sessionStoreManager } from '../services/SessionStoreManager';
import { useAgentStore } from './useAgentStore';

export interface ActiveSubAgentTask {
  parentToolUseId: string;
  sessionId: string;
  messageFlow: SubAgentMessage[];
  startedAt: number;
  lastUpdatedAt: number;
}

interface SubAgentState {
  activeTasks: Map<string, ActiveSubAgentTask>;
}

interface SubAgentActions {
  registerTaskTool: (taskToolClaudeId: string, sessionId: string) => void;
  activateSubAgent: (parentToolUseId: string, sessionId: string) => void;
  addSubAgentMessagePart: (parentToolUseId: string, part: SubAgentMessagePart) => void;
  getSubAgentMessageFlow: (parentToolUseId: string) => SubAgentMessage[];
  clearSubAgentTask: (parentToolUseId: string) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentSessionStore() {
  const sid = useAgentStore.getState().currentSessionId;
  if (!sid) return undefined;
  return sessionStoreManager.getStore(sid);
}

// ---------------------------------------------------------------------------
// Shim Store
// ---------------------------------------------------------------------------

const initialState: SubAgentState = {
  activeTasks: new Map(),
};

export const useSubAgentStore = create<SubAgentState & SubAgentActions>((set, get) => {
  // Sync activeTasks from the current session store whenever the session changes.
  // We subscribe to useAgentStore to detect currentSessionId changes, then
  // subscribe to the session store's subAgentTasks.
  let sessionUnsub: (() => void) | null = null;
  let prevSessionId: string | null = null;

  function syncSubAgentTasks() {
    const store = getCurrentSessionStore();
    if (store) {
      set({ activeTasks: store.getState().subAgentTasks });
    } else {
      set({ activeTasks: new Map() });
    }
  }

  function rebindToSession(sessionId: string | null) {
    if (sessionUnsub) {
      sessionUnsub();
      sessionUnsub = null;
    }

    if (!sessionId) {
      set({ activeTasks: new Map() });
      return;
    }

    const store = sessionStoreManager.getStore(sessionId);
    if (store) {
      set({ activeTasks: store.getState().subAgentTasks });
      sessionUnsub = store.subscribe((state) => {
        set({ activeTasks: state.subAgentTasks });
      });
    }
  }

  useAgentStore.subscribe((state, prevState) => {
    if (state.currentSessionId !== prevSessionId) {
      prevSessionId = state.currentSessionId;
      rebindToSession(state.currentSessionId);
    }
  });

  return {
    ...initialState,

    registerTaskTool: (taskToolClaudeId, sessionId) => {
      const store = getCurrentSessionStore();
      if (store) {
        store.getState().registerTaskTool(taskToolClaudeId, sessionId);
      }
    },

    activateSubAgent: (parentToolUseId, sessionId) => {
      const store = getCurrentSessionStore();
      if (store) {
        store.getState().activateSubAgent(parentToolUseId, sessionId);
      }
    },

    addSubAgentMessagePart: (parentToolUseId, part) => {
      const store = getCurrentSessionStore();
      if (store) {
        store.getState().addSubAgentMessagePart(parentToolUseId, part);
      }
    },

    getSubAgentMessageFlow: (parentToolUseId) => {
      const store = getCurrentSessionStore();
      if (store) {
        return store.getState().getSubAgentMessageFlow(parentToolUseId);
      }
      return [];
    },

    clearSubAgentTask: (parentToolUseId) => {
      const store = getCurrentSessionStore();
      if (store) {
        store.getState().clearSubAgentTask(parentToolUseId);
      }
    },

    reset: () => {
      const store = getCurrentSessionStore();
      if (store) {
        // Clear all subAgentTasks in the session store
        store.setState({ subAgentTasks: new Map() });
      }
      set({ activeTasks: new Map() });
    },
  };
});

// Selectors (unchanged API)
export const selectActiveSubAgentTask = (parentToolUseId: string) =>
  (state: SubAgentState) => state.activeTasks.get(parentToolUseId);

export const selectHasActiveSubAgents = () =>
  (state: SubAgentState) => state.activeTasks.size > 0;

