import { useState, useEffect, useCallback, useRef } from 'react';
import { isTauri } from '../lib/environment';
import { getCapturedLogs, clearCapturedLogs, onConsoleEntry, type CapturedLogEntry } from '../utils/consoleCapture';

export interface BackendLogEntry {
  level: string;
  message: string;
  timestamp: string;
  source: 'backend' | 'frontend';
}

const MAX_LOGS = 500;

function appendLogs(prev: BackendLogEntry[], entries: BackendLogEntry[]): BackendLogEntry[] {
  const next = [...prev, ...entries];
  return next.length > MAX_LOGS ? next.slice(-MAX_LOGS) : next;
}

export function useBackendLogs() {
  const [logs, setLogs] = useState<BackendLogEntry[]>([]);
  const [frontendLogs, setFrontendLogs] = useState<BackendLogEntry[]>([]);
  const [visible, setVisible] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);
  const unsubConsoleRef = useRef<(() => void) | null>(null);

  // Backend log batch events from Tauri
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      if (cancelled) return;

      const unlisten = await listen<Array<{ level: string; message: string }>>('backend-log-batch', (event) => {
        const now = new Date().toISOString();
        const entries: BackendLogEntry[] = event.payload.map(e => ({
          level: e.level,
          message: e.message.replace(/\n$/, ''),
          timestamp: now,
          source: 'backend' as const,
        }));
        setLogs((prev) => appendLogs(prev, entries));
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

  // Frontend console entries (event-driven via onConsoleEntry)
  useEffect(() => {
    setFrontendLogs(
      getCapturedLogs().map((e: CapturedLogEntry) => ({
        level: e.level,
        message: e.message,
        timestamp: e.timestamp,
        source: 'frontend' as const,
      })),
    );

    const unsub = onConsoleEntry((entry: CapturedLogEntry) => {
      setFrontendLogs((prev) =>
        appendLogs(prev, [{
          level: entry.level,
          message: entry.message,
          timestamp: entry.timestamp,
          source: 'frontend',
        }]),
      );
    });
    unsubConsoleRef.current = unsub;

    return () => {
      unsub();
    };
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);
  const toggleVisible = useCallback(() => setVisible((v) => !v), []);

  const clearFrontendLogs = useCallback(() => {
    clearCapturedLogs();
    setFrontendLogs([]);
  }, []);

  return { logs, frontendLogs, visible, setVisible, toggleVisible, clearLogs, clearFrontendLogs };
}
