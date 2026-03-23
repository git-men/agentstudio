/**
 * Lightweight SSE observer for externally injected messages.
 *
 * Subscribes to /api/agui/sessions/:sessionId/observe and:
 * 1. On USER_MESSAGE from an external sender → adds to the chat messages
 * 2. On RUN_FINISHED → reloads session messages to show the AI response
 */
import { useEffect, useRef } from 'react';
import { getApiBase } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { useAuthStore } from '../stores/authStore';
import { extractToken } from '../utils/authHelpers';
import type { AgentMessage } from '../types/index.js';

interface UseInjectObserverProps {
  sessionId: string | null;
  agentId: string;
  projectPath?: string;
  addMessage: (message: AgentMessage) => void;
  loadSessionMessages?: (messages: AgentMessage[]) => void;
}

const EXTERNAL_SENDERS = ['wecom-reply', 'im-reply', 'inject'];

export function useInjectObserver({
  sessionId,
  agentId,
  projectPath,
  addMessage,
  loadSessionMessages,
}: UseInjectObserverProps) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    if (!sessionId) return;

    const apiBase = getApiBase();
    const token = extractToken(useAuthStore.getState().token);
    const params = new URLSearchParams({ clientId: `inject-observer-${Date.now()}` });
    if (token) params.set('token', token);
    const url = `${apiBase}/agui/sessions/${sessionId}/observe?${params.toString()}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener('USER_MESSAGE', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!EXTERNAL_SENDERS.includes(data.sender)) return;

        const msg: AgentMessage = {
          id: `inject-${Date.now()}`,
          role: 'user',
          content: data.content || '',
          timestamp: new Date(data.timestamp || Date.now()).toISOString(),
        };
        addMessage(msg);
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener('RUN_FINISHED', async () => {
      if (!loadSessionMessages || !sessionIdRef.current) return;
      try {
        const messagesUrl = new URL(`${apiBase}/sessions/${agentId}/${sessionIdRef.current}/messages`);
        if (projectPath) messagesUrl.searchParams.set('projectPath', projectPath);
        const resp = await authFetch(messagesUrl.toString());
        if (resp.ok) {
          const data = await resp.json();
          const messages = Array.isArray(data) ? data : data.messages || [];
          loadSessionMessages(messages);
        }
      } catch {
        // ignore reload errors
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; just log silently
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, agentId, projectPath, addMessage, loadSessionMessages]);
}
