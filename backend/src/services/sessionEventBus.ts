/**
 * Session Event Bus
 * 
 * Provides centralized event broadcasting for AGUI sessions.
 * Enables:
 * - Observer pattern: multiple clients can watch a session's events
 * - Inject pattern: external agents can inject messages into a session
 * - Fan-out: events are broadcast to all subscribers of a session
 * 
 * Used by:
 * - observe endpoint: subscribes to session events (SSE fan-out)
 * - inject endpoint: pushes user_message events before engine processing
 * - AGUI chat route: pushes AI response events during normal chat flow
 */

import { EventEmitter } from 'events';
import type { AGUIEvent } from '../engines/types.js';

/**
 * User message event (injected by Facilitator Agent or owner)
 */
export interface UserMessageEvent {
  type: 'USER_MESSAGE';
  content: string;
  sender: string; // 'owner' | 'facilitator-agent' | agent name
  timestamp: number;
  sessionId: string;
}

export type SessionEvent = AGUIEvent | UserMessageEvent;

/**
 * Observer callback type
 */
export type SessionObserverCallback = (event: SessionEvent) => void;

/**
 * Session observer info
 */
interface ObserverInfo {
  callback: SessionObserverCallback;
  connectedAt: number;
  clientId: string;
}

/**
 * Centralized event bus for AGUI session broadcasting.
 * Singleton - use the exported `sessionEventBus` instance.
 *
 * Supports event history replay: late subscribers receive recent events
 * from the session, preventing race conditions where events are missed.
 */
class SessionEventBus {
  private emitter = new EventEmitter();
  private observers = new Map<string, Map<string, ObserverInfo>>();
  /** Event history per session for late-subscriber replay */
  private sessionHistory = new Map<string, SessionEvent[]>();
  /** Max events to keep per session history */
  private static MAX_HISTORY_PER_SESSION = 50;
  
  constructor() {
    // Allow many listeners per session (one per observer)
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Subscribe to events for a specific session.
   * Returns an unsubscribe function.
   *
   * @param options.replay - If true, replay historical events to this subscriber.
   *   Default: false. Only enable for read-only observers (e.g. browser UI)
   *   that join after events have already been emitted. Do NOT enable for
   *   stateful consumers like SessionTracker that trigger side effects.
   */
  subscribe(
    sessionId: string,
    clientId: string,
    callback: SessionObserverCallback,
    options?: { replay?: boolean }
  ): () => void {
    const replay = options?.replay ?? false;
    const eventName = `session:${sessionId}`;

    // Track observer
    if (!this.observers.has(sessionId)) {
      this.observers.set(sessionId, new Map());
    }
    this.observers.get(sessionId)!.set(clientId, {
      callback,
      connectedAt: Date.now(),
      clientId,
    });

    // Subscribe to future events
    const listener = (event: SessionEvent) => {
      try {
        callback(event);
      } catch (error) {
        console.error(`[SessionEventBus] Error in observer ${clientId} for session ${sessionId}:`, error);
      }
    };

    this.emitter.on(eventName, listener);

    const historySize = this.sessionHistory.get(sessionId)?.length ?? 0;
    console.log(`[SessionEventBus] Observer ${clientId} subscribed to session ${sessionId} (total: ${this.observers.get(sessionId)!.size}, history: ${historySize}, replay: ${replay})`);

    // Replay event history only if explicitly requested (opt-in)
    if (replay && historySize > 0) {
      const history = this.sessionHistory.get(sessionId)!;
      console.log(`[SessionEventBus] Replaying ${history.length} historical events to ${clientId}`);
      queueMicrotask(() => {
        for (const event of history) {
          try {
            callback(event);
          } catch (error) {
            console.error(`[SessionEventBus] Error replaying event to ${clientId}:`, error);
          }
        }
      });
    }

    // Return unsubscribe function
    return () => {
      this.emitter.off(eventName, listener);
      const sessionObservers = this.observers.get(sessionId);
      if (sessionObservers) {
        sessionObservers.delete(clientId);
        if (sessionObservers.size === 0) {
          this.observers.delete(sessionId);
        }
      }
      console.log(`[SessionEventBus] Observer ${clientId} unsubscribed from session ${sessionId} (remaining: ${this.observers.get(sessionId)?.size ?? 0})`);
    };
  }

  /**
   * Emit an event to all observers of a session.
   * Events are also stored in history for late-subscriber replay.
   */
  emit(sessionId: string, event: SessionEvent): void {
    // Store in history
    if (!this.sessionHistory.has(sessionId)) {
      this.sessionHistory.set(sessionId, []);
    }
    const history = this.sessionHistory.get(sessionId)!;
    history.push(event);
    if (history.length > SessionEventBus.MAX_HISTORY_PER_SESSION) {
      history.shift();
    }

    const eventName = `session:${sessionId}`;
    this.emitter.emit(eventName, event);
  }

  /**
   * Get the number of observers for a session
   */
  getObserverCount(sessionId: string): number {
    return this.observers.get(sessionId)?.size ?? 0;
  }

  /**
   * Check if a session has any observers
   */
  hasObservers(sessionId: string): boolean {
    return (this.observers.get(sessionId)?.size ?? 0) > 0;
  }

  /**
   * Get all active session IDs with observers
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.observers.keys());
  }

  /**
   * Clean up all observers and history for a session
   */
  cleanupSession(sessionId: string): void {
    const eventName = `session:${sessionId}`;
    this.emitter.removeAllListeners(eventName);
    this.observers.delete(sessionId);
    this.sessionHistory.delete(sessionId);
    console.log(`[SessionEventBus] Cleaned up all observers and history for session ${sessionId}`);
  }
}

// Singleton instance
export const sessionEventBus = new SessionEventBus();
