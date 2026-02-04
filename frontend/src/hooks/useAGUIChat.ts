/**
 * useAGUIChat Hook
 * 
 * Hook for calling the unified AGUI API endpoint.
 * Supports multiple engines (claude, cursor) with standardized AGUI event output.
 */

import { useCallback } from 'react';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import type { AGUIEvent, AGUIEventType } from '../types/aguiTypes';

/**
 * Engine type
 */
export type EngineType = 'claude' | 'cursor';

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
  // Cursor-specific
  timeout?: number;
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
 * Get default UI capabilities for an engine type
 */
export function getDefaultUICapabilities(engineType: EngineType): EngineUICapabilities {
  return engineType === 'cursor' ? CURSOR_UI_CAPABILITIES : CLAUDE_UI_CAPABILITIES;
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
   * Different engines use different endpoints:
   * - Claude: /api/agents/chat with outputFormat=agui
   * - Cursor: /api/agui/chat with engineType=cursor
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
      timeout,
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

      if (engineType === 'cursor') {
        // Cursor Engine: Use /api/agui/chat
        endpoint = `${API_BASE}/agui/chat`;
        requestBody = {
          message,
          engineType: 'cursor',
          workspace,
          timeout,
        };
        // Only include sessionId if it's truthy
        if (sessionId) {
          requestBody.sessionId = sessionId;
        }
        // Pass model parameter if provided (e.g., 'opus-4.5', 'sonnet-4.5', 'auto')
        if (model) {
          requestBody.model = model;
          console.log(`🎯 [AGUI] Cursor model: ${model}`);
        }
        // Pass images for Cursor engine (will be saved to workspace and referenced via @path)
        if (images && images.length > 0) {
          requestBody.images = images;
          console.log(`🖼️ [AGUI] Cursor images: ${images.length} image(s)`);
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
          outputFormat: 'agui', // Key: This tells agents.ts to output AGUI format
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

        let _currentEventType: string | null = null;

        for (const line of lines) {
          // Skip empty lines and comments
          if (!line.trim() || line.startsWith(':')) continue;

          // Parse SSE event type
          if (line.startsWith('event:')) {
            _currentEventType = line.slice(6).trim();
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
   */
  const interruptSession = useCallback(async (
    sessionId: string,
    engineType: EngineType = 'claude'
  ): Promise<boolean> => {
    try {
      const response = await authFetch(`${API_BASE}/agui/sessions/${sessionId}/interrupt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ engineType }),
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
