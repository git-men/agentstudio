import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Minimize2 } from 'lucide-react';
import { useAgent } from '../hooks/useAgents';
import { useAgentStore } from '../stores/useAgentStore';
import { AGUIChatPanel } from './AGUIChatPanel';
import { useMobileContext } from '../contexts/MobileContext';
import type { AgentConfig } from '../types/index.js';

const META_AGENT_ID = 'meta-agent';
const SESSION_STORAGE_KEY = 'agentstudio:meta-agent-session';
const OPEN_STATE_KEY = 'agentstudio:meta-agent-open';

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

  const [isOpen, setIsOpen] = useState(getSavedOpenState);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const agentRef = useRef<AgentConfig | null>(null);

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

  if (isLoading || error || !agent || !agent.enabled) {
    return null;
  }

  const pageContext = getPageContext(location.pathname);

  return (
    <>
      {/* Floating chat window */}
      {hasBeenOpened && (
        <div
          className={`
            fixed z-50 transition-all duration-300 ease-in-out
            ${isMobile
              ? 'inset-0'
              : 'top-0 right-0 bottom-0 w-[420px]'
            }
            ${isOpen
              ? 'opacity-100 translate-x-0 pointer-events-auto'
              : 'opacity-0 translate-x-4 pointer-events-none'
            }
          `}
        >
          <div className="flex flex-col bg-white dark:bg-gray-800 shadow-xl overflow-hidden h-full border-l border-gray-200 dark:border-gray-700">
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
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="收起"
              >
                {isMobile ? <X className="w-5 h-5" /> : <Minimize2 className="w-4 h-4" />}
              </button>
            </div>

            {/* Chat panel */}
            <div className="flex-1 min-h-0">
              <AGUIChatPanel
                agent={agent}
                onSessionChange={handleSessionChange}
                environmentContext={`用户当前所在页面：${pageContext}`}
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
