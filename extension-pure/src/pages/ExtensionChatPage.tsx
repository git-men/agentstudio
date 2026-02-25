import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { AGUIChatPanel } from '@/components/AGUIChatPanel';
import { useAgentStore } from '@/stores/useAgentStore';
import { useAgent, useAgents } from '@/hooks/useAgents';
import { useAuth } from '@/hooks/useAuth';
import { ProjectSelector } from '@/components/ProjectSelector';
import { ExtensionHeader } from '../components/ExtensionHeader';

const LAST_AGENT_KEY = 'extension-pure:last-agent-id';
const LAST_PROJECT_KEY = 'extension-pure:last-project';

export const ExtensionChatPage: React.FC = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const projectPath = searchParams.get('project');
  const sessionId = searchParams.get('session');

  const effectiveAgentId = agentId || localStorage.getItem(LAST_AGENT_KEY) || '';

  const { data: agentData, isLoading: agentLoading } = useAgent(effectiveAgentId);
  const { data: agentsData } = useAgents(true);
  const { setCurrentAgentAndSession } = useAgentStore();
  const [showProjectSelector, setShowProjectSelector] = useState(false);

  const agent = agentData?.agent;
  const agents = agentsData?.agents || [];

  // Persist last used agent
  useEffect(() => {
    if (agent?.id) {
      localStorage.setItem(LAST_AGENT_KEY, agent.id);
    }
  }, [agent?.id]);

  // Restore last project if none in URL
  useEffect(() => {
    if (agent && !projectPath) {
      const lastProject = localStorage.getItem(`${LAST_PROJECT_KEY}:${agent.id}`);
      if (lastProject) {
        navigate(`/chat/${agent.id}?project=${encodeURIComponent(lastProject)}`, { replace: true });
      } else {
        setShowProjectSelector(true);
      }
    }
  }, [agent, projectPath, navigate]);

  // Set current agent and session atomically
  useEffect(() => {
    if (agent) {
      setCurrentAgentAndSession(agent, sessionId || null);
    }
  }, [agent, sessionId, setCurrentAgentAndSession]);

  // No agentId and none saved → redirect to first available agent
  useEffect(() => {
    if (!effectiveAgentId && agents.length > 0) {
      navigate(`/chat/${agents[0].id}`, { replace: true });
    }
  }, [effectiveAgentId, agents, navigate]);

  const handleProjectSelect = (selectedProjectPath: string) => {
    if (agent) {
      localStorage.setItem(`${LAST_PROJECT_KEY}:${agent.id}`, selectedProjectPath);
    }
    const params = new URLSearchParams();
    params.set('project', selectedProjectPath);
    if (sessionId) params.set('session', sessionId);
    navigate(`/chat/${effectiveAgentId}?${params.toString()}`, { replace: true });
    setShowProjectSelector(false);
  };

  const handleSessionChange = (newSessionId: string | null) => {
    const params = new URLSearchParams();
    if (projectPath) params.set('project', projectPath);
    if (newSessionId) params.set('session', newSessionId);
    navigate(`/chat/${effectiveAgentId}?${params.toString()}`, { replace: true });
  };

  const handleSwitchProject = () => {
    setShowProjectSelector(true);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (agentLoading || (!effectiveAgentId && agents.length === 0)) {
    return (
      <div className="h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center text-gray-500 dark:text-gray-400">
          No agent available
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      <ExtensionHeader
        agent={agent}
        projectPath={projectPath}
        onSwitchProject={handleSwitchProject}
        onLogout={handleLogout}
      />

      <div className="flex-1 overflow-hidden">
        <AGUIChatPanel
          agent={agent}
          projectPath={projectPath || undefined}
          onSessionChange={handleSessionChange}
        />
      </div>

      {showProjectSelector && agent && (
        <ProjectSelector
          agent={agent}
          onProjectSelect={handleProjectSelect}
          onClose={() => setShowProjectSelector(false)}
        />
      )}
    </div>
  );
};
