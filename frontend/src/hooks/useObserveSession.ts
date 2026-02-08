/**
 * useObserveSession Hook
 * 
 * Subscribes to a session's event stream as a read-only observer.
 * Used by group chat members to watch the ChatPanel in real-time.
 * 
 * Receives both USER_MESSAGE events (from Facilitator Agent / owner)
 * and standard AGUI events (AI responses, tool calls, etc.)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { API_BASE } from '../lib/config';
import { useAuthStore } from '../stores/authStore';
import { extractToken } from '../utils/authHelpers';

/**
 * User message event from Facilitator Agent or owner
 */
export interface UserMessageEvent {
  type: 'USER_MESSAGE';
  content: string;
  sender: string;
  timestamp: number;
  sessionId: string;
}

/**
 * Observer connection state
 */
export type ObserveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Options for useObserveSession
 */
export interface UseObserveSessionOptions {
  /** Session ID to observe */
  sessionId: string;
  /** Whether to auto-connect */
  enabled?: boolean;
  /** Callback for AGUI events (AI responses, tool calls, etc.) */
  onAguiEvent?: (event: any) => void;
  /** Callback for user message events (from inject API) */
  onUserMessage?: (event: UserMessageEvent) => void;
  /** Callback for any event (both AGUI and user messages) */
  onEvent?: (event: any) => void;
  /** Callback for connection state changes */
  onConnectionStateChange?: (state: ObserveConnectionState) => void;
  /** Client ID for this observer (auto-generated if not provided) */
  clientId?: string;
}

/**
 * Hook to observe an AGUI session in real-time (read-only)
 */
export function useObserveSession(options: UseObserveSessionOptions) {
  const {
    sessionId,
    enabled = true,
    onAguiEvent,
    onUserMessage,
    onEvent,
    onConnectionStateChange,
    clientId,
  } = options;

  const [connectionState, setConnectionState] = useState<ObserveConnectionState>('disconnected');
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Stable callback refs
  const onAguiEventRef = useRef(onAguiEvent);
  const onUserMessageRef = useRef(onUserMessage);
  const onEventRef = useRef(onEvent);
  const onConnectionStateChangeRef = useRef(onConnectionStateChange);

  onAguiEventRef.current = onAguiEvent;
  onUserMessageRef.current = onUserMessage;
  onEventRef.current = onEvent;
  onConnectionStateChangeRef.current = onConnectionStateChange;

  const updateState = useCallback((state: ObserveConnectionState) => {
    setConnectionState(state);
    onConnectionStateChangeRef.current?.(state);
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    updateState('disconnected');
  }, [updateState]);

  const connect = useCallback(() => {
    if (!sessionId || !enabled) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    updateState('connecting');

    // Build URL with auth token as query param (EventSource doesn't support headers)
    const token = useAuthStore.getState().token;
    const actualToken = extractToken(token);
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (actualToken) params.set('token', actualToken);

    const url = `${API_BASE}/api/agui/sessions/${encodeURIComponent(sessionId)}/observe?${params.toString()}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    // Connected event
    eventSource.addEventListener('connected', (e) => {
      updateState('connected');
      reconnectAttemptsRef.current = 0;
      try {
        const data = JSON.parse(e.data);
        onEventRef.current?.(data);
      } catch { /* ignore parse errors */ }
    });

    // User message events (from inject API)
    eventSource.addEventListener('USER_MESSAGE', (e) => {
      try {
        const event = JSON.parse(e.data) as UserMessageEvent;
        onUserMessageRef.current?.(event);
        onEventRef.current?.(event);
      } catch { /* ignore parse errors */ }
    });

    // Standard AGUI events
    const aguiEventTypes = [
      'RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR',
      'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
      'THINKING_START', 'THINKING_CONTENT', 'THINKING_END',
      'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
      'RAW', 'CUSTOM',
    ];

    for (const eventType of aguiEventTypes) {
      eventSource.addEventListener(eventType, (e) => {
        try {
          const event = JSON.parse(e.data);
          onAguiEventRef.current?.(event);
          onEventRef.current?.(event);
        } catch { /* ignore parse errors */ }
      });
    }

    // Error handling with reconnect
    eventSource.onerror = () => {
      eventSource.close();
      eventSourceRef.current = null;

      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        updateState('connecting');
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      } else {
        updateState('error');
      }
    };
  }, [sessionId, enabled, clientId, updateState]);

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled && sessionId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [sessionId, enabled, connect, disconnect]);

  return {
    connectionState,
    connect,
    disconnect,
    isConnected: connectionState === 'connected',
  };
}

export default useObserveSession;
