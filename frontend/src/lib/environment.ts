/**
 * Tauri environment detection and backend URL resolution.
 *
 * Design principles:
 * - isTauri() is synchronous and safe to call anywhere
 * - getBackendBaseUrl() is async; polls up to 30 s in Tauri mode
 * - Web mode returns a static URL immediately (no async needed)
 * - All logging goes through stderr-safe paths (no console.log)
 */

/**
 * Returns true when the app is running inside a Tauri WebView.
 * Detection is based on the presence of `window.__TAURI_INTERNALS__`
 * which Tauri injects before any JS runs.
 */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window
  );
}

/**
 * Resolve the backend base URL (without trailing slash).
 *
 * - Tauri mode: invokes `get_backend_port` IPC, polling until the port is
 *   available or 30 s have elapsed.
 * - Web mode: returns `http://127.0.0.1:<VITE_API_PORT|4936>` immediately.
 *
 * @throws {Error} After 30 s timeout in Tauri mode.
 */
export async function getBackendBaseUrl(): Promise<string> {
  if (!isTauri()) {
    const port = (import.meta.env.VITE_API_PORT as string | undefined) ?? '4936';
    return `http://127.0.0.1:${port}`;
  }

  // Tauri mode: dynamic port discovery via IPC
  const { invoke } = await import('@tauri-apps/api/core');

  const TIMEOUT_MS = 30_000;
  const POLL_INTERVAL_MS = 200;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    const port = await invoke<number | null>('get_backend_port');
    if (port !== null && port > 0) {
      return `http://127.0.0.1:${port}`;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Backend sidecar failed to start within ${TIMEOUT_MS / 1000} seconds`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
