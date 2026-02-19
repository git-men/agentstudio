import { EventEmitter } from 'events';
import type { HookEvent } from '../../types/platformHooks.js';

type EventHandler = (event: HookEvent) => void;

const WILDCARD = '*';

/**
 * Platform-level event bus for the hook system.
 * Services emit events here; HookManager subscribes and dispatches hooks.
 * Separate from sessionEventBus (which is session-scoped for AGUI SSE delivery).
 */
class PlatformEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  emit(event: HookEvent): void {
    try {
      this.emitter.emit(event.type, event);
      this.emitter.emit(WILDCARD, event);
    } catch (err) {
      console.error('[HookSystem] PlatformEventBus emit error:', err);
    }
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    const safeHandler: EventHandler = (event) => {
      try {
        handler(event);
      } catch (err) {
        console.error(`[HookSystem] Subscriber error for "${eventType}":`, err);
      }
    };

    this.emitter.on(eventType, safeHandler);
    return () => {
      this.emitter.off(eventType, safeHandler);
    };
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(eventType: string): number {
    return this.emitter.listenerCount(eventType);
  }
}

export const platformEventBus = new PlatformEventBus();
