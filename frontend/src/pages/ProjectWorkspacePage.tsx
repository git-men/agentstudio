import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../lib/environment';
import { closeCurrentWindow } from '../lib/tauriWindows';
import { useQueryClient } from '@tanstack/react-query';
import { useAgent, useProjectSessions } from '../hooks/useAgents';
import { useProjects } from '../hooks/useProjects';
import { useSharedStore } from '../stores/useSharedStore';
import { sessionStoreManager } from '../services/SessionStoreManager';
import { SessionStoreProvider } from '../stores/SessionStoreContext';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { ProjectSessionListPanel } from '../components/workspace/ProjectSessionListPanel';
import { ProjectToolbar } from '../components/workspace/ProjectToolbar';
import type { RightPanelView } from '../components/workspace/ProjectToolbar';
import { AGUIChatPanel } from '../components/AGUIChatPanel';
import { FileExplorer } from '../components/FileExplorer';
import { LAVSViewContainer } from '../components/LAVSViewContainer';
import { useAgentLAVS } from '../hooks/useAgentLAVS';
import { ProjectMemoryModal } from '../components/ProjectMemoryModal';
import { ProjectCommandsModal } from '../components/ProjectCommandsModal';
import { ProjectSubAgentsModal } from '../components/ProjectSubAgentsModal';
import { ProjectA2AModal } from '../components/ProjectA2AModal';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { ProjectVersionModal } from '../components/ProjectVersionModal';
import { ProjectIMChannelsModal } from '../components/ProjectIMChannelsModal';
import { MessageSquarePlus, FolderOpen, Search, Clock } from 'lucide-react';
import useEngine from '../hooks/useEngine';
import { formatRelativeTime } from '../utils/dateFormat';

/**
 * Inline project picker shown when no project is selected.
 */
const ProjectPicker: React.FC<{
  projects?: any[];
  navigate: ReturnType<typeof useNavigate>;
}> = ({ projects, navigate }) => {
  const { t } = useTranslation('pages');
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    const list = projects ?? [];
    const filtered = search
      ? list.filter(
          (p: any) =>
            p.name?.toLowerCase().includes(search.toLowerCase()) ||
            p.path?.toLowerCase().includes(search.toLowerCase()) ||
            p.description?.toLowerCase().includes(search.toLowerCase()),
        )
      : list;
    return [...filtered].sort(
      (a, b) =>
        new Date(b.lastAccessed || b.createdAt).getTime() -
        new Date(a.lastAccessed || a.createdAt).getTime(),
    );
  }, [projects, search]);

  const selectProject = (p: any) => {
    const params = new URLSearchParams();
    params.set('project', p.path);
    navigate(`/project-workspace?${params.toString()}`);
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center pt-[12vh] px-4">
      <FolderOpen className="w-12 h-12 text-blue-500 dark:text-blue-400 mb-4" />
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
        {t('projectWorkspace.pickTitle', '选择项目')}
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {t('projectWorkspace.pickDesc', '选择一个项目进入工作区，或前往项目页面创建新项目')}
      </p>

      {/* Search */}
      <div className="relative w-full max-w-lg mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('projectWorkspace.searchProjects', '搜索项目…')}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Project list */}
      <div className="w-full max-w-lg flex-1 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
            {projects?.length
              ? t('projectWorkspace.noMatch', '没有匹配的项目')
              : t('projectWorkspace.empty', '暂无项目')}
          </div>
        ) : (
          sorted.map((p: any) => (
            <button
              key={p.id || p.path}
              onClick={() => selectProject(p)}
              className="w-full text-left px-4 py-3 hover:bg-blue-50 dark:hover:bg-gray-700/60 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl shrink-0">
                  {p.defaultAgentIcon || '📁'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-white truncate">
                    {p.name || p.dirName}
                  </div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {p.path}
                  </div>
                </div>
                {(p.lastAccessed || p.createdAt) && (
                  <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(p.lastAccessed || p.createdAt)}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer link */}
      <button
        onClick={() => navigate('/projects')}
        className="mt-4 mb-6 text-sm text-blue-600 dark:text-blue-400 hover:underline"
      >
        {t('projectWorkspace.manageProjects', '管理项目 →')}
      </button>
    </div>
  );
};

/**
 * ProjectWorkspacePage — project-centric multi-session workspace.
 * Route: /project-workspace?project=<encodedPath>&session=<id>
 *
 * Features:
 * - Left sidebar: session list (from ProjectSessionListPanel)
 * - Center: chat panel (AGUIChatPanel)
 * - Right panel: file browser (FileExplorer, toggleable)
 * - Bottom toolbar: project management actions (memory, commands, sub-agents, etc.)
 */
export const ProjectWorkspacePage: React.FC = () => {
  const { t } = useTranslation('pages');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectPath = searchParams.get('project') || '';
  const sessionFromUrl = searchParams.get('session');
  const agentFromUrl = searchParams.get('agent');

  const { data: projectsData } = useProjects();
  const project = useMemo(
    () => projectsData?.projects?.find((p: any) => p.path === projectPath),
    [projectsData, projectPath],
  );

  const { engineType: serviceEngineType } = useEngine();
  const isEngineReady = !!serviceEngineType;
  const { data: sessionsData } = useProjectSessions(projectPath, undefined, isEngineReady);

  const setCurrentAgent = useSharedStore((s) => s.setCurrentAgent);

  // ---------- Session state ----------
  const [sessionAgentMap, setSessionAgentMap] = useState<Record<string, string>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionFromUrl);

  // Stable render key for AGUIChatPanel — only changes on explicit user session
  // switches, NOT during temp→real ID migration (which would cause unnecessary remount
  // and disrupt the active SSE stream).
  const chatPanelKeyRef = useRef(0);

  const sidebarCollapsed = useSharedStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSharedStore((s) => s.setSidebarCollapsed);

  // ---------- Panel & modal state ----------
  const [rightPanelView, setRightPanelView] = useState<RightPanelView | null>('files');
  const [memoryProject, setMemoryProject] = useState<any>(null);
  const [commandsProject, setCommandsProject] = useState<any>(null);
  const [subAgentsProject, setSubAgentsProject] = useState<any>(null);
  const [a2aProject, setA2aProject] = useState<any>(null);
  const [settingsProject, setSettingsProject] = useState<any>(null);
  const [versionProject, setVersionProject] = useState<any>(null);
  const [showIMChannels, setShowIMChannels] = useState(false);

  // ---------- Derived state ----------
  const activeAgentId = useMemo(() => {
    if (activeSessionId && sessionAgentMap[activeSessionId]) {
      return sessionAgentMap[activeSessionId];
    }
    const backendSession = sessionsData?.sessions?.find(
      (s: any) => s.id === activeSessionId,
    );
    if (backendSession?.agentId) return backendSession.agentId;
    return project?.defaultAgent || '';
  }, [activeSessionId, sessionAgentMap, sessionsData, project]);

  const { data: agentData } = useAgent(activeAgentId);
  const agent = agentData?.agent;

  // LAVS detection for the active agent
  const { hasLAVS, loading: lavsLoading } = useAgentLAVS(activeAgentId);
  const hasLAVSView = hasLAVS && !lavsLoading;

  useEffect(() => {
    if (agent) setCurrentAgent(agent);
  }, [agent, setCurrentAgent]);

  // Auto-open LAVS view when agent has it (prioritize over default files view)
  useEffect(() => {
    if (hasLAVSView && rightPanelView !== 'lavs') {
      setRightPanelView('lavs');
    }
  }, [hasLAVSView]);

  // When switching agents, fall back from LAVS if new agent doesn't have it
  useEffect(() => {
    if (!lavsLoading && !hasLAVS && rightPanelView === 'lavs') {
      setRightPanelView('files');
    }
  }, [hasLAVS, lavsLoading, rightPanelView]);

  // Auto-create a new session when navigated with an explicit agent param,
  // unless a real session ID was also provided (e.g. fullscreen from Meta Agent).
  const agentBootedRef = useRef(false);
  useEffect(() => {
    if (!agentFromUrl || agentBootedRef.current || !projectPath) return;
    agentBootedRef.current = true;

    const isTempId = (id: string) =>
      id.startsWith('session_') || id.startsWith('__pending_');

    if (sessionFromUrl && !isTempId(sessionFromUrl)) {
      setSessionAgentMap((prev) => ({ ...prev, [sessionFromUrl]: agentFromUrl }));
      const store = sessionStoreManager.getOrCreate(sessionFromUrl, agentFromUrl);
      // Clear stale streaming state from a previous view (e.g. Meta Agent bubble)
      // so AGUIChatPanel's initial-load effect correctly enters the load branch.
      const storeState = store.getState();
      if (storeState.isAiTyping) {
        storeState.setAiTyping(false);
      }
      chatPanelKeyRef.current += 1;
      setActiveSessionId(sessionFromUrl);
    } else {
      const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setSessionAgentMap((prev) => ({ ...prev, [newId]: agentFromUrl }));
      sessionStoreManager.getOrCreate(newId, agentFromUrl);
      chatPanelKeyRef.current += 1;
      setActiveSessionId(newId);
    }
  }, [agentFromUrl, projectPath]);

  useEffect(() => {
    if (agentFromUrl) return;
    if (!activeSessionId && sessionsData?.sessions?.length > 0) {
      setActiveSessionId(sessionsData.sessions[0].id);
    }
  }, [activeSessionId, sessionsData, agentFromUrl]);

  useEffect(() => {
    if (!projectPath) return;
    const params = new URLSearchParams(searchParams);
    if (activeSessionId) {
      params.set('session', activeSessionId);
    } else {
      params.delete('session');
    }
    params.set('project', projectPath);
    params.delete('agent');
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [activeSessionId, projectPath, searchParams, setSearchParams]);

  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (disposeTimerRef.current) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      disposeTimerRef.current = setTimeout(() => sessionStoreManager.disposeAll(), 100);
    };
  }, []);

  const activeStore = useMemo(() => {
    if (!activeSessionId || !activeAgentId) return null;
    return sessionStoreManager.getOrCreate(activeSessionId, activeAgentId);
  }, [activeSessionId, activeAgentId]);

  // ---------- Session handlers ----------
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) return;
      if (activeAgentId) {
        sessionStoreManager.getOrCreate(sessionId, activeAgentId);
      }
      chatPanelKeyRef.current += 1;
      setActiveSessionId(sessionId);
    },
    [activeAgentId, activeSessionId],
  );

  const handleNewSession = useCallback(() => {
    const defaultAgentId = project?.defaultAgent;
    if (!defaultAgentId) return;
    const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setSessionAgentMap((prev) => ({ ...prev, [newId]: defaultAgentId }));
    sessionStoreManager.getOrCreate(newId, defaultAgentId);
    chatPanelKeyRef.current += 1;
    setActiveSessionId(newId);
  }, [project]);


  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      sessionStoreManager.dispose(sessionId);
      setSessionAgentMap((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      if (activeSessionId === sessionId) {
        const remaining = sessionsData?.sessions?.filter(
          (s: any) => s.id !== sessionId,
        );
        setActiveSessionId(remaining?.[0]?.id ?? null);
      }
    },
    [activeSessionId, sessionsData],
  );

  const handleSessionChange = useCallback(
    (sessionId: string | null) => {
      if (!sessionId) return;

      const isTempId = (id: string) =>
        id.startsWith('session_') || id.startsWith('__pending_');

      // Capture prevId synchronously before state update for migration logic
      const prevId = activeSessionId;
      const isRealToReal =
        prevId !== null &&
        prevId !== sessionId &&
        !isTempId(prevId) &&
        !isTempId(sessionId);

      if (prevId && prevId !== sessionId) {
        // Migrate agent mapping for any ID change (temp→real or real→real)
        setSessionAgentMap((prev) => {
          const agentId = prev[prevId];
          if (!agentId) return prev;
          const next = { ...prev, [sessionId]: agentId };
          delete next[prevId];
          return next;
        });

        // For real→real transitions (e.g. CLI branching / compaction),
        // re-key the store in place so the active panel keeps its messages.
        if (isRealToReal) {
          sessionStoreManager.migrateSession(prevId, sessionId);
        }
      }

      setActiveSessionId(sessionId);

      // Only refresh sidebar for meaningful changes (temp→real or new session).
      // Skip for real→real re-keying to avoid showing the new CLI session ID
      // as a duplicate entry alongside the original.
      if (!isRealToReal) {
        queryClient.invalidateQueries({ queryKey: ['project-sessions', projectPath] });
      }
    },
    [queryClient, projectPath, activeSessionId],
  );

  // ---------- No project: inline project picker ----------
  if (!projectPath) {
    return <ProjectPicker projects={projectsData?.projects} navigate={navigate} />;
  }

  // ---------- Empty state ----------
  const renderEmptyState = () => (
    <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-900">
      <div className="text-center max-w-sm px-6">
        <MessageSquarePlus className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {t('projectWorkspace.emptyTitle', 'Project Workspace')}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t(
            'projectWorkspace.emptyDescription',
            'Create a new session to start working on this project. You can choose which agent to use.',
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
      {isTauri() && (
        <button
          onClick={() => closeCurrentWindow()}
          className="fixed top-3 left-3 z-50 flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-gray-200/80 dark:bg-gray-700/80 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 backdrop-blur-sm transition-colors"
          title="关闭窗口"
        >
          ✕ 关闭
        </button>
      )}
      <WorkspaceLayout
        defaultRightWidth={600}
        hideRightToggle
        sidebar={
          <ProjectSessionListPanel
            projectPath={projectPath}
            projectName={project?.name}
            activeSessionId={activeSessionId}
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            onRemoveSession={handleRemoveSession}
          />
        }
        rightPanel={
          rightPanelView === 'lavs' && agent ? (
            <LAVSViewContainer
              agent={agent}
              projectPath={projectPath}
            />
          ) : (
            <FileExplorer
              projectPath={projectPath}
              onFileSelect={(filePath) => {
                console.log('Selected file:', filePath);
              }}
              className="h-full"
            />
          )
        }
        rightPanelVisible={rightPanelView !== null}
        onToggleRightPanel={() => setRightPanelView((v) => (v ? null : 'files'))}
        footer={
          <ProjectToolbar
            projectPath={projectPath}
            rightPanelView={rightPanelView}
            hasLAVS={hasLAVSView}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
            onSetRightPanelView={setRightPanelView}
            onMemoryManagement={() => setMemoryProject(project)}
            onCommandManagement={() => setCommandsProject(project)}
            onSubAgentManagement={() => setSubAgentsProject(project)}
            onA2AManagement={() => setA2aProject(project)}
            onVersionManagement={() => setVersionProject(project)}
            onIMChannels={() => setShowIMChannels(true)}
            onSettings={() => setSettingsProject(project)}
          />
        }
      >
        {activeStore && agent ? (
          <SessionStoreProvider value={activeStore}>
            <AGUIChatPanel
              key={chatPanelKeyRef.current}
              agent={agent}
              projectPath={projectPath}
              onSessionChange={handleSessionChange}
              onNewSession={handleNewSession}
              hideHeader
            />
          </SessionStoreProvider>
        ) : (
          renderEmptyState()
        )}
      </WorkspaceLayout>

      {memoryProject && (
        <ProjectMemoryModal
          project={memoryProject}
          onClose={() => setMemoryProject(null)}
        />
      )}

      {commandsProject && (
        <ProjectCommandsModal
          project={commandsProject}
          onClose={() => setCommandsProject(null)}
        />
      )}

      {subAgentsProject && (
        <ProjectSubAgentsModal
          project={subAgentsProject}
          onClose={() => setSubAgentsProject(null)}
        />
      )}

      {a2aProject && (
        <ProjectA2AModal
          project={a2aProject}
          onClose={() => setA2aProject(null)}
        />
      )}

      <ProjectSettingsModal
        isOpen={!!settingsProject}
        project={settingsProject}
        onClose={() => setSettingsProject(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['projects'] })}
      />

      <ProjectVersionModal
        isOpen={!!versionProject}
        project={versionProject}
        onClose={() => setVersionProject(null)}
      />

      <ProjectIMChannelsModal
        projectPath={projectPath}
        projectName={project?.name || project?.dirName}
        isOpen={showIMChannels}
        onClose={() => setShowIMChannels(false)}
      />
    </div>
  );
};
