/**
 * useAGUIChat Hook
 * 
 * Hook for calling the AGUI API endpoint (/api/agui/chat).
 * Used by Cursor, CodeBuddy, and Codex engines. Claude uses /api/agents/chat directly.
 * 
 * The backend determines which engine to use based on its startup configuration
 * (ENGINE env var). The frontend does NOT pass engineType to the backend;
 * it only uses engine type locally to decide which API endpoint to call.
 */

import { useCallback } from 'react';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import type { AGUIEvent } from '../types/aguiTypes';

/**
 * Engine type
 */
export type EngineType = 'claude' | 'cursor' | 'codebuddy' | 'codex';

/**
 * Image data for Claude vision
 */
export interface AGUIImageData {
  id: string;
  data: string; // base64
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  name?: string;
}

/**
 * AGUI Chat request parameters
 * 
 * Note: engineType is used locally by the frontend to decide which API endpoint
 * to call. It is NOT sent to the backend — the backend determines its engine
 * from the ENGINE env var at startup.
 */
export interface AGUIChatParams {
  message: string;
  engineType?: EngineType;
  workspace: string;
  sessionId?: string | null;
  model?: string;
  // Claude-specific
  agentId?: string;
  providerId?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  mcpTools?: string[];
  envVars?: Record<string, string>;
  images?: AGUIImageData[];
  channel?: string;
  frontendTools?: import('../services/frontendToolRegistry.js').FrontendToolSchema[];
  // Cursor-specific
  timeout?: number;
  // Cross-engine context
  environmentContext?: string;
  // Callbacks
  onAguiEvent?: (event: AGUIEvent) => void;
  onError?: (error: Error) => void;
  abortController?: AbortController;
}

/**
 * AGUI Chat result
 */
export interface AGUIChatResult {
  sessionId: string;
  success: boolean;
  error?: string;
}

/**
 * Engine UI capabilities - controls which UI elements to show
 */
export interface EngineUICapabilities {
  /** Show MCP tool selector */
  showMcpToolSelector: boolean;
  /** Show image upload button */
  showImageUpload: boolean;
  /** Show permission mode selector */
  showPermissionSelector: boolean;
  /** Show provider/version selector */
  showProviderSelector: boolean;
  /** Show model selector */
  showModelSelector: boolean;
  /** Show environment variables editor */
  showEnvVars: boolean;
}

/**
 * Engine info from API
 */
export interface EngineInfo {
  type: EngineType;
  isDefault: boolean;
  capabilities: {
    mcp: { supported: boolean };
    skills: { supported: boolean };
    features: {
      multiTurn: boolean;
      thinking: boolean;
      vision: boolean;
      streaming: boolean;
      subagents: boolean;
      codeExecution: boolean;
    };
    permissionModes: string[];
    ui: EngineUICapabilities;
  };
  models: Array<{
    id: string;
    name: string;
    isVision?: boolean;
    isThinking?: boolean;
  }>;
  activeSessions: number;
}

/**
 * Default UI capabilities for Claude engine
 */
export const CLAUDE_UI_CAPABILITIES: EngineUICapabilities = {
  showMcpToolSelector: true,
  showImageUpload: true,
  showPermissionSelector: true,
  showProviderSelector: true,
  showModelSelector: true,
  showEnvVars: true,
};

/**
 * Default UI capabilities for Cursor engine
 */
export const CURSOR_UI_CAPABILITIES: EngineUICapabilities = {
  showMcpToolSelector: false,
  showImageUpload: true, // Supported via image URL
  showPermissionSelector: false,
  showProviderSelector: false,
  showModelSelector: true,
  showEnvVars: false,
};

/**
 * Default UI capabilities for CodeBuddy engine
 */
export const CODEBUDDY_UI_CAPABILITIES: EngineUICapabilities = {
  showMcpToolSelector: true, // Dynamic MCP tool selection (SDK supports mcpServers option)
  showImageUpload: true, // Supported via saving image to disk and @path reference
  showPermissionSelector: true, // SDK supports default/acceptEdits/bypassPermissions/plan/delegate/dontAsk
  showProviderSelector: false, // CodeBuddy has no provider concept
  showModelSelector: true, // Models can be selected
  showEnvVars: true, // Support passing env vars to SDK
};

/**
 * Default UI capabilities for Codex engine
 */
export const CODEX_UI_CAPABILITIES: EngineUICapabilities = {
  showMcpToolSelector: false,
  showImageUpload: true,
  showPermissionSelector: true,
  showProviderSelector: false,
  showModelSelector: true,
  showEnvVars: true,
};

/**
 * Get default UI capabilities for an engine type
 */
export function getDefaultUICapabilities(engineType: EngineType): EngineUICapabilities {
  if (engineType === 'cursor') return CURSOR_UI_CAPABILITIES;
  if (engineType === 'codebuddy') return CODEBUDDY_UI_CAPABILITIES;
  if (engineType === 'codex') return CODEX_UI_CAPABILITIES;
  return CLAUDE_UI_CAPABILITIES;
}

/**
 * Fetch engine info from API
 */
export async function fetchEngineInfo(engineType: EngineType): Promise<EngineInfo | null> {
  try {
    const response = await authFetch(`${API_BASE}/agui/engines/${engineType}`);
    if (!response.ok) {
      console.warn(`[AGUI] Failed to fetch engine info: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn('[AGUI] Error fetching engine info:', error);
    return null;
  }
}

/**
 * Hook for AGUI chat functionality
 */
export const useAGUIChat = () => {
  /**
   * Send a chat message via AGUI API
   * 
   * Endpoint routing is based on engineType (frontend-only decision):
   * - Claude: /api/agents/chat with outputFormat=agui
   * - Cursor/CodeBuddy: /api/agui/chat (backend determines engine from its config)
   */
  const sendMessage = useCallback(async (params: AGUIChatParams): Promise<AGUIChatResult> => {
    const {
      message,
      engineType = 'claude',
      workspace,
      sessionId,
      model,
      providerId,
      permissionMode,
      mcpTools,
      envVars,
      frontendTools,
      timeout,
      environmentContext,
      onAguiEvent,
      onError,
      abortController,
      // Claude-specific params
      agentId = 'claude-code',
      images,
      channel = 'web',
    } = params;

    try {
      console.log(`🚀 [AGUI] Starting ${engineType} chat request`);

      let endpoint: string;
      let requestBody: Record<string, unknown>;

      if (engineType === 'cursor' || engineType === 'codebuddy' || engineType === 'codex') {
        // Cursor / CodeBuddy / Codex engines: Use /api/agui/chat
        // Note: engineType is NOT sent — backend knows its engine from startup config
        endpoint = `${API_BASE}/agui/chat`;
        requestBody = {
          message,
          workspace,
          timeout,
        };
        if (sessionId) {
          requestBody.sessionId = sessionId;
        }
        if (model) {
          requestBody.model = model;
          console.log(`🎯 [AGUI] model: ${model}`);
        }
        if (permissionMode) {
          requestBody.permissionMode = permissionMode;
        }
        if (mcpTools && mcpTools.length > 0) {
          requestBody.mcpTools = mcpTools;
          console.log(`🔧 [AGUI] mcpTools: ${mcpTools.length} tool(s)`);
        }
        if (images && images.length > 0) {
          requestBody.images = images;
          console.log(`🖼️ [AGUI] images: ${images.length} image(s)`);
        }

        if (envVars && Object.keys(envVars).length > 0) {
          requestBody.envVars = envVars;
          console.log(`🔑 [AGUI] envVars: ${Object.keys(envVars).length} var(s)`);
        }
        if (environmentContext) {
          requestBody.environmentContext = environmentContext;
        }
      } else {
        // Claude Engine: Use /api/agents/chat with outputFormat=agui
        endpoint = `${API_BASE}/agents/chat`;
        requestBody = {
          message,
          agentId,
          sessionId,
          projectPath: workspace,
          mcpTools,
          permissionMode,
          model,
          claudeVersion: providerId,
          envVars,
          images,
          channel,
          outputFormat: 'agui',
          frontendTools,
          ...(environmentContext ? { context: { environmentContext } } : {}),
        };
      }

      console.log(`🚀 [AGUI] Endpoint: ${endpoint}`);

      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
        signal: abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`AGUI chat request failed: ${response.status} ${response.statusText}`);
      }

      // Process SSE stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultSessionId = sessionId || '';

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        if (abortController?.signal.aborted) {
          reader.cancel();
          throw new DOMException('Request aborted', 'AbortError');
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Skip empty lines and comments
          if (!line.trim() || line.startsWith(':')) continue;

          // Skip SSE event type line (we parse from data)
          if (line.startsWith('event:')) {
            continue;
          }

          // Parse SSE data
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (!dataStr) continue;

            try {
              const event = JSON.parse(dataStr) as AGUIEvent;

              // Extract session ID from RUN_STARTED
              if (event.type === 'RUN_STARTED' && event.threadId) {
                resultSessionId = event.threadId;
              }

              // Call event callback
              if (onAguiEvent) {
                onAguiEvent(event);
              }
            } catch (parseError) {
              console.warn('[AGUI] Failed to parse event:', dataStr.substring(0, 100));
            }
          }
        }
      }

      console.log(`✅ [AGUI] Chat completed, sessionId: ${resultSessionId}`);

      return {
        sessionId: resultSessionId,
        success: true,
      };

    } catch (error) {
      // If the request was aborted by the user, don't treat as error
      if (abortController?.signal.aborted) {
        console.log('[AGUI] Chat aborted by user');
        return {
          sessionId: sessionId || '',
          success: false,
          error: 'aborted',
        };
      }

      console.error('[AGUI] Chat error:', error);

      if (onError && error instanceof Error) {
        onError(error);
      }

      return {
        sessionId: sessionId || '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, []);

  /**
   * Get available engines
   */
  const getEngines = useCallback(async (): Promise<EngineInfo[]> => {
    try {
      const response = await authFetch(`${API_BASE}/agui/engines`);

      if (!response.ok) {
        throw new Error(`Failed to get engines: ${response.status}`);
      }

      const data = await response.json();
      return data.engines || [];
    } catch (error) {
      console.error('[AGUI] Failed to get engines:', error);
      return [];
    }
  }, []);

  /**
   * Interrupt a session
   * Backend determines which engine to use from its startup config.
   */
  const interruptSession = useCallback(async (
    sessionId: string,
  ): Promise<boolean> => {
    try {
      const response = await authFetch(`${API_BASE}/agui/sessions/${sessionId}/interrupt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      return response.ok;
    } catch (error) {
      console.error('[AGUI] Failed to interrupt session:', error);
      return false;
    }
  }, []);

  return {
    sendMessage,
    getEngines,
    interruptSession,
  };
};

export default useAGUIChat;
