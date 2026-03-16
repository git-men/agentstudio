import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAgent } from '../hooks/useAgents';
import { useAgentSessions } from '../hooks/useAgents';
import { useSharedStore } from '../stores/useSharedStore';
import { sessionStoreManager } from '../services/SessionStoreManager';
import { SessionStoreProvider } from '../stores/SessionStoreContext';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { SessionListPanel } from '../components/workspace/SessionListPanel';
import { AGUIChatPanel } from '../components/AGUIChatPanel';
import { MessageSquarePlus } from 'lucide-react';
import useEngine from '../hooks/useEngine';

/**
 * WorkspacePage — multi-session workspace with sidebar and chat panel.
 * Route: /workspace/:agentId?session=<id>
 */
export const WorkspacePage: React.FC = () => {
  const { t } = useTranslation('pages');
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const { data: agentData, isLoading: isAgentLoading, error: agentError } = useAgent(agentId!);
  const agent = agentData?.agent;

  const { engineType: serviceEngineType } = useEngine();
  const isEngineReady = !!serviceEngineType;
  const { data: sessionsData } = useAgentSessions(agentId!, undefined, undefined, isEngineReady);

  const setCurrentAgent = useSharedStore((s) => s.setCurrentAgent);

  // Active session ID — from URL ?session=<id> or first session
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    searchParams.get('session'),
  );

  // Sync agent to shared store
  useEffect(() => {
    if (agent) {
      setCurrentAgent(agent);
    }
  }, [agent, setCurrentAgent]);

  // Auto-select first session if none is active
  useEffect(() => {
    if (!activeSessionId && sessionsData?.sessions?.length > 0) {
      const firstId = sessionsData.sessions[0].id;
      setActiveSessionId(firstId);
    }
  }, [activeSessionId, sessionsData]);

  // Keep URL in sync with active session
  useEffect(() => {
    if (activeSessionId) {
      const current = searchParams.get('session');
      if (current !== activeSessionId) {
        setSearchParams({ session: activeSessionId }, { replace: true });
      }
    }
  }, [activeSessionId, searchParams, setSearchParams]);

  // Dispose all session stores on unmount
  useEffect(() => {
    return () => {
      sessionStoreManager.disposeAll();
    };
  }, []);

  // Get or create the active session's store
  const activeStore = useMemo(() => {
    if (!activeSessionId || !agentId) return null;
    return sessionStoreManager.getOrCreate(activeSessionId, agentId);
  }, [activeSessionId, agentId]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (!agentId || sessionId === activeSessionId) return;
      sessionStoreManager.getOrCreate(sessionId, agentId);
      setActiveSessionId(sessionId);
    },
    [agentId, activeSessionId],
  );

  const handleNewSession = useCallback(() => {
    if (!agentId) return;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStoreManager.getOrCreate(newId, agentId);
    setActiveSessionId(newId);
  }, [agentId]);

  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      sessionStoreManager.dispose(sessionId);
      if (activeSessionId === sessionId) {
        const remaining = sessionsData?.sessions?.filter(
          (s: { id: string }) => s.id !== sessionId,
        );
        setActiveSessionId(remaining?.[0]?.id ?? null);
      }
    },
    [activeSessionId, sessionsData],
  );

  const handleSessionChange = useCallback(
    (sessionId: string | null) => {
      if (sessionId) {
        setActiveSessionId(sessionId);
      }
    },
    [],
  );

  // ---------- Loading / Error states ----------

  if (isAgentLoading) {
    return (
      <div className="h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <div className="text-gray-600 dark:text-gray-400">
            {t('chat.loading', 'Loading…')}
          </div>
        </div>
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className="h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-6">❌</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {t('chat.agentNotFound', 'Agent Not Found')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('chat.agentNotFoundDesc', 'The agent could not be found.')}
          </p>
          <button
            onClick={() => navigate('/agents')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('chat.closePage', 'Go back')}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Empty state (no sessions) ----------

  const renderEmptyState = () => (
    <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-900">
      <div className="text-center max-w-sm px-6">
        <MessageSquarePlus className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {t('workspace.emptyTitle', 'Welcome to Workspace')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t(
            'workspace.emptyDescription',
            'Create a new session to start chatting with your agent.',
          )}
        </p>
        <button
          onClick={handleNewSession}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {t('workspace.newSession', 'New Session')}
        </button>
      </div>
    </div>
  );

  // ---------- Main render ----------

  return (
    <div className="h-screen bg-gray-100 dark:bg-gray-900">
      <WorkspaceLayout
        sidebar={
          <SessionListPanel
            agentId={agentId!}
            projectPath={agent.workingDirectory || undefined}
            activeSessionId={activeSessionId}
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            onRemoveSession={handleRemoveSession}
          />
        }
      >
        {activeStore ? (
          <SessionStoreProvider value={activeStore}>
            <AGUIChatPanel
              agent={agent}
              projectPath={agent.workingDirectory || undefined}
              onSessionChange={handleSessionChange}
            />
          </SessionStoreProvider>
        ) : (
          renderEmptyState()
        )}
      </WorkspaceLayout>
    </div>
  );
};
