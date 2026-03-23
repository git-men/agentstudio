import { useState, useCallback, useRef } from 'react';
import { authFetch } from '../lib/authFetch';
import type { DispatchIMRequest, DispatchIMResponse, DispatchStatus } from '../types/dispatch';

interface MessageDispatchState {
  status: DispatchStatus;
  shortId?: string;
  error?: string;
}

export function useDispatchIM() {
  const [statusMap, setStatusMap] = useState<Record<string, MessageDispatchState>>({});
  const abortRef = useRef<AbortController | null>(null);

  const dispatchToIM = useCallback(async (
    messageId: string,
    request: DispatchIMRequest,
  ): Promise<DispatchIMResponse> => {
    setStatusMap(prev => ({
      ...prev,
      [messageId]: { status: 'sending' },
    }));

    try {
      abortRef.current = new AbortController();
      const resp = await authFetch('/api/agui/dispatch-im', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: abortRef.current.signal,
      });

      const data: DispatchIMResponse = await resp.json();

      if (data.success) {
        setStatusMap(prev => ({
          ...prev,
          [messageId]: { status: 'sent', shortId: data.shortId },
        }));
      } else {
        setStatusMap(prev => ({
          ...prev,
          [messageId]: { status: 'error', error: data.error },
        }));
      }

      return data;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      setStatusMap(prev => ({
        ...prev,
        [messageId]: { status: 'error', error },
      }));
      return { success: false, error };
    }
  }, []);

  const getStatus = useCallback(
    (messageId: string): MessageDispatchState =>
      statusMap[messageId] ?? { status: 'idle' },
    [statusMap],
  );

  const resetStatus = useCallback((messageId: string) => {
    setStatusMap(prev => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }, []);

  return { dispatchToIM, getStatus, resetStatus };
}
