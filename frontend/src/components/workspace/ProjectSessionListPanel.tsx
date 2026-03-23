import React, { useState, useMemo } from 'react';
import { Plus, Search, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProjectSessions } from '../../hooks/useAgents';
import { sessionStoreManager } from '../../services/SessionStoreManager';
import { SessionItem } from './SessionItem';

interface SessionFromBackend {
  id: string;
  title: string;
  messageCount: number;
  lastUpdated: string;
  agentId?: string;
}

interface ProjectSessionListPanelProps {
  projectPath: string;
  projectName?: string;
  activeSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onRemoveSession?: (sessionId: string) => void;
}

/**
 * Left sidebar displaying sessions for a specific project.
 * Unlike SessionListPanel, this is project-centric: sessions may
 * come from different agents within the same project directory.
 */
export const ProjectSessionListPanel: React.FC<ProjectSessionListPanelProps> = ({
  projectPath,
  projectName,
  activeSessionId,
  onSessionSelect,
  onNewSession,
  onRemoveSession,
}) => {
  const { t } = useTranslation('components');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: sessionsData, isLoading } = useProjectSessions(
    projectPath,
    searchTerm,
  );

  const sessions: SessionFromBackend[] = useMemo(
    () => sessionsData?.sessions ?? [],
    [sessionsData],
  );

  const sortedSessions = useMemo(() => {
    return [...sessions].sort(
      (a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
    );
  }, [sessions]);

  return (
    <div className="flex flex-col h-full">
      {/* Project header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 mb-2">
          <FolderOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium truncate" title={projectPath}>
            {projectName || projectPath.split('/').pop() || 'Project'}
          </span>
        </div>
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('workspace.newSession', 'New Session')}
        </button>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 w-3.5 h-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('workspace.searchSessions', 'Search sessions…')}
            className="w-full pl-8 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 dark:placeholder-gray-500"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 dark:border-blue-400" />
          </div>
        ) : sortedSessions.length > 0 ? (
          sortedSessions.map((session) => {
            const storeApi = sessionStoreManager.getStore(session.id);
            return (
              <SessionItem
                key={session.id}
                sessionId={session.id}
                title={session.title}
                lastActivity={new Date(session.lastUpdated).getTime()}
                isActive={session.id === activeSessionId}
                storeApi={storeApi}
                onClick={() => onSessionSelect(session.id)}
                onRemove={onRemoveSession}
              />
            );
          })
        ) : (
          <div className="text-center py-12 px-4">
            {searchTerm ? (
              <>
                <Search className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspace.noMatchingSessions', 'No matching sessions')}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspace.noSessions', 'No sessions yet')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t('workspace.createFirst', 'Click "New Session" to start')}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
