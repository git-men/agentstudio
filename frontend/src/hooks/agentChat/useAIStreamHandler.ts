import { useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '../../stores/useAgentStore';
import { tabManager } from '../../utils/tabManager';
import { eventBus, EVENTS } from '../../utils/eventBus';
import { SessionStreamManager } from '../../services/SessionStreamManager';
import { sessionStoreManager } from '../../services/SessionStoreManager';
import type { StoreApi } from 'zustand';
import type { SessionState, SessionActions } from '../../stores/createSessionStore';

/**
 * Container for managing streaming state.
 * Re-exported so that SessionStreamManager and tests can import from here.
 */
export interface StreamingState {
  activeBlocks: Map<string, import('../../types/index.js').StreamingBlock>;
  currentMessageId: string | null;
  isStreaming: boolean;
  wasStreamProcessed: boolean;
  pendingUpdate: {
    blockId: string;
    content: string;
    type: 'text' | 'thinking';
  } | null;
  rafId: number | null;
}

export interface UseAIStreamHandlerProps {
  agentId: string;
  currentSessionId: string | null;
  projectPath?: string;
  isCompactCommand?: boolean;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  onSessionChange?: (sessionId: string | null) => void;
  setIsInitializingSession: (init: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setIsNewSession: (isNew: boolean) => void;
  setAiTyping: (typing: boolean) => void;
  setHasSuccessfulResponse: (success: boolean) => void;
  /** Optional: use an externally-provided SessionStreamManager (workspace mode). */
  externalStreamManager?: SessionStreamManager;
}

/**
 * Thin wrapper around SessionStreamManager that preserves the original hook
 * interface (handleStreamMessage, handleStreamError, resetAiMessageId/resetMessageId).
 *
 * In **legacy /chat mode** the hook creates and manages its own SessionStreamManager
 * bound to the session store obtained from sessionStoreManager (via currentSessionId).
 *
 * In **workspace mode** an externalStreamManager is provided via props and the hook
 * simply delegates to it.
 *
 * Orchestration concerns that are NOT part of pure SSE processing (session init,
 * session resume, query invalidation, event bus, TabManager, callback props) are
 * handled in the wrapper before/after delegating to the SessionStreamManager.
 */
export const useAIStreamHandler = ({
  agentId,
  currentSessionId,
  projectPath,
  abortControllerRef,
  onSessionChange,
  setIsInitializingSession,
  setCurrentSessionId,
  setIsNewSession,
  setAiTyping,
  setHasSuccessfulResponse,
  externalStreamManager,
}: UseAIStreamHandlerProps) => {
  const { t } = useTranslation('components');
  const queryClient = useQueryClient();

  // Ref holding the internally-managed SessionStreamManager (legacy mode).
  const internalManagerRef = useRef<SessionStreamManager | null>(null);
  // Tracks the unique pending store ID for this handler instance.
  const pendingStoreIdRef = useRef<string | null>(null);

  /**
   * Lazily creates (or returns existing) SessionStreamManager for legacy mode.
   * The store is obtained from sessionStoreManager using currentSessionId, or
   * falls back to a store obtained via useAgentStore's current session.
   */
  const getOrCreateManager = useCallback((): SessionStreamManager => {
    if (externalStreamManager) return externalStreamManager;

    // Reuse existing if still valid
    if (internalManagerRef.current) return internalManagerRef.current;

    // Determine which session store to bind to
    let store: StoreApi<SessionState & SessionActions> | undefined;
    if (currentSessionId) {
      store = sessionStoreManager.getStore(currentSessionId);
    }

    if (!store) {
      // Fallback: create a pending session store with unique ID to avoid
      // collisions when multiple sessions are initialized concurrently.
      const pendingId = `__pending_${Date.now()}_${Math.random().toString(36).substr(2, 6)}__`;
      store = sessionStoreManager.getOrCreate(pendingId, agentId);
      pendingStoreIdRef.current = pendingId;
    }

    const mgr = new SessionStreamManager(store);
    mgr.setTranslateFn(t);
    internalManagerRef.current = mgr;

    const sid = currentSessionId || pendingStoreIdRef.current || '__pending__';
    sessionStoreManager.attachStream(sid, mgr);

    return mgr;
  }, [externalStreamManager, currentSessionId, agentId, t]);

  // Keep the translate function fresh on the manager
  useMemo(() => {
    if (internalManagerRef.current) {
      internalManagerRef.current.setTranslateFn(t);
    }
    if (externalStreamManager) {
      externalStreamManager.setTranslateFn(t);
    }
  }, [t, externalStreamManager]);

  // -----------------------------------------------------------------------
  // handleStreamMessage — wraps SessionStreamManager with orchestration
  // -----------------------------------------------------------------------

  const handleStreamMessage = useCallback(
    (data: any) => {
      const eventData = data as {
        type: string;
        sessionId?: string;
        session_id?: string;
        subtype?: string;
        message?: unknown;
        isSidechain?: boolean;
        event?: any;
      };

      // ---- Orchestration: session initialization ----
      if (
        eventData.type === 'system' &&
        eventData.subtype === 'init' &&
        (eventData.sessionId || eventData.session_id)
      ) {
        const newSessionId = eventData.sessionId || eventData.session_id;

        setIsInitializingSession(false);

        const isTempSessionId = (id: string) =>
          id.startsWith('session_') || id.startsWith('__pending_');

        const needsRealIdReplacement =
          (!currentSessionId && newSessionId) ||
          (currentSessionId && isTempSessionId(currentSessionId) && newSessionId && newSessionId !== currentSessionId);

        if (needsRealIdReplacement) {
          const oldTempId = currentSessionId && isTempSessionId(currentSessionId) ? currentSessionId : null;

          setCurrentSessionId(newSessionId!);
          setIsNewSession(true);
          onSessionChange?.(newSessionId!);
          queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });

          // Migrate temp store → real store (workspace mode with externalStreamManager)
          // Uses in-place re-keying to preserve the same store reference, preventing
          // React component unmount/remount that would abort the active SSE stream.
          if (oldTempId && externalStreamManager) {
            sessionStoreManager.migrateSession(oldTempId, newSessionId!);
          }

          // Rebind internal manager to the real session store (legacy mode)
          if (internalManagerRef.current) {
            const pendingId = pendingStoreIdRef.current;
            const pendingStore = pendingId ? sessionStoreManager.getStore(pendingId) : undefined;
            const realStore = sessionStoreManager.getOrCreate(newSessionId!, agentId);

            if (pendingStore && pendingStore !== realStore) {
              const pendingMessages = pendingStore.getState().messages;
              if (pendingMessages.length > 0 && realStore.getState().messages.length === 0) {
                realStore.getState().loadSessionMessages(pendingMessages);
              }
              if (pendingStore.getState().isAiTyping) {
                realStore.setState({ isAiTyping: true });
              }
              sessionStoreManager.dispose(pendingId!);
            }
            pendingStoreIdRef.current = null;

            const mgr = new SessionStreamManager(realStore);
            mgr.setTranslateFn(t);
            internalManagerRef.current = mgr;
            sessionStoreManager.attachStream(newSessionId!, mgr);
          }
        }
        return;
      }

      // ---- Orchestration: session resume (new branch) ----
      if (eventData.type === 'session_resumed' && (eventData as any).subtype === 'new_branch') {
        const resumeData = eventData as any;

        setIsInitializingSession(false);
        setCurrentSessionId(resumeData.newSessionId);
        setIsNewSession(true);
        onSessionChange?.(resumeData.newSessionId);

        // Delegate the "add resume message" to the manager's store
        const mgr = getOrCreateManager();
        mgr.handleStreamMessage({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: `${t('agentChat.sessionResumed')}\n\n${resumeData.message}\n\n${t('agentChat.sessionIdUpdated')}`,
              },
            ],
          },
        });

        queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });

        // TabManager session resume handling
        if (currentSessionId && resumeData.originalSessionId && resumeData.newSessionId) {
          tabManager.handleSessionResume(agentId, resumeData.originalSessionId, resumeData.newSessionId);
          tabManager.recordSessionResume(agentId, resumeData.originalSessionId, resumeData.newSessionId);
        }
        return;
      }

      // ---- Delegate all other events to SessionStreamManager ----
      const mgr = getOrCreateManager();
      mgr.handleStreamMessage(data);

      // ---- Post-delegation orchestration for result events ----
      if (eventData.type === 'result') {
        const isSideChain = (eventData as any).isSideChain;

        if (!isSideChain) {
          abortControllerRef.current = null;
          setAiTyping(false);

          if ((eventData as any).subtype === 'success') {
            setHasSuccessfulResponse(true);
            eventBus.emit(EVENTS.AI_RESPONSE_COMPLETE, {
              agentId,
              sessionId: currentSessionId,
              projectPath,
            });
          }

          if (currentSessionId) {
            queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });
          }
        }
      }

      // ---- Post-delegation orchestration for error events ----
      if (eventData.type === 'error') {
        setAiTyping(false);
        setIsInitializingSession(false);
        abortControllerRef.current = null;
      }
    },
    [
      agentId,
      currentSessionId,
      projectPath,
      abortControllerRef,
      onSessionChange,
      setIsInitializingSession,
      setCurrentSessionId,
      setIsNewSession,
      setAiTyping,
      setHasSuccessfulResponse,
      t,
      queryClient,
      getOrCreateManager,
      externalStreamManager,
    ],
  );

  // -----------------------------------------------------------------------
  // handleStreamError — wraps SessionStreamManager.handleStreamError
  // -----------------------------------------------------------------------

  const handleStreamError = useCallback(
    (error: unknown) => {
      setAiTyping(false);
      setIsInitializingSession(false);
      abortControllerRef.current = null;

      // Clean up pending store on error to prevent leaks
      if (pendingStoreIdRef.current) {
        sessionStoreManager.dispose(pendingStoreIdRef.current);
        pendingStoreIdRef.current = null;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      const mgr = getOrCreateManager();
      mgr.handleStreamError(error);
    },
    [abortControllerRef, setAiTyping, setIsInitializingSession, getOrCreateManager],
  );

  // -----------------------------------------------------------------------
  // resetMessageId
  // -----------------------------------------------------------------------

  const resetMessageId = useCallback(() => {
    if (externalStreamManager) {
      externalStreamManager.resetMessageId();
    } else if (internalManagerRef.current) {
      internalManagerRef.current.resetMessageId();
    }
  }, [externalStreamManager]);

  return {
    handleStreamMessage,
    handleStreamError,
    resetMessageId,
  };
};
