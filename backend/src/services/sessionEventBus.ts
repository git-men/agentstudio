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
 */
class SessionEventBus {
  private emitter = new EventEmitter();
  private observers = new Map<string, Map<string, ObserverInfo>>();
  
  constructor() {
    // Allow many listeners per session (one per observer)
    this.emitter.setMaxListeners(1000);
  }

  /**
   * Subscribe to events for a specific session
   * Returns an unsubscribe function
   */
  subscribe(
    sessionId: string,
    clientId: string,
    callback: SessionObserverCallback
  ): () => void {
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

    // Subscribe to events
    const listener = (event: SessionEvent) => {
      try {
        callback(event);
      } catch (error) {
        console.error(`[SessionEventBus] Error in observer ${clientId} for session ${sessionId}:`, error);
      }
    };

    this.emitter.on(eventName, listener);

    console.log(`[SessionEventBus] Observer ${clientId} subscribed to session ${sessionId} (total: ${this.observers.get(sessionId)!.size})`);

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
   * Emit an event to all observers of a session
   */
  emit(sessionId: string, event: SessionEvent): void {
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
   * Clean up all observers for a session
   */
  cleanupSession(sessionId: string): void {
    const eventName = `session:${sessionId}`;
    this.emitter.removeAllListeners(eventName);
    this.observers.delete(sessionId);
    console.log(`[SessionEventBus] Cleaned up all observers for session ${sessionId}`);
  }
}

// Singleton instance
export const sessionEventBus = new SessionEventBus();
