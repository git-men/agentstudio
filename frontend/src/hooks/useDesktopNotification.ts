import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/environment';

/**
 * Hook for sending native desktop notifications via Tauri.
 *
 * - In Tauri mode: delegates to the `send_notification` IPC command.
 * - In web mode: no-op (notification not sent).
 *
 * Usage:
 *   const { notify } = useDesktopNotification();
 *   await notify('Task Complete', 'Your agent finished the job.');
 */
export function useDesktopNotification() {
  const notify = async (title: string, body: string): Promise<void> => {
    if (!isTauri()) {
      return;
    }
    await invoke('send_notification', { title, body });
  };

  return { notify };
}
