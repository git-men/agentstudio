import { useState, useEffect } from 'react';
import { isTauri, getBackendBaseUrl } from '../lib/environment';
import { setTauriBackendBaseUrl } from '../lib/config';

export interface BackendReadyState {
  /** True once the backend URL has been resolved and cached */
  isReady: boolean;
  /** Set to the error message if backend failed to start */
  error: string | null;
  /** The resolved base URL (e.g. http://127.0.0.1:4936) */
  baseUrl: string | null;
}

/**
 * In Tauri dev mode, Vite proxy handles API routing so we skip the IPC
 * port-discovery dance (which would cause CORS issues). The env var
 * VITE_TAURI is explicitly set only when the Vite proxy is disabled.
 */
function shouldUseIpcPortDiscovery(): boolean {
  return isTauri() && import.meta.env.VITE_TAURI === 'true';
}

/**
 * Resolves the backend base URL and caches it in the config module so that
 * all synchronous API callers (`getApiBase()`, etc.) can access it.
 *
 * In Web mode: resolves immediately (synchronous-like).
 * In Tauri prod mode (VITE_TAURI=true): polls the `get_backend_port` IPC
 * command until the sidecar reports its port or the 30-second timeout expires.
 * In Tauri dev mode (VITE_TAURI unset): treats as Web mode since Vite proxy
 * forwards API requests, avoiding cross-origin issues.
 */
export function useBackendReady(): BackendReadyState {
  const needsIpc = shouldUseIpcPortDiscovery();

  const [state, setState] = useState<BackendReadyState>({
    isReady: !needsIpc,
    error: null,
    baseUrl: null,
  });

  useEffect(() => {
    if (!needsIpc) {
      getBackendBaseUrl()
        .then((url) => {
          setTauriBackendBaseUrl(url);
          setState({ isReady: true, error: null, baseUrl: url });
        })
        .catch(() => {
          setState({ isReady: true, error: null, baseUrl: null });
        });
      return;
    }

    let cancelled = false;

    getBackendBaseUrl()
      .then((url) => {
        if (cancelled) return;
        setTauriBackendBaseUrl(url);
        setState({ isReady: true, error: null, baseUrl: url });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Backend failed to start';
        setState({ isReady: false, error: message, baseUrl: null });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
