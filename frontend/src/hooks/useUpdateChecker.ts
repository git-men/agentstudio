import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../lib/environment';
import type { UpdatePayload } from '../components/desktop/UpdateDialog';

type CheckStatus = 'idle' | 'checking' | 'up_to_date' | 'error';

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

interface UseUpdateCheckerResult {
  updatePayload: UpdatePayload | null;
  dismiss: () => void;
  checkForUpdate: () => Promise<void>;
  checkStatus: CheckStatus;
  checkError: string | null;
  downloadProgress: DownloadProgress | null;
}

/**
 * Listens for the Tauri `update-available` event and exposes the payload.
 *
 * Provides `checkForUpdate()` for manual triggering (settings page, tray menu, etc.).
 * Also listens for `update-check-result` events emitted by the tray-menu handler
 * so the UI can show "already up to date" or error feedback.
 */
export function useUpdateChecker(): UseUpdateCheckerResult {
  const [updatePayload, setUpdatePayload] = useState<UpdatePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checkStatus, setCheckStatus] = useState<CheckStatus>('idle');
  const [checkError, setCheckError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let unlistenUpdate: (() => void) | undefined;
    let unlistenResult: (() => void) | undefined;
    let unlistenProgress: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');

        unlistenUpdate = await listen<UpdatePayload>('update-available', (event) => {
          if (!dismissed) {
            setUpdatePayload(event.payload);
            setCheckStatus('idle');
          }
        });

        unlistenResult = await listen<{ status: string; message?: string }>(
          'update-check-result',
          (event) => {
            const { status, message } = event.payload;
            if (status === 'up_to_date') {
              setCheckStatus('up_to_date');
              setTimeout(() => setCheckStatus('idle'), 5000);
            } else if (status === 'error') {
              setCheckStatus('error');
              setCheckError(message ?? 'Unknown error');
            }
          },
        );

        unlistenProgress = await listen<{ downloaded: number; total: number | null }>(
          'update-download-progress',
          (event) => {
            setDownloadProgress({
              downloaded: event.payload.downloaded,
              total: event.payload.total,
            });
          },
        );
      } catch {
        // Non-fatal: if event system is unavailable, silently skip
      }
    };

    subscribe();

    return () => {
      unlistenUpdate?.();
      unlistenResult?.();
      unlistenProgress?.();
    };
  }, [dismissed]);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) return;
    setCheckStatus('checking');
    setCheckError(null);
    setDownloadProgress(null);
    setDismissed(false);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ version: string; notes: string } | null>('check_update');
      if (result) {
        setUpdatePayload(result);
        setCheckStatus('idle');
      } else {
        setCheckStatus('up_to_date');
        setTimeout(() => setCheckStatus('idle'), 5000);
      }
    } catch (err) {
      setCheckStatus('error');
      setCheckError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setUpdatePayload(null);
  }, []);

  return { updatePayload, dismiss, checkForUpdate, checkStatus, checkError, downloadProgress };
}
