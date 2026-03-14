import { useState, useCallback } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import { authFetch } from '../../lib/authFetch';
import { API_BASE } from '../../lib/config';

export interface UseSessionManagerProps {
  agentId: string;
  currentSessionId: string | null;
  projectPath?: string;
  onSessionChange?: (sessionId: string | null) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
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
 * Message loading is fully imperative (no react-query) to avoid race
 * conditions between automatic refetches and live-streamed store data.
 */
export const useSessionManager = ({
  agentId,
  currentSessionId,
  projectPath,
  onSessionChange,
  textareaRef
}: UseSessionManagerProps): UseSessionManagerReturn => {
  const { setCurrentSessionId, clearMessages, loadSessionMessages } = useAgentStore();

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isNewSession, setIsNewSession] = useState(false);
  const [hasSuccessfulResponse, setHasSuccessfulResponse] = useState(false);

  /**
   * Imperatively fetch messages for a session and load them into the store.
   *
   * After the async fetch completes, re-check `isAiTyping` from the store:
   * if streaming started while the request was in flight, discard the
   * response to avoid overwriting live-streamed data.
   */
  const loadMessagesForSession = useCallback(async (sessionId: string) => {
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

      // Stale-check: if streaming started while the fetch was in flight,
      // discard the result — the store already has live-streamed data.
      const { isAiTyping, currentSessionId: storeSessionId } = useAgentStore.getState();
      if (isAiTyping) {
        console.log(`[SessionManager] Discarding fetched messages — streaming is active`);
        return;
      }
      if (storeSessionId !== sessionId) {
        console.log(`[SessionManager] Discarding fetched messages — session changed (wanted ${sessionId}, current ${storeSessionId})`);
        return;
      }

      const converted = (data.messages || []).map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp),
      }));
      loadSessionMessages(converted);
    } catch (err) {
      console.warn('[SessionManager] Error fetching messages:', err);
    }
  }, [agentId, projectPath, loadSessionMessages]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    // Refuse to switch while streaming — it would corrupt both sessions
    const { isAiTyping } = useAgentStore.getState();
    if (isAiTyping) {
      console.warn(`[SessionManager] Ignoring session switch to ${sessionId} — AI is still streaming`);
      return;
    }

    console.log(`[SessionManager] Switching to session ${sessionId}`);
    setCurrentSessionId(sessionId);
    setIsLoadingMessages(true);
    setIsNewSession(false);
    setHasSuccessfulResponse(false);
    if (onSessionChange) {
      onSessionChange(sessionId);
    }
    await loadMessagesForSession(sessionId);
    setIsLoadingMessages(false);
  }, [onSessionChange, setCurrentSessionId, loadMessagesForSession]);

  const handleNewSession = useCallback(() => {
    setCurrentSessionId(null);
    clearMessages();
    setIsNewSession(true);
    setHasSuccessfulResponse(false);
    if (onSessionChange) {
      onSessionChange(null);
    }
    setTimeout(() => {
      textareaRef?.current?.focus();
    }, 0);
  }, [onSessionChange, setCurrentSessionId, clearMessages, textareaRef]);

  const handleRefreshMessages = useCallback(async () => {
    // Guard: don't refresh while streaming
    const { isAiTyping } = useAgentStore.getState();
    if (isAiTyping) {
      console.warn('[SessionManager] Ignoring refresh — AI is still streaming');
      return;
    }
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
