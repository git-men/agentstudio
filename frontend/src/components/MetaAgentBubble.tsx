import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle, X, Minimize2, Maximize2, Clock } from 'lucide-react';
import { useAgent, useAgentSessions } from '../hooks/useAgents';
import { useAgentStore } from '../stores/useAgentStore';
import { AGUIChatPanel } from './AGUIChatPanel';
import { SessionsDropdown } from './SessionsDropdown';
import { useMobileContext } from '../contexts/MobileContext';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import type { AgentConfig } from '../types/index.js';

const MIN_PANEL_WIDTH = 320;
const DEFAULT_PANEL_WIDTH = 480;

const META_AGENT_ID = 'meta-agent';
const SESSION_STORAGE_KEY = 'agentstudio:meta-agent-session';
const OPEN_STATE_KEY = 'agentstudio:meta-agent-open';
const PANEL_WIDTH_KEY = 'agentstudio:meta-agent-panel-width';

function saveMetaAgentSession(sessionId: string | null) {
  try {
    if (sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

function getSavedMetaAgentSession(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveOpenState(open: boolean) {
  try {
    localStorage.setItem(OPEN_STATE_KEY, open ? '1' : '0');
  } catch { /* ignore */ }
}

function getSavedOpenState(): boolean {
  try {
    return localStorage.getItem(OPEN_STATE_KEY) === '1';
  } catch {
    return false;
  }
}

const PAGE_CONTEXT_MAP: Record<string, string> = {
  '/dashboard': 'Dashboard 首页',
  '/agents': 'Agent 管理页',
  '/projects': '项目管理页',
  '/mcp': 'MCP 配置页',
  '/rules': 'Rules 规则页',
  '/hooks': 'Hooks 钩子页',
  '/skills': 'Skills 技能页',
  '/plugins': '插件管理页',
  '/models': '模型管理页',
  '/scheduled-tasks': '定时任务页',
  '/settings': '系统设置页',
  '/toast-test': '测试页',
};

function getPageContext(pathname: string): string {
  for (const [prefix, label] of Object.entries(PAGE_CONTEXT_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return label;
    }
  }
  return '管理页面';
}

const META_AGENT_OPEN_EVENT = 'meta-agent:open';

/**
 * Dispatch this event from anywhere to programmatically open the floating chat.
 */
export function openMetaAgentChat() {
  window.dispatchEvent(new CustomEvent(META_AGENT_OPEN_EVENT));
}

/**
 * Global floating Meta Agent bubble + chat window.
 * Rendered inside Layout so it appears on all non-ChatPage routes.
 */
export const MetaAgentBubble: React.FC = () => {
  const { data: agentData, isLoading, error } = useAgent(META_AGENT_ID);
  const { setCurrentAgentAndSession, currentAgent } = useAgentStore();
  const { isMobile } = useMobileContext();
  const location = useLocation();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(getSavedOpenState);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const agentRef = useRef<AgentConfig | null>(null);
  const [resolvedWorkDir, setResolvedWorkDir] = useState<string | null>(null);
  const currentSessionId = useAgentStore((s) => s.currentSessionId);

  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY);
      return saved ? Math.max(MIN_PANEL_WIDTH, parseInt(saved, 10)) : DEFAULT_PANEL_WIDTH;
    } catch { return DEFAULT_PANEL_WIDTH; }
  });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(panelWidth);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panelWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const diff = resizeStartXRef.current - ev.clientX;
      const newWidth = Math.max(MIN_PANEL_WIDTH, resizeStartWidthRef.current + diff);
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

  const isHiddenOnDashboard = location.pathname === '/dashboard' || location.pathname === '/dashboard-new';

  // When transitioning from dashboard (hidden) to another page (visible),
  // re-read width from localStorage so changes made on Dashboard are picked up.
  const prevHiddenRef = useRef(isHiddenOnDashboard);
  useEffect(() => {
    if (prevHiddenRef.current && !isHiddenOnDashboard) {
      try {
        const saved = localStorage.getItem(PANEL_WIDTH_KEY);
        if (saved) setPanelWidth(Math.max(MIN_PANEL_WIDTH, parseInt(saved, 10)));
      } catch { /* ignore */ }
    }
    prevHiddenRef.current = isHiddenOnDashboard;
  }, [isHiddenOnDashboard]);

  useEffect(() => {
    if (isHiddenOnDashboard) return;
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* ignore */ }
  }, [panelWidth, isHiddenOnDashboard]);

  const agent = agentData?.agent;

  useEffect(() => {
    if (agent) {
      agentRef.current = agent;
    }
  }, [agent]);

  useEffect(() => {
    if (!agent?.workingDirectory) return;
    authFetch(`${API_BASE}/files/resolve?path=${encodeURIComponent(agent.workingDirectory)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.resolved) setResolvedWorkDir(data.resolved); })
      .catch(() => {});
  }, [agent?.workingDirectory]);

  const activateMetaAgent = useCallback(() => {
    const metaAgent = agentRef.current;
    if (!metaAgent) return;
    const savedSession = getSavedMetaAgentSession();
    if (currentAgent?.id !== META_AGENT_ID) {
      setCurrentAgentAndSession(metaAgent, savedSession);
    }
  }, [currentAgent?.id, setCurrentAgentAndSession]);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
    setHasBeenOpened(true);
    saveOpenState(true);
    activateMetaAgent();
  }, [activateMetaAgent]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    saveOpenState(false);
  }, []);

  // When chat was previously open and we're re-mounting (e.g. returning from ChatPage),
  // re-activate the meta agent in the store
  useEffect(() => {
    if (isOpen && agent) {
      setHasBeenOpened(true);
      activateMetaAgent();
    }
  }, [isOpen, agent, activateMetaAgent]);

  // Listen for programmatic open requests (e.g. from ClassicDashboard card)
  useEffect(() => {
    const handler = () => handleOpen();
    window.addEventListener(META_AGENT_OPEN_EVENT, handler);
    return () => window.removeEventListener(META_AGENT_OPEN_EVENT, handler);
  }, [handleOpen]);

  const handleSessionChange = useCallback((newSessionId: string | null) => {
    saveMetaAgentSession(newSessionId);
  }, []);

  // ── Session history ──
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessionSearchTerm, setSessionSearchTerm] = useState('');
  const { data: metaSessionsData, refetch: refetchMetaSessions } = useAgentSessions(
    META_AGENT_ID, sessionSearchTerm, resolvedWorkDir || undefined, isOpen
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
      if (resolvedWorkDir) url.searchParams.set('projectPath', resolvedWorkDir);
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
      console.warn('[MetaAgentBubble] Failed to load session messages:', err);
    }
    setShowSessionHistory(false);
  }, [resolvedWorkDir]);

  if (isLoading || error || !agent || !agent.enabled) {
    return null;
  }

  // On pages that embed the Meta Agent panel inline (DashboardShell),
  // hide the floating overlay entirely to avoid duplication.
  const inlinePanelPaths = ['/dashboard', '/dashboard-new', '/wecom-bind', '/qqbot-bind', '/wechat-bind'];
  if (inlinePanelPaths.includes(location.pathname)) {
    return null;
  }

  const pageContext = getPageContext(location.pathname);

  return (
    <>
      {/* Floating chat window */}
      {hasBeenOpened && (
        <div
          className={`
            fixed z-50 transition-[opacity,transform] duration-300 ease-in-out
            ${isMobile ? 'inset-0' : 'top-0 right-0 bottom-0'}
            ${isOpen
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 translate-x-4 pointer-events-none'
            }
          `}
          style={isMobile ? undefined : { width: panelWidth }}
        >
          <div
            className="flex flex-col bg-white dark:bg-gray-800 overflow-hidden h-full border-l border-gray-200 dark:border-gray-700 relative"
            style={{ boxShadow: '-8px 0 32px -4px rgba(0,0,0,0.18), -2px 0 8px -2px rgba(0,0,0,0.1)' }}
          >
            {/* Resize handle — left edge, desktop only */}
            {!isMobile && (
              <div
                onMouseDown={handleResizeMouseDown}
                className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-10 group flex items-center justify-center"
                title="拖动调整宽度"
              >
                <div className="w-0.5 h-10 rounded-full bg-gray-300 dark:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <MessageCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight text-gray-900 dark:text-white">
                    {agent.ui?.headerTitle || agent.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
                    {pageContext}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    onClick={() => setShowSessionHistory(!showSessionHistory)}
                    className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
                    const params = new URLSearchParams();
                    params.set('agent', META_AGENT_ID);
                    if (resolvedWorkDir) {
                      params.set('project', resolvedWorkDir);
                    } else if (agent.workingDirectory) {
                      params.set('project', agent.workingDirectory);
                    }
                    const isRealSession = currentSessionId
                      && !currentSessionId.startsWith('session_')
                      && !currentSessionId.startsWith('__pending_');
                    if (isRealSession) {
                      params.set('session', currentSessionId);
                    }
                    navigate(`/project-workspace?${params.toString()}`);
                    handleClose();
                  }}
                  className="p-1.5 rounded-lg text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                  title="全屏沉浸式工作"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  onClick={handleClose}
                  className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  title="收起"
                >
                  {isMobile ? <X className="w-5 h-5" /> : <Minimize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Chat panel */}
            <div className="flex-1 min-h-0">
              <AGUIChatPanel
                agent={agent}
                onSessionChange={handleSessionChange}
                environmentContext={`用户当前所在页面：${pageContext}`}
                hideHeader={true}
              />
            </div>
          </div>
        </div>
      )}

      {/* Floating bubble button — hidden when panel is open */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="
            fixed bottom-6 right-6 z-50
            w-14 h-14 rounded-full
            bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700
            shadow-lg hover:shadow-xl
            flex items-center justify-center
            transition-all duration-300 ease-in-out
            hover:bg-gray-50 dark:hover:bg-gray-700
          "
          title="打开 Meta Agent"
        >
          <MessageCircle className="w-6 h-6 text-gray-600 dark:text-gray-300" />
        </button>
      )}
    </>
  );
};
