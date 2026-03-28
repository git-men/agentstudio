import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../lib/environment';
import type { UpdatePayload } from '../components/desktop/UpdateDialog';

interface UseUpdateCheckerResult {
  updatePayload: UpdatePayload | null;
  dismiss: () => void;
}

/**
 * Listens for the Tauri `update-available` event and exposes the payload.
 *
 * - Only activates inside a Tauri environment.
 * - Once dismissed, will not show again for the current session.
 * - Returns null payload in web / non-Tauri mode (no-op).
 */
export function useUpdateChecker(): UseUpdateCheckerResult {
  const [updatePayload, setUpdatePayload] = useState<UpdatePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri() || dismissed) {
      return;
    }

    let unlisten: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<UpdatePayload>('update-available', (event) => {
          if (!dismissed) {
            setUpdatePayload(event.payload);
          }
        });
      } catch (err) {
        // Non-fatal: if event system is unavailable, silently skip
      }
    };

    subscribe();

    return () => {
      unlisten?.();
    };
  }, [dismissed]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setUpdatePayload(null);
  }, []);

  return { updatePayload, dismiss };
}
