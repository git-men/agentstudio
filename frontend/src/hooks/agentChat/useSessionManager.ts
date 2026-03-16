import { useState, useCallback } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import { authFetch } from '../../lib/authFetch';
import { API_BASE } from '../../lib/config';
import { sessionStoreManager } from '../../services/SessionStoreManager';
import type { StoreApi } from 'zustand';
import type { SessionState, SessionActions } from '../../stores/createSessionStore';

export interface UseSessionManagerProps {
  agentId: string;
  currentSessionId: string | null;
  projectPath?: string;
  onSessionChange?: (sessionId: string | null) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Optional: target session store for workspace mode.
   * When provided, messages are loaded into this store instead of
   * the global useAgentStore facade.
   */
  sessionStore?: StoreApi<SessionState & SessionActions>;
}

export interface UseSessionManagerReturn {
  isLoadingMessages: boolean;
  isNewSession: boolean;
  hasSuccessfulResponse: boolean;
  setIsLoadingMessages: (loading: boolean) => void;
  setIsNewSession: (isNew: boolean) => void;
  setHasSuccessfulResponse: (success: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  handleSwitchSession: (sessionId: string) => void;
  handleNewSession: () => void;
  handleRefreshMessages: () => void;
  loadMessagesForSession: (sessionId: string) => Promise<void>;
}

/**
 * Hook for managing session-related state and operations.
 *
 * In **legacy mode** (no sessionStore prop), behavior is identical to the
 * original: actions delegate to the useAgentStore facade.
 *
 * In **workspace mode** (sessionStore prop provided), session stores are
 * initialized via sessionStoreManager.getOrCreate() and messages are loaded
 * into the target session's store directly.
 */
export const useSessionManager = ({
  agentId,
  currentSessionId,
  projectPath,
  onSessionChange,
  textareaRef,
  sessionStore,
}: UseSessionManagerProps): UseSessionManagerReturn => {
  const { setCurrentSessionId: facadeSetSessionId, clearMessages: facadeClearMessages, loadSessionMessages: facadeLoadMessages } = useAgentStore();

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isNewSession, setIsNewSession] = useState(false);
  const [hasSuccessfulResponse, setHasSuccessfulResponse] = useState(false);

  // Decide where to load messages: target session store or facade
  const loadIntoStore = useCallback(
    (messages: any[], targetSessionId?: string) => {
      if (sessionStore) {
        sessionStore.getState().loadSessionMessages(messages);
      } else if (targetSessionId) {
        // Workspace-aware: load into the session store if it exists
        const store = sessionStoreManager.getStore(targetSessionId);
        if (store) {
          store.getState().loadSessionMessages(messages);
        } else {
          facadeLoadMessages(messages);
        }
      } else {
        facadeLoadMessages(messages);
      }
    },
    [sessionStore, facadeLoadMessages],
  );

  const setCurrentSessionId = useCallback(
    (id: string | null) => {
      // In workspace mode, session switching is handled by the workspace page.
      // In legacy mode, delegate to the facade.
      if (!sessionStore) {
        facadeSetSessionId(id);
      }
      // For workspace mode: the session store is managed externally, so we
      // don't set sessionId on the facade (it would cause unnecessary rebinding).
    },
    [sessionStore, facadeSetSessionId],
  );

  /**
   * Imperatively fetch messages for a session and load them into the appropriate store.
   */
  const loadMessagesForSession = useCallback(
    async (sessionId: string) => {
      // Ensure the session store exists in the manager (workspace mode)
      sessionStoreManager.getOrCreate(sessionId, agentId);

      try {
        const url = new URL(`${API_BASE}/sessions/${agentId}/${sessionId}/messages`);
        if (projectPath) {
          url.searchParams.set('projectPath', projectPath);
        }
        const response = await authFetch(url.toString());
        if (!response.ok) {
          console.warn(`[SessionManager] Failed to fetch messages for ${sessionId}: ${response.status}`);
          return;
        }
        const data = await response.json();
        const converted = (data.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
        loadIntoStore(converted, sessionId);
      } catch (err) {
        console.warn('[SessionManager] Error fetching messages:', err);
      }
    },
    [agentId, projectPath, loadIntoStore],
  );

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      console.log(`[SessionManager] Switching to session ${sessionId}`);
      setCurrentSessionId(sessionId);
      setIsLoadingMessages(true);
      setIsNewSession(false);
      setHasSuccessfulResponse(false);
      onSessionChange?.(sessionId);
      await loadMessagesForSession(sessionId);
      setIsLoadingMessages(false);
    },
    [onSessionChange, setCurrentSessionId, loadMessagesForSession],
  );

  const handleNewSession = useCallback(() => {
    setCurrentSessionId(null);
    if (sessionStore) {
      sessionStore.getState().clearMessages();
    } else {
      facadeClearMessages();
    }
    setIsNewSession(true);
    setHasSuccessfulResponse(false);
    onSessionChange?.(null);
    setTimeout(() => {
      textareaRef?.current?.focus();
    }, 0);
  }, [onSessionChange, setCurrentSessionId, sessionStore, facadeClearMessages, textareaRef]);

  const handleRefreshMessages = useCallback(async () => {
    if (currentSessionId) {
      setIsLoadingMessages(true);
      await loadMessagesForSession(currentSessionId);
      setIsLoadingMessages(false);
    }
  }, [currentSessionId, loadMessagesForSession]);

  return {
    isLoadingMessages,
    isNewSession,
    hasSuccessfulResponse,
    setIsLoadingMessages,
    setIsNewSession,
    setHasSuccessfulResponse,
    setCurrentSessionId,
    handleSwitchSession,
    handleNewSession,
    handleRefreshMessages,
    loadMessagesForSession,
  };
};
