import type { StoreApi } from 'zustand';
import { createSessionStore } from '../stores/createSessionStore';
import type { SessionState, SessionActions } from '../stores/createSessionStore';
import { SessionStreamManager } from './SessionStreamManager';

/**
 * Module-level singleton that manages all active session stores and their
 * associated stream managers.
 *
 * This is NOT a React component or hook — it lives outside the component tree
 * so that background SSE processing continues regardless of which session the
 * user is viewing.
 */
class SessionStoreManagerImpl {
  private stores = new Map<string, StoreApi<SessionState & SessionActions>>();
  private streams = new Map<string, SessionStreamManager>();

  /**
   * Returns the existing store for `sessionId`, or creates a new one.
   * Subsequent calls with the same `sessionId` return the same StoreApi.
   */
  getOrCreate(sessionId: string, agentId: string): StoreApi<SessionState & SessionActions> {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = createSessionStore(sessionId, agentId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  /**
   * Returns the store for a session if it exists, or undefined.
   */
  getStore(sessionId: string): StoreApi<SessionState & SessionActions> | undefined {
    return this.stores.get(sessionId);
  }

  /**
   * Associates a SessionStreamManager with a session.
   * Called when an SSE connection is opened for a session.
   */
  attachStream(sessionId: string, stream: SessionStreamManager): void {
    this.streams.set(sessionId, stream);
  }

  /**
   * Returns the stream manager for a session, if one exists.
   */
  getStream(sessionId: string): SessionStreamManager | undefined {
    return this.streams.get(sessionId);
  }

  /**
   * Disposes a single session: aborts its SSE connection, clears its store
   * state, and removes both from internal maps.
   * Idempotent — calling on an already-disposed session is a no-op.
   */
  dispose(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.dispose();
      this.streams.delete(sessionId);
    }

    const store = this.stores.get(sessionId);
    if (store) {
      store.getState().dispose();
      this.stores.delete(sessionId);
    }
  }

  /**
   * Disposes every tracked session. Called on workspace unmount to prevent
   * memory leaks (FR-017).
   */
  disposeAll(): void {
    for (const id of Array.from(this.stores.keys())) {
      this.dispose(id);
    }
  }

  /**
   * Returns the IDs of all sessions that currently have active stores.
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.stores.keys());
  }

  /**
   * Returns the current state snapshot of a session's store, or undefined
   * if no store exists for that session.
   */
  getStoreSnapshot(sessionId: string): (SessionState & SessionActions) | undefined {
    return this.stores.get(sessionId)?.getState();
  }
}

/** Singleton instance used throughout the application. */
export const sessionStoreManager = new SessionStoreManagerImpl();
