import { useMutation, useQuery } from '@tanstack/react-query';
import type { AgentConfig, ChatContext, ImageData } from '../types/index.js';
import { API_BASE } from '../lib/config.js';
import { authFetch } from '../lib/authFetch';

// Agent management hooks
export const useAgents = (enabled?: boolean, type?: string) => {
  return useQuery<{ agents: AgentConfig[] }>({
    queryKey: ['agents', enabled, type],
    queryFn: async () => {
      const url = new URL(`${API_BASE}/agents`);
      if (enabled !== undefined) {
        url.searchParams.append('enabled', String(enabled));
      }
      if (type) {
        url.searchParams.append('type', type);
      }
      const response = await authFetch(url.toString());
      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }
      return response.json();
    }
  });
};

export const useAgent = (agentId: string) => {
  return useQuery<{ agent: AgentConfig }>({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const response = await authFetch(`${API_BASE}/agents/${agentId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch agent');
      }
      return response.json();
    },
    enabled: !!agentId
  });
};

export const useCreateAgent = () => {
  return useMutation({
    mutationFn: async (agentData: Omit<AgentConfig, 'createdAt' | 'updatedAt'>) => {
      const response = await authFetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(agentData)
      });

      if (!response.ok) {
        throw new Error('Failed to create agent');
      }

      return response.json();
    }
  });
};

export const useUpdateAgent = () => {
  return useMutation({
    mutationFn: async ({ agentId, data }: { agentId: string; data: Partial<AgentConfig> }) => {
      const response = await authFetch(`${API_BASE}/agents/${agentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error('Failed to update agent');
      }

      return response.json();
    }
  });
};

export const useDeleteAgent = () => {
  return useMutation({
    mutationFn: async (agentId: string) => {
      const response = await authFetch(`${API_BASE}/agents/${agentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete agent');
      }

      return response.json();
    }
  });
};

// Agent session hooks
// Backend determines engine type from its startup config — no need to pass engine from frontend.
export const useAgentSessions = (agentId: string, searchTerm?: string, projectPath?: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['agent-sessions', agentId, searchTerm, projectPath],
    queryFn: async () => {
      console.log(`🔍 [FRONTEND DEBUG] useAgentSessions called:`, {
        agentId,
        searchTerm,
        projectPath,
      });

      const url = new URL(`${API_BASE}/sessions/${agentId}`);
      if (searchTerm && searchTerm.trim()) {
        url.searchParams.append('search', searchTerm.trim());
      }
      if (projectPath) {
        url.searchParams.set('projectPath', projectPath);
      }

      console.log(`🌐 [FRONTEND DEBUG] Fetching sessions from: ${url.toString()}`);

      const response = await authFetch(url.toString());
      if (!response.ok) {
        console.error(`❌ [FRONTEND DEBUG] Failed to fetch sessions: ${response.status} ${response.statusText}`);
        throw new Error('Failed to fetch agent sessions');
      }

      const data = await response.json();
      console.log(`📋 [FRONTEND DEBUG] Received sessions data:`, {
        sessionCount: data.sessions?.length || 0,
        sessions: data.sessions?.map((s: any, i: number) => ({
          index: i + 1,
          id: s.id,
          title: s.title,
          lastUpdated: s.lastUpdated,
          messageCount: s.messageCount
        }))
      });

      return data;
    },
    enabled: enabled && !!agentId
  });
};


// Get agent session messages
// Backend determines engine type from its startup config — no need to pass engine from frontend.
export const useAgentSessionMessages = (agentId: string, sessionId: string | null, projectPath?: string, paused?: boolean) => {
  return useQuery({
    queryKey: ['agent-session-messages', agentId, sessionId, projectPath],
    queryFn: async () => {
      if (!sessionId) {
        return { messages: [] };
      }

      const url = new URL(`${API_BASE}/sessions/${agentId}/${sessionId}/messages`);
      if (projectPath) {
        url.searchParams.set('projectPath', projectPath);
      }

      const response = await authFetch(url.toString());

      if (!response.ok) {
        throw new Error('Failed to fetch agent session messages');
      }

      const data = await response.json();

      const convertedMessages = data.messages.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));

      return {
        ...data,
        messages: convertedMessages
      };
    },
    // Disable the query entirely while streaming to prevent any fetches
    // from returning stale data that could overwrite the live store.
    enabled: !!agentId && !!sessionId && !paused,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

// Agent-specific AI chat hook
export const useAgentChat = () => {
  return {
    mutateAsync: async ({
      agentId,
      message,
      images,
      context,
      sessionId,
      projectPath,
      mcpTools,
      permissionMode,
      model,
      claudeVersion,
      envVars,
      channel,
      frontendTools,
      abortController,
      onMessage,
      onError
    }: {
      agentId: string;
      message: string;
      images?: ImageData[];
      context?: ChatContext;
      sessionId?: string | null;
      projectPath?: string;
      mcpTools?: string[];
      permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
      model?: string;
      claudeVersion?: string;
      envVars?: Record<string, string>;
      channel?: string;
      frontendTools?: import('../services/frontendToolRegistry.js').FrontendToolSchema[];
      abortController?: AbortController;
      onMessage?: (data: unknown) => void;
      onError?: (error: unknown) => void;
    }) => {
      try {
        console.log('🚀 Starting SSE request to:', `${API_BASE}/agents/chat`);

        const requestBody: Record<string, unknown> = {
          agentId,
          message,
          images,
          context,
          sessionId,
          projectPath,
          mcpTools,
          permissionMode,
          model,
          claudeVersion,
          envVars,
          channel: channel || 'web',
          frontendTools,
        };

        const response = await authFetch(`${API_BASE}/agents/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody),
          signal: abortController?.signal
        });

        console.log('🚀 SSE response received:', {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });

        if (!response.ok) {
          // Try to read structured error body before throwing a generic error
          let blockReason: string | undefined;
          try {
            const body = await response.json();
            if (body.decision === 'block') {
              blockReason = body.reason;
            }
          } catch {
            // ignore JSON parse errors — fall through to generic error
          }
          if (blockReason !== undefined) {
            throw new Error(`hook_block:${blockReason}`);
          }
          throw new Error(`Agent chat request failed: ${response.status} ${response.statusText}`);
        }

        // Create EventSource for SSE
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          throw new Error('No response body');
        }

        console.log('🚀 Starting SSE stream reading...');

        while (true) {
          // Check if request was aborted
          if (abortController?.signal.aborted) {
            reader.cancel();
            throw new DOMException('Request aborted', 'AbortError');
          }

          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonData = line.slice(6);
                // Only log first 50 chars to avoid spamming console with huge base64
                // console.log('🔄 Raw SSE data:', jsonData.substring(0, 50) + '...');
                const data = JSON.parse(jsonData);
                console.log('🔄 Parsed SSE event:', {
                  type: data.type,
                  subtype: data.subtype,
                  hasMessage: !!data.message,
                  messageContentBlocks: data.message?.content?.length || 0
                });
                onMessage?.(data);
              } catch (error) {
                console.error('❌ Failed to parse SSE data:', line.substring(0, 100) + '...', 'Error:', error);
              }
            } else if (line.trim()) {
              console.log('🔄 Non-data SSE line:', line);
            }
          }
        }

      } catch (error) {
        console.error('Agent SSE error:', error);
        onError?.(error);
        throw error;
      }
    }
  };
};

// Create new project
export const useCreateProject = () => {
  return useMutation({
    mutationFn: async ({ agentId, projectName, parentDirectory }: {
      agentId: string;
      projectName: string;
      parentDirectory?: string;
    }) => {
      const response = await authFetch(`${API_BASE}/projects/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId, projectName, parentDirectory })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create project');
      }

      return response.json();
    }
  });
};

// Import existing project
export const useImportProject = () => {
  return useMutation({
    mutationFn: async ({ agentId, projectPath }: {
      agentId: string;
      projectPath: string;
    }) => {
      const response = await authFetch(`${API_BASE}/projects/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId, projectPath })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to import project');
      }

      return response.json();
    }
  });
};

// Get projects for a specific agent
export const useAgentProjects = (agentId: string) => {
  return useQuery({
    queryKey: ['agent-projects', agentId],
    queryFn: async () => {
      const response = await authFetch(`${API_BASE}/projects/agents/${agentId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch agent projects');
      }
      return response.json();
    },
    enabled: !!agentId
  });
};

// Interrupt agent session
export const useInterruptSession = () => {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await authFetch(`${API_BASE}/agents/sessions/${sessionId}/interrupt`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to interrupt session');
      }

      return response.json();
    }
  });
};