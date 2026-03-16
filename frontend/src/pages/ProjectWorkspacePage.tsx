import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAgent, useProjectSessions } from '../hooks/useAgents';
import { useProjects } from '../hooks/useProjects';
import { useSharedStore } from '../stores/useSharedStore';
import { sessionStoreManager } from '../services/SessionStoreManager';
import { SessionStoreProvider } from '../stores/SessionStoreContext';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { ProjectSessionListPanel } from '../components/workspace/ProjectSessionListPanel';
import { ProjectToolbar } from '../components/workspace/ProjectToolbar';
import { AgentPickerModal } from '../components/workspace/AgentPickerModal';
import { AGUIChatPanel } from '../components/AGUIChatPanel';
import { FileExplorer } from '../components/FileExplorer';
import { ProjectMemoryModal } from '../components/ProjectMemoryModal';
import { ProjectCommandsModal } from '../components/ProjectCommandsModal';
import { ProjectSubAgentsModal } from '../components/ProjectSubAgentsModal';
import { ProjectA2AModal } from '../components/ProjectA2AModal';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { ProjectVersionModal } from '../components/ProjectVersionModal';
import { MessageSquarePlus, FolderOpen, ArrowLeft } from 'lucide-react';
import useEngine from '../hooks/useEngine';
import { openUrlInContext } from '../utils/navigation';
import type { AgentConfig } from '../types/index.js';

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

  const projectPath = searchParams.get('project') || '';
  const sessionFromUrl = searchParams.get('session');

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
  const [showAgentPicker, setShowAgentPicker] = useState(false);

  // ---------- Panel & modal state ----------
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [memoryProject, setMemoryProject] = useState<any>(null);
  const [commandsProject, setCommandsProject] = useState<any>(null);
  const [subAgentsProject, setSubAgentsProject] = useState<any>(null);
  const [a2aProject, setA2aProject] = useState<any>(null);
  const [settingsProject, setSettingsProject] = useState<any>(null);
  const [versionProject, setVersionProject] = useState<any>(null);

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

  useEffect(() => {
    if (agent) setCurrentAgent(agent);
  }, [agent, setCurrentAgent]);

  useEffect(() => {
    if (!activeSessionId && sessionsData?.sessions?.length > 0) {
      setActiveSessionId(sessionsData.sessions[0].id);
    }
  }, [activeSessionId, sessionsData]);

  useEffect(() => {
    if (!projectPath) return;
    const params = new URLSearchParams(searchParams);
    if (activeSessionId) {
      params.set('session', activeSessionId);
    } else {
      params.delete('session');
    }
    params.set('project', projectPath);
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true });
    }
  }, [activeSessionId, projectPath, searchParams, setSearchParams]);

  useEffect(() => {
    return () => sessionStoreManager.disposeAll();
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
      setActiveSessionId(sessionId);
    },
    [activeAgentId, activeSessionId],
  );

  const handleNewSession = useCallback(() => {
    setShowAgentPicker(true);
  }, []);

  const handleAgentSelected = useCallback(
    (selectedAgent: AgentConfig) => {
      setShowAgentPicker(false);
      const newId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      setSessionAgentMap((prev) => ({ ...prev, [newId]: selectedAgent.id }));
      sessionStoreManager.getOrCreate(newId, selectedAgent.id);
      setActiveSessionId(newId);
    },
    [],
  );

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
      if (sessionId) setActiveSessionId(sessionId);
    },
    [],
  );

  // ---------- Toolbar handlers ----------
  const handleOpenInChat = useCallback(() => {
    if (!project) return;
    const agentToUse = project.defaultAgent || 'claude-code';
    const params = new URLSearchParams();
    params.set('project', project.path);
    openUrlInContext(`/chat/${agentToUse}?${params.toString()}`, navigate);
  }, [project, navigate]);

  // ---------- Error state ----------
  if (!projectPath) {
    return (
      <div className="h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md">
          <FolderOpen className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {t('projectWorkspace.noProject', 'No project selected')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('projectWorkspace.noProjectDesc', 'Please select a project from the projects page.')}
          </p>
          <button
            onClick={() => navigate('/projects')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('projectWorkspace.goToProjects', 'Go to Projects')}
          </button>
        </div>
      </div>
    );
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
      <WorkspaceLayout
        defaultRightWidth={600}
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
          <FileExplorer
            projectPath={projectPath}
            onFileSelect={(filePath) => {
              console.log('Selected file:', filePath);
            }}
            className="h-full"
          />
        }
        rightPanelVisible={fileBrowserOpen}
        onToggleRightPanel={() => setFileBrowserOpen((v) => !v)}
        footer={
          <ProjectToolbar
            projectName={project?.name || project?.dirName || 'Project'}
            projectPath={projectPath}
            fileBrowserOpen={fileBrowserOpen}
            onToggleFileBrowser={() => setFileBrowserOpen((v) => !v)}
            onMemoryManagement={() => setMemoryProject(project)}
            onCommandManagement={() => setCommandsProject(project)}
            onSubAgentManagement={() => setSubAgentsProject(project)}
            onA2AManagement={() => setA2aProject(project)}
            onVersionManagement={() => setVersionProject(project)}
            onSettings={() => setSettingsProject(project)}
            onOpenInChat={handleOpenInChat}
          />
        }
      >
        {activeStore && agent ? (
          <SessionStoreProvider value={activeStore}>
            <AGUIChatPanel
              key={activeSessionId}
              agent={agent}
              projectPath={projectPath}
              onSessionChange={handleSessionChange}
            />
          </SessionStoreProvider>
        ) : (
          renderEmptyState()
        )}
      </WorkspaceLayout>

      {/* Modals */}
      <AgentPickerModal
        open={showAgentPicker}
        onClose={() => setShowAgentPicker(false)}
        onSelect={handleAgentSelected}
      />

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
      />

      <ProjectVersionModal
        isOpen={!!versionProject}
        project={versionProject}
        onClose={() => setVersionProject(null)}
      />
    </div>
  );
};
