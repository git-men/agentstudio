import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import { createSessionStore } from './createSessionStore';
import type { SessionState, SessionActions } from './createSessionStore';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SessionStoreContext = createContext<StoreApi<SessionState & SessionActions> | null>(null);

// ---------------------------------------------------------------------------
// Provider (re-export of Context.Provider)
// ---------------------------------------------------------------------------

export const SessionStoreProvider = SessionStoreContext.Provider;

// ---------------------------------------------------------------------------
// Hook — strict (throws outside Provider)
// ---------------------------------------------------------------------------

/**
 * Select state from the active session's store provided by SessionStoreProvider.
 * Must be used within a SessionStoreProvider — throws if the context is null.
 *
 * Uses Zustand's `useStore` internally so the component re-renders only when
 * the selected slice changes (shallow equality by default).
 */
export function useSessionStore<T>(
  selector: (state: SessionState & SessionActions) => T,
): T {
  const store = useContext(SessionStoreContext);
  if (!store) {
    throw new Error(
      'useSessionStore must be used within a <SessionStoreProvider>. ' +
        'Wrap your component tree with <SessionStoreProvider value={storeApi}>.',
    );
  }
  return useStore(store, selector);
}

// ---------------------------------------------------------------------------
// Hook — optional (safe to use outside Provider)
// ---------------------------------------------------------------------------

/**
 * Module-level fallback store that is never mutated.
 * Used as the subscription target for `useSessionStoreOptional` when no
 * SessionStoreProvider is present. Since it never changes, the subscription
 * is effectively a no-op — zero overhead in legacy (non-workspace) mode.
 */
const FALLBACK_STORE = createSessionStore('__fallback__', '__fallback__');

/**
 * Like `useSessionStore`, but returns the fallback store's value when used
 * outside a Provider instead of throwing.  This enables components that
 * work in BOTH workspace mode (Context-provided store) and legacy ChatPage
 * mode (useAgentStore facade).
 */
export function useSessionStoreOptional<T>(
  selector: (state: SessionState & SessionActions) => T,
): T {
  const store = useContext(SessionStoreContext);
  return useStore(store ?? FALLBACK_STORE, selector);
}

/**
 * Returns `true` when the calling component is inside a
 * `<SessionStoreProvider>` — i.e. the workspace route.
 */
export function useIsWorkspaceMode(): boolean {
  return useContext(SessionStoreContext) !== null;
}

export { SessionStoreContext };
