import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openProjectWindow } from '../lib/tauriWindows';
import {
  Bot,
  FolderOpen,
  Plus,
  Clock,
  ChevronRight,
  AlertTriangle,
  ExternalLink,
  X,
  Loader2,
  MessageCircle,
  FolderPlus,
  FolderDown,
  Folder,
  MessageSquare,
  Zap,
  Maximize2,
  Smartphone,
  ChevronDown,
  Check,
} from 'lucide-react';
import { ProjectSelector } from '../components/ProjectSelector';
import { FileBrowser } from '../components/FileBrowser';
import { useTranslation } from 'react-i18next';
import { useProjects, Project } from '../hooks/useProjects';
import { useAgents } from '../hooks/useAgents';
import { useAgent } from '../hooks/useAgents';
import { useAgentSessions } from '../hooks/useAgents';
import { useAgentStore } from '../stores/useAgentStore';
import { useProviderHealthCheck } from '../hooks/useProviderHealthCheck';
import { AGUIChatPanel } from '../components/AGUIChatPanel';
import { SessionsDropdown } from '../components/SessionsDropdown';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { showError } from '../utils/toast';
import { useConfirm } from '../hooks/useConfirm';
import { AgentEditModal } from '../components/AgentEditModal';
import { IMBindingModal } from '../components/IMBindingModal';
import { fetchProjectActivity } from '../utils/projectLastMessage';
import type { AgentConfig } from '../types/index.js';

const META_AGENT_ID = 'meta-agent';
const META_AGENT_SESSION_KEY = 'agentstudio:meta-agent-session';
/** Shared with MetaAgentBubble so the open/closed state persists across route changes. */
const META_AGENT_OPEN_STATE_KEY = 'agentstudio:meta-agent-open';

function getSavedMetaAgentSession(): string | null {
  try {
    return localStorage.getItem(META_AGENT_SESSION_KEY);
  } catch {
    return null;
  }
}

function saveMetaAgentSession(sessionId: string | null) {
  try {
    if (sessionId) {
      localStorage.setItem(META_AGENT_SESSION_KEY, sessionId);
    } else {
      localStorage.removeItem(META_AGENT_SESSION_KEY);
    }
  } catch { /* ignore */ }
}

function markMetaAgentOpen() {
  try {
    localStorage.setItem(META_AGENT_OPEN_STATE_KEY, '1');
  } catch { /* ignore */ }
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}m 前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h 前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d 前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export const META_AGENT_PREFILL_EVENT = 'meta-agent:prefill-draft';

const MIN_PANEL_WIDTH = 280;
const DEFAULT_PANEL_WIDTH = 380;
const MAX_PANEL_WIDTH = 640;
const PANEL_WIDTH_KEY = 'agentstudio:meta-agent-panel-width';

/** Embedded Meta Agent chat panel for the new Dashboard right column. */
const EmbeddedMetaPanel: React.FC = () => {
  const { data: agentData, isLoading, error } = useAgent(META_AGENT_ID);
  const { setCurrentAgentAndSession, currentAgent } = useAgentStore();
  const agentRef = useRef<AgentConfig | null>(null);
  const activated = useRef(false);
  const [draftMessage, setDraftMessage] = React.useState<string | undefined>(undefined);

  const agent = agentData?.agent;

  useEffect(() => {
    if (agent) {
      agentRef.current = agent;
    }
  }, [agent]);

  const activateMetaAgent = useCallback(() => {
    const metaAgent = agentRef.current;
    if (!metaAgent) return;
    const savedSession = getSavedMetaAgentSession();
    if (currentAgent?.id !== META_AGENT_ID) {
      setCurrentAgentAndSession(metaAgent, savedSession);
    }
  }, [currentAgent?.id, setCurrentAgentAndSession]);

  useEffect(() => {
    if (agent && !activated.current) {
      activated.current = true;
      activateMetaAgent();
    }
  }, [agent, activateMetaAgent]);

  // Tell MetaAgentBubble (other pages) that this panel is "open",
  // so navigating away keeps the floating panel open instead of collapsed.
  useEffect(() => {
    markMetaAgentOpen();
  }, []);

  // Listen for prefill events from AddAgentCard
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      if (msg) setDraftMessage(msg);
    };
    window.addEventListener(META_AGENT_PREFILL_EVENT, handler);
    return () => window.removeEventListener(META_AGENT_PREFILL_EVENT, handler);
  }, []);

  const handleSessionChange = useCallback((newSessionId: string | null) => {
    saveMetaAgentSession(newSessionId);
  }, []);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !agent || !agent.enabled) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 p-8 text-center">
        <Bot className="w-10 h-10" />
        <p className="text-sm">Meta Agent 暂不可用</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0">
      <AGUIChatPanel
        agent={agent}
        onSessionChange={handleSessionChange}
        environmentContext="用户当前所在页面：Dashboard 首页"
        hideHeader={true}
        draftMessage={draftMessage}
      />
    </div>
  );
};

/** Agent icon card in the agent grid */
const AgentCard: React.FC<{
  agent: AgentConfig;
  onClick: () => void;
}> = ({ agent, onClick }) => {
  const isMetaAgent = agent.id === META_AGENT_ID;

  return (
    <button
      onClick={onClick}
      className={`
        group flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center
        ${isMetaAgent
          ? 'bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 border-indigo-200 dark:border-indigo-700/50 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-sm'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
        }
      `}
    >
      <div className={`
        w-9 h-9 rounded-lg flex items-center justify-center text-xl flex-shrink-0
        ${isMetaAgent
          ? 'bg-indigo-100 dark:bg-indigo-800/50'
          : 'bg-gray-100 dark:bg-gray-700'
        }
      `}>
        {agent.ui?.icon && agent.ui.icon.length <= 4 ? (
          <span className="text-base">{agent.ui.icon}</span>
        ) : (
          <Bot className={`w-5 h-5 ${isMetaAgent ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-300'}`} />
        )}
      </div>
      <div className="w-full min-w-0">
        <div className={`
          text-xs font-semibold leading-tight truncate
          ${isMetaAgent
            ? 'text-indigo-900 dark:text-indigo-100'
            : 'text-gray-800 dark:text-gray-200'
          }
        `}>
          {isMetaAgent && '✨ '}{agent.ui?.headerTitle || agent.name}
        </div>
        {agent.description && (
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-1 leading-snug">
            {agent.description}
          </div>
        )}
      </div>
    </button>
  );
};

/** Recent project row */
const ProjectRow: React.FC<{
  project: Project;
  defaultAgentName?: string;
  defaultAgentIcon?: string;
  lastMessage?: string;
  onClick: () => void;
}> = ({ project, defaultAgentName, defaultAgentIcon, lastMessage, onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all group text-left"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        {defaultAgentIcon && defaultAgentIcon.length <= 4 ? (
          <span className="text-base">{defaultAgentIcon}</span>
        ) : (
          <FolderOpen className="w-4 h-4 text-blue-500 dark:text-blue-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
            {project.name}
          </span>
          {lastMessage && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1 min-w-0" title={lastMessage}>
              {lastMessage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[160px]" title={project.path}>
            {project.path}
          </span>
          {defaultAgentName && (
            <>
              <span className="text-gray-300 dark:text-gray-600">·</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                <Bot className="w-3 h-3" />
                {defaultAgentName}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {project.lastAccessed && (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(project.lastAccessed)}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" />
      </div>
    </button>
  );
};

/**
 * Inline "Add Agent" button with a popover offering Meta Agent guided creation vs. manual.
 */
const AddAgentButton: React.FC<{ onManualCreate: () => void }> = ({ onManualCreate }) => {
  const [showTip, setShowTip] = React.useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowTip(v => !v)}
        className="text-xs text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        添加 Agent
      </button>

      {showTip && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowTip(false)} />
          <div className="absolute right-0 top-full mt-2 w-64 z-20 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              你可以让右侧的 <span className="font-medium text-indigo-600 dark:text-indigo-400">Meta Agent</span> 帮你创建，或者手动配置。
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowTip(false);
                  const msg = '我想创建一个新的 Agent，帮我引导一下，了解一下我的需求后帮我配置好。';
                  window.dispatchEvent(new CustomEvent(META_AGENT_PREFILL_EVENT, { detail: msg }));
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 text-sm text-indigo-700 dark:text-indigo-300 font-medium transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                让 Meta Agent 帮我创建
              </button>
              <button
                onClick={() => { setShowTip(false); onManualCreate(); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 transition-colors"
              >
                <Bot className="w-4 h-4 text-gray-400" />
                手动创建 Agent
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * New Dashboard — left column: Agent grid + Recent projects
 *                             right column: Embedded Meta Agent panel
 */
export const NewDashboard: React.FC = () => {
  const { t } = useTranslation('pages');
  const navigate = useNavigate();
  const confirm = useConfirm();

  const { data: projectsData, isLoading: isLoadingProjects, refetch: refetchProjects } = useProjects();
  const { data: agentsData } = useAgents(true);
  const providerHealth = useProviderHealthCheck();

  const projects = projectsData?.projects || [];
  const agents = agentsData?.agents || [];
  const enabledAgents = agents
    .filter(a => a.enabled && a.id !== META_AGENT_ID)
    .sort((a, b) => a.name.localeCompare(b.name));

  const recentProjects = [...projects]
    .sort((a, b) => {
      const ta = a.lastAccessed ? new Date(a.lastAccessed).getTime() : 0;
      const tb = b.lastAccessed ? new Date(b.lastAccessed).getTime() : 0;
      return tb - ta;
    })
    .slice(0, 10);

  const [projectLastMessages, setProjectLastMessages] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (recentProjects.length === 0) return;
    const paths = recentProjects.map(p => p.path);
    fetchProjectActivity(paths).then(setProjectLastMessages);
  }, [recentProjects.map(p => p.path).join(',')]);

  const currentSessionId = useAgentStore((s) => s.currentSessionId);

  const [metaAgentResolvedPath, setMetaAgentResolvedPath] = useState<string | null>(null);
  useEffect(() => {
    const metaAgent = agents.find(a => a.id === META_AGENT_ID);
    if (!metaAgent?.workingDirectory) return;
    authFetch(`${API_BASE}/files/resolve?path=${encodeURIComponent(metaAgent.workingDirectory)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.resolved) setMetaAgentResolvedPath(data.resolved); })
      .catch(() => {});
  }, [agents]);

  // ── Session history for Meta Agent panel ──
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const { data: metaSessionsData, refetch: refetchMetaSessions } = useAgentSessions(
    META_AGENT_ID, sessionSearchTerm, metaAgentResolvedPath || undefined
  );

  useEffect(() => {
    if (showSessionHistory) refetchMetaSessions();
  }, [showSessionHistory, refetchMetaSessions]);

  const handleMetaSessionSwitch = useCallback(async (sessionId: string) => {
    const store = useAgentStore.getState();
    if (store.isAiTyping) return;
    store.setCurrentSessionId(sessionId);
    saveMetaAgentSession(sessionId);
    try {
      const url = new URL(`${API_BASE}/sessions/${META_AGENT_ID}/${sessionId}/messages`);
      if (metaAgentResolvedPath) url.searchParams.set('projectPath', metaAgentResolvedPath);
      const response = await authFetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        const converted = (data.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        }));
        useAgentStore.getState().loadSessionMessages(converted);
      }
    } catch (err) {
      console.warn('[Dashboard] Failed to load session messages:', err);
    }
    setShowSessionHistory(false);
  }, [metaAgentResolvedPath]);

  const [selectedAgent, setSelectedAgent] = React.useState<AgentConfig | null>(null);

  // ── Create / Import project modals ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', agentId: '', directory: '~/claude-code-projects', description: '' });
  const [showCreateFileBrowser, setShowCreateFileBrowser] = useState(false);
  const [showCreateAgentDropdown, setShowCreateAgentDropdown] = useState(false);

  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [showImportBrowser, setShowImportBrowser] = useState(false);

  // ── Create Agent modal ──
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);

  // ── IM Binding state ──
  const [bindingCounts, setBindingCounts] = useState<Record<string, number>>({ wecom: 0, qqbot: 0, weixin: 0 });
  const [imModalPlatform, setImModalPlatform] = useState<'wecom' | 'qqbot' | 'weixin' | null>(null);

  useEffect(() => {
    authFetch(`${API_BASE}/im-bindings`)
      .then(r => r.ok ? r.json() : { bindings: [] })
      .then(data => {
        const counts: Record<string, number> = { wecom: 0, qqbot: 0, weixin: 0 };
        for (const b of data.bindings || []) {
          if (b.platform in counts) counts[b.platform]++;
        }
        setBindingCounts(counts);
      })
      .catch(() => {});
  }, [imModalPlatform]);

  const allEnabledAgents = agents.filter(a => a.enabled);

  useEffect(() => {
    if (showCreateModal) {
      setCreateForm({
        name: '',
        agentId: allEnabledAgents.length > 0 ? allEnabledAgents[0].id : '',
        directory: '~/claude-code-projects',
        description: '',
      });
    }
  }, [showCreateModal]);

  const handleOpenProject = (projectPath: string, projectName?: string) => {
    openProjectWindow(projectPath, projectName);
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name || !createForm.agentId) return;
    try {
      const response = await authFetch(`${API_BASE}/projects/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: createForm.agentId,
          projectName: createForm.name,
          parentDirectory: createForm.directory,
          description: createForm.description,
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setShowCreateModal(false);
        refetchProjects();
        openProjectWindow(result.project.path);
      } else {
        const error = await response.json();
        throw new Error(error.error || '创建项目失败');
      }
    } catch (error) {
      showError('创建项目失败', error instanceof Error ? error.message : '未知错误');
    }
  };

  const handleImportProject = async () => {
    if (!importPath.trim()) return;
    try {
      const checkResponse = await authFetch(`${API_BASE}/files/browse?path=${encodeURIComponent(importPath)}`);
      if (!checkResponse.ok) throw new Error('目录不存在或无法访问');
      const dirData = await checkResponse.json();
      if (!dirData.isDirectory) throw new Error('请选择一个目录');

      const firstAgent = allEnabledAgents[0];
      if (!firstAgent) throw new Error('没有可用的代理');

      const response = await authFetch(`${API_BASE}/projects/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: firstAgent.id, projectPath: importPath }),
      });
      if (response.ok) {
        const result = await response.json();
        setShowImportModal(false);
        setImportPath('');
        refetchProjects();
        const shouldOpen = await confirm({
          title: '导入成功',
          message: `项目 "${result.project.name}" 导入成功！\n\n是否立即打开该项目？`,
          confirmText: '打开项目',
          cancelText: '稍后',
          variant: 'info',
        });
        if (shouldOpen) openProjectWindow(result.project.path);
      } else {
        const error = await response.json();
        throw new Error(error.error || '导入项目失败');
      }
    } catch (error) {
      showError('导入项目失败', error instanceof Error ? error.message : '未知错误');
    }
  };

  // Right panel resize — synced via localStorage with MetaAgentBubble
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY);
      if (!saved) return DEFAULT_PANEL_WIDTH;
      const v = parseInt(saved, 10);
      if (v > MAX_PANEL_WIDTH) return DEFAULT_PANEL_WIDTH;
      return Math.max(MIN_PANEL_WIDTH, v);
    } catch { return DEFAULT_PANEL_WIDTH; }
  });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(panelWidth);

  useEffect(() => {
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* ignore */ }
  }, [panelWidth]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panelWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const diff = resizeStartXRef.current - ev.clientX;
      const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, resizeStartWidthRef.current + diff));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  const handleAgentClick = (agent: AgentConfig) => {
    // Show project picker so user can select a project to use with this agent
    setSelectedAgent(agent);
  };

  const handleProjectClick = (project: Project) => {
    openProjectWindow(project.path, project.name);
  };

  return (
    <>
    {/* Project selector modal — triggered when user clicks an Agent card */}
    {selectedAgent && (
      <ProjectSelector
        agent={selectedAgent}
        onProjectSelect={(projectPath) => {
          openProjectWindow({
            projectPath,
            agentId: selectedAgent.id,
          });
          setSelectedAgent(null);
        }}
        onClose={() => setSelectedAgent(null)}
      />
    )}

    <div className="h-full flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* ─── Left column: Agent grid + Recent projects ─── */}
      <div className="flex-1 overflow-y-auto px-6 py-8 min-w-0">
        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">
            {t('dashboard.welcome.title', { defaultValue: '让我们开始工作吧' })}
          </h1>
        </div>

        <div style={{ zoom: 1.142857 } as any}>
        {/* ── IM Integrations (top section) ── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <Zap className="w-4 h-4" />
              消息接入
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {/* WeChat Work */}
            <div className="flex flex-col">
              <button
                onClick={() => navigate('/wecom-bind')}
                className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 hover:shadow-sm transition-all group text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">企业微信</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">绑定企微群机器人</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-green-500 transition-colors flex-shrink-0" />
              </button>
              {bindingCounts.wecom > 0 && (
                <button
                  onClick={() => setImModalPlatform('wecom')}
                  className="mt-1.5 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                  已绑定 {bindingCounts.wecom} 个 · 管理
                </button>
              )}
            </div>
            {/* QQ Bot */}
            <div className="flex flex-col">
              <button
                onClick={() => navigate('/qqbot-bind')}
                className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all group text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center text-lg">
                  🐧
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">QQ Bot</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">绑定 QQ 机器人</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </button>
              {bindingCounts.qqbot > 0 && (
                <button
                  onClick={() => setImModalPlatform('qqbot')}
                  className="mt-1.5 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
                  已绑定 {bindingCounts.qqbot} 个 · 管理
                </button>
              )}
            </div>
            {/* WeChat Personal */}
            <div className="flex flex-col">
              <button
                onClick={() => navigate('/wechat-bind')}
                className="flex items-center gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-600 hover:shadow-sm transition-all group text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-200">微信</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">绑定微信机器人</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-emerald-500 transition-colors flex-shrink-0" />
              </button>
              {bindingCounts.weixin > 0 && (
                <button
                  onClick={() => setImModalPlatform('weixin')}
                  className="mt-1.5 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  已绑定 {bindingCounts.weixin} 个 · 管理
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Provider health banner */}
        {providerHealth.shouldShowBanner && (
          <div className="mb-6 flex items-start gap-4 px-5 py-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-2xl">
            <div className="flex-shrink-0 p-2 bg-amber-100 dark:bg-amber-800/50 rounded-xl mt-0.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                {providerHealth.error === 'no_provider'
                  ? t('dashboard.providerCheck.noProviderTitle', { defaultValue: '还没有配置模型供应商' })
                  : t('dashboard.providerCheck.title', { defaultValue: '模型供应商尚未配置' })
                }
              </div>
              <div className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {providerHealth.message || t('dashboard.providerCheck.description', { defaultValue: '当前默认模型供应商不可用，请配置 API 密钥。' })}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => navigate('/settings/suppliers')}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {providerHealth.error === 'no_provider'
                    ? t('dashboard.providerCheck.addProvider', { defaultValue: '添加供应商' })
                    : t('dashboard.providerCheck.configure', { defaultValue: '前往配置' })
                  }
                </button>
                {providerHealth.error !== 'no_provider' && (
                  <button
                    onClick={providerHealth.dismiss}
                    className="px-4 py-1.5 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/50 rounded-lg transition-colors"
                  >
                    {t('dashboard.providerCheck.later', { defaultValue: '稍后' })}
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={providerHealth.dismiss}
              className="flex-shrink-0 p-1 text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Agent grid ── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <Bot className="w-4 h-4" />
              可用 Agent
            </h2>
            <div className="flex items-center gap-3">
              <AddAgentButton onManualCreate={() => setShowCreateAgentModal(true)} />
              <button
                onClick={() => navigate('/agents')}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                全部 Agent
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {enabledAgents.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 py-4">暂无可用 Agent</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {enabledAgents.slice(0, 9).map(agent => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => handleAgentClick(agent)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Recent projects ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              最近使用的项目
            </h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                添加项目
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors"
              >
                <FolderDown className="w-3.5 h-3.5" />
                导入项目
              </button>
              <button
                onClick={() => navigate('/projects')}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                全部项目
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {isLoadingProjects ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="p-5 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-center">
              <FolderOpen className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">还没有项目</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  添加项目
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition-colors"
                >
                  <FolderDown className="w-3.5 h-3.5" />
                  导入项目
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recentProjects.map(project => {
                const defaultAgent = agents.find(a => a.id === project.defaultAgent);
                return (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    defaultAgentName={defaultAgent?.name}
                    defaultAgentIcon={defaultAgent?.ui?.icon}
                    lastMessage={projectLastMessages[project.path] ?? undefined}
                    onClick={() => handleProjectClick(project)}
                  />
                );
              })}
            </div>
          )}
        </section>
        </div>
      </div>

      {/* ─── Right column: Embedded Meta Agent panel ─── */}
      <div
        className="hidden lg:flex flex-col flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 relative"
        style={{ width: panelWidth }}
      >
        {/* Drag-to-resize handle on the left edge */}
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 group flex items-center justify-center"
          title="拖动调整宽度"
        >
          <div className="w-0.5 h-10 rounded-full bg-gray-300 dark:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Panel header */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-800/50 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                Meta Agent
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
                随时可用的智能助手
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setShowSessionHistory(!showSessionHistory)}
                className="p-1.5 rounded-lg text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                title="会话历史"
              >
                <Clock className="w-4 h-4" />
              </button>
              <SessionsDropdown
                isOpen={showSessionHistory}
                onToggle={() => setShowSessionHistory(!showSessionHistory)}
                sessions={metaSessionsData?.sessions || []}
                currentSessionId={currentSessionId}
                onSwitchSession={handleMetaSessionSwitch}
                isLoading={false}
                searchTerm={sessionSearchTerm}
                onSearchChange={setSessionSearchTerm}
              />
            </div>
            <button
              onClick={() => {
                const isRealSession = currentSessionId
                  && !currentSessionId.startsWith('session_')
                  && !currentSessionId.startsWith('__pending_');
                openProjectWindow({
                  projectPath: metaAgentResolvedPath || '',
                  agentId: META_AGENT_ID,
                  sessionId: isRealSession ? currentSessionId : undefined,
                });
              }}
              className="p-1.5 rounded-lg text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              title="全屏沉浸式工作"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Embedded chat panel */}
        <EmbeddedMetaPanel />
      </div>
    </div>

    {/* ── Create Project Modal ── */}
    {showCreateModal && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{t('projects.form.create', { defaultValue: '创建项目' })}</h2>
            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleCreateProject} className="p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">项目名称 *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="输入项目名称"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  required
                />
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Agent</label>
                <button
                  type="button"
                  onClick={() => setShowCreateAgentDropdown(v => !v)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-left transition-colors"
                >
                  {(() => {
                    const selected = allEnabledAgents.find(a => a.id === createForm.agentId);
                    if (selected) return (
                      <>
                        {selected.ui?.icon && selected.ui.icon.length <= 4 && (
                          <span className="text-xl flex-shrink-0">{selected.ui.icon}</span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{selected.name}</div>
                          {selected.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{selected.description}</div>
                          )}
                        </div>
                      </>
                    );
                    return <span className="text-sm text-gray-400 flex-1">选择 Agent</span>;
                  })()}
                  <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${showCreateAgentDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showCreateAgentDropdown && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowCreateAgentDropdown(false)} />
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto">
                      {allEnabledAgents.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setCreateForm(f => ({ ...f, agentId: a.id }));
                            setShowCreateAgentDropdown(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                            createForm.agentId === a.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                          }`}
                        >
                          {a.ui?.icon && a.ui.icon.length <= 4 && (
                            <span className="text-xl flex-shrink-0">{a.ui.icon}</span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{a.name}</div>
                            {a.description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{a.description}</div>
                            )}
                          </div>
                          {createForm.agentId === a.id && (
                            <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">项目目录</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={createForm.directory}
                    onChange={e => setCreateForm(f => ({ ...f, directory: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreateFileBrowser(true)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                    title="选择目录"
                  >
                    <Folder className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">将在此目录下创建项目文件夹</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">描述</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="项目描述（可选）"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button type="button" onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                取消
              </button>
              <button type="submit" disabled={!createForm.name || !createForm.agentId} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                创建项目
              </button>
            </div>
          </form>
        </div>
        {showCreateFileBrowser && (
          <FileBrowser
            title="选择项目目录"
            initialPath={createForm.directory.startsWith('~/') ? undefined : createForm.directory}
            allowFiles={false}
            allowDirectories={true}
            allowNewDirectory={true}
            onSelect={(path, isDirectory) => {
              if (isDirectory) {
                setCreateForm(f => ({ ...f, directory: path }));
                setShowCreateFileBrowser(false);
              }
            }}
            onClose={() => setShowCreateFileBrowser(false)}
          />
        )}
      </div>
    )}

    {/* ── Import Project Modal ── */}
    {showImportModal && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md mx-4">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">导入项目</h2>
            <button onClick={() => { setShowImportModal(false); setImportPath(''); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6">
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">项目目录路径</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={importPath}
                  onChange={e => setImportPath(e.target.value)}
                  placeholder="请选择或输入项目目录路径"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowImportBrowser(true)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                  title="选择目录"
                >
                  <Folder className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">选择要导入的现有项目目录</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>说明：</strong>导入的目录将被添加到项目中，并关联到第一个可用的代理。
              </p>
            </div>
            <div className="flex justify-end space-x-3">
              <button type="button" onClick={() => { setShowImportModal(false); setImportPath(''); }} className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                取消
              </button>
              <button type="button" onClick={handleImportProject} disabled={!importPath.trim()} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                导入项目
              </button>
            </div>
          </div>
        </div>
        {showImportBrowser && (
          <FileBrowser
            title="选择项目目录"
            allowFiles={false}
            allowDirectories={true}
            onSelect={(path, isDirectory) => {
              if (isDirectory) {
                setImportPath(path);
                setShowImportBrowser(false);
              }
            }}
            onClose={() => setShowImportBrowser(false)}
          />
        )}
      </div>
    )}

    {/* ── Create Agent Modal (reuses full AgentEditModal from AgentsPage) ── */}
    <AgentEditModal
      isOpen={showCreateAgentModal}
      onClose={() => setShowCreateAgentModal(false)}
      agent={null}
      agents={agents}
    />

    {/* ── IM Binding Management Modal ── */}
    {imModalPlatform && (
      <IMBindingModal
        platform={imModalPlatform}
        isOpen={true}
        onClose={() => setImModalPlatform(null)}
        onNewBind={() => {
          setImModalPlatform(null);
          const routes: Record<string, string> = {
            wecom: '/wecom-bind',
            qqbot: '/qqbot-bind',
            weixin: '/wechat-bind',
          };
          navigate(routes[imModalPlatform] || '/dashboard');
        }}
      />
    )}
    </>
  );
};
