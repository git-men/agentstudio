import { useState, useEffect, useCallback, useRef } from 'react';
import { isTauri } from '../lib/environment';
import { getCapturedLogs, clearCapturedLogs, type CapturedLogEntry } from '../utils/consoleCapture';

export interface BackendLogEntry {
  level: string;
  message: string;
  timestamp: string;
  source: 'backend' | 'frontend';
}

const MAX_LOGS = 500;

export function useBackendLogs() {
  const [logs, setLogs] = useState<BackendLogEntry[]>([]);
  const [visible, setVisible] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;

      const unlisten = await listen<{ level: string; message: string }>('backend-log', (event) => {
        const entry: BackendLogEntry = {
          level: event.payload.level,
          message: event.payload.message.replace(/\n$/, ''),
          timestamp: new Date().toISOString(),
          source: 'backend',
        };
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
        });
      });

      if (cancelled) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    })();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const toggleVisible = useCallback(() => setVisible((v) => !v), []);

  const getFrontendLogs = useCallback((): BackendLogEntry[] => {
    return getCapturedLogs().map((entry: CapturedLogEntry) => ({
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
      source: 'frontend' as const,
    }));
  }, []);

  const clearFrontendLogs = useCallback(() => clearCapturedLogs(), []);

  return { logs, visible, setVisible, toggleVisible, clearLogs, getFrontendLogs, clearFrontendLogs };
}
