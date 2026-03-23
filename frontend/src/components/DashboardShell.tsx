/**
 * DashboardShell
 *
 * Shared layout wrapper that renders children on the left and an embedded
 * Meta Agent panel on the right — the same split-view used by the Dashboard.
 * Use this for pages that should sit beside (not beneath) the Meta Agent panel.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { useAgent } from '../hooks/useAgents';
import { useAgentStore } from '../stores/useAgentStore';
import { AGUIChatPanel } from './AGUIChatPanel';
import type { AgentConfig } from '../types/index.js';

const META_AGENT_ID = 'meta-agent';
const META_AGENT_SESSION_KEY = 'agentstudio:meta-agent-session';
const META_AGENT_OPEN_STATE_KEY = 'agentstudio:meta-agent-open';
const PANEL_WIDTH_KEY = 'agentstudio:meta-agent-panel-width';

const MIN_PANEL_WIDTH = 280;
const DEFAULT_PANEL_WIDTH = 560;
const MAX_PANEL_WIDTH = 860;

function getSavedMetaAgentSession(): string | null {
  try { return localStorage.getItem(META_AGENT_SESSION_KEY); } catch { return null; }
}

function saveMetaAgentSession(sessionId: string | null) {
  try {
    if (sessionId) localStorage.setItem(META_AGENT_SESSION_KEY, sessionId);
    else localStorage.removeItem(META_AGENT_SESSION_KEY);
  } catch { /* ignore */ }
}

function markMetaAgentOpen() {
  try { localStorage.setItem(META_AGENT_OPEN_STATE_KEY, '1'); } catch { /* ignore */ }
}

const EmbeddedMetaPanel: React.FC<{ environmentContext?: string }> = ({ environmentContext }) => {
  const { data: agentData, isLoading, error } = useAgent(META_AGENT_ID);
  const { setCurrentAgentAndSession, currentAgent } = useAgentStore();
  const agentRef = useRef<AgentConfig | null>(null);
  const activated = useRef(false);

  const agent = agentData?.agent;

  useEffect(() => {
    if (agent) agentRef.current = agent;
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

  useEffect(() => { markMetaAgentOpen(); }, []);

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
        environmentContext={environmentContext || '用户当前所在页面：Dashboard'}
        hideHeader={true}
      />
    </div>
  );
};

interface DashboardShellProps {
  children: React.ReactNode;
  environmentContext?: string;
}

export const DashboardShell: React.FC<DashboardShellProps> = ({ children, environmentContext }) => {
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY);
      return saved ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, parseInt(saved, 10))) : DEFAULT_PANEL_WIDTH;
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

  return (
    <div className="h-full flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Left column: page content */}
      <div className="flex-1 overflow-y-auto min-w-0">
        {children}
      </div>

      {/* Right column: embedded Meta Agent panel */}
      <div
        className="hidden lg:flex flex-col flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 relative"
        style={{ width: panelWidth }}
      >
        {/* Resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-blue-400/30 active:bg-blue-500/40 transition-colors"
          onMouseDown={handleResizeMouseDown}
        />
        <EmbeddedMetaPanel environmentContext={environmentContext} />
      </div>
    </div>
  );
};
