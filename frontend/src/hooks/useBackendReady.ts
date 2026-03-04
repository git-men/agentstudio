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
 * Resolves the backend base URL and caches it in the config module so that
 * all synchronous API callers (`getApiBase()`, etc.) can access it.
 *
 * In Web mode: resolves immediately (synchronous-like).
 * In Tauri mode: polls the `get_backend_port` IPC command until the sidecar
 * reports its port or the 30-second timeout expires.
 *
 * Usage:
 * ```tsx
 * const { isReady, error, baseUrl } = useBackendReady();
 * if (!isReady) return <LoadingSpinner />;
 * if (error) return <ErrorView message={error} />;
 * return <App />;
 * ```
 */
export function useBackendReady(): BackendReadyState {
  const [state, setState] = useState<BackendReadyState>({
    isReady: !isTauri(), // In Web mode, considered ready immediately
    error: null,
    baseUrl: null,
  });

  useEffect(() => {
    if (!isTauri()) {
      // Web mode: resolve synchronously to ensure config module is seeded
      getBackendBaseUrl()
        .then((url) => {
          setTauriBackendBaseUrl(url);
          setState({ isReady: true, error: null, baseUrl: url });
        })
        .catch(() => {
          // Web mode resolution should never fail; if it does, allow through
          setState({ isReady: true, error: null, baseUrl: null });
        });
      return;
    }

    // Tauri mode: async port discovery
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
