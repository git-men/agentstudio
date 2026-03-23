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

  static readonly MAX_SESSIONS = 50;

  /**
   * Returns the existing store for `sessionId`, or creates a new one.
   * If the session count exceeds MAX_SESSIONS, disposes the least-recently-active
   * idle session to prevent unbounded memory growth.
   */
  getOrCreate(sessionId: string, agentId: string): StoreApi<SessionState & SessionActions> {
    let store = this.stores.get(sessionId);
    if (!store) {
      this.evictIfNeeded();
      store = createSessionStore(sessionId, agentId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  private evictIfNeeded(): void {
    if (this.stores.size < SessionStoreManagerImpl.MAX_SESSIONS) return;

    let oldestId: string | null = null;
    let oldestActivity = Infinity;

    for (const [id, store] of this.stores) {
      const state = store.getState();
      if (state.isAiTyping || id.startsWith('__pending')) continue;
      if (state.lastActivity < oldestActivity) {
        oldestActivity = state.lastActivity;
        oldestId = id;
      }
    }

    if (oldestId) {
      console.log(`[SessionStoreManager] Evicting least-active session: ${oldestId}`);
      this.dispose(oldestId);
    }
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
   * Disposes every tracked session that is not currently streaming.
   * Sessions still streaming are kept alive to avoid corrupting their state.
   * Called on workspace unmount to prevent memory leaks (FR-017).
   */
  disposeAll(): void {
    for (const id of Array.from(this.stores.keys())) {
      const store = this.stores.get(id);
      if (store?.getState().isAiTyping) {
        console.warn(`[SessionStoreManager] Skipping dispose for streaming session: ${id}`);
        continue;
      }
      this.dispose(id);
    }
  }

  /**
   * Migrates a session from oldId to newId in-place: re-keys the same store
   * and stream references so that existing React subscribers (e.g. SessionStoreProvider)
   * keep the same object identity — preventing unnecessary unmount/remount.
   *
   * Also updates the store's internal `sessionId` field.
   */
  migrateSession(oldId: string, newId: string): StoreApi<SessionState & SessionActions> | undefined {
    if (oldId === newId) return this.stores.get(oldId);

    const store = this.stores.get(oldId);
    if (!store) return undefined;

    // Re-key the store
    this.stores.delete(oldId);
    this.stores.set(newId, store);

    // Update the store's internal sessionId
    store.setState({ sessionId: newId } as Partial<SessionState>);

    // Re-key the stream manager
    const stream = this.streams.get(oldId);
    if (stream) {
      this.streams.delete(oldId);
      this.streams.set(newId, stream);
    }

    return store;
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
