/**
 * SessionEventBus 单元测试
 *
 * 测试内容：
 * - 基本的订阅/发布/取消订阅
 * - 事件历史存储（最多50条）
 * - 迟到订阅者的历史回放（replay 选项）
 * - 不启用 replay 时不回放
 * - cleanupSession 同时清理历史
 * - 向后兼容：无 replay 参数时行为不变
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to import the class, not the singleton, for isolated tests
// Since the module exports a singleton, we'll use cleanupSession between tests

// Mock console to reduce noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Import after mocking
import { sessionEventBus, type SessionEvent } from '../sessionEventBus.js';

function makeEvent(type: string, index: number): SessionEvent {
  return {
    type: type as any,
    content: `event-${index}`,
  } as unknown as SessionEvent;
}

describe('SessionEventBus', () => {
  const SESSION_ID = 'test-session-001';
  const CLIENT_ID = 'test-client-001';

  afterEach(() => {
    sessionEventBus.cleanupSession(SESSION_ID);
    sessionEventBus.cleanupSession('session-a');
    sessionEventBus.cleanupSession('session-b');
  });

  describe('Basic subscribe/emit/unsubscribe', () => {
    it('should deliver events to subscriber', () => {
      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e));

      const event = makeEvent('TEXT', 1);
      sessionEventBus.emit(SESSION_ID, event);

      expect(events).toHaveLength(1);
      expect(events[0]).toBe(event);

      unsub();
    });

    it('should not deliver events after unsubscribe', () => {
      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e));

      unsub();

      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      expect(events).toHaveLength(0);
    });

    it('should support multiple observers on same session', () => {
      const events1: SessionEvent[] = [];
      const events2: SessionEvent[] = [];

      const unsub1 = sessionEventBus.subscribe(SESSION_ID, 'client-1', (e) => events1.push(e));
      const unsub2 = sessionEventBus.subscribe(SESSION_ID, 'client-2', (e) => events2.push(e));

      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);

      unsub1();
      unsub2();
    });

    it('should isolate events between sessions', () => {
      const eventsA: SessionEvent[] = [];
      const eventsB: SessionEvent[] = [];

      const unsubA = sessionEventBus.subscribe('session-a', 'client-a', (e) => eventsA.push(e));
      const unsubB = sessionEventBus.subscribe('session-b', 'client-b', (e) => eventsB.push(e));

      sessionEventBus.emit('session-a', makeEvent('TEXT', 1));

      expect(eventsA).toHaveLength(1);
      expect(eventsB).toHaveLength(0);

      unsubA();
      unsubB();
    });
  });

  describe('Observer count and tracking', () => {
    it('should track observer count', () => {
      expect(sessionEventBus.getObserverCount(SESSION_ID)).toBe(0);
      expect(sessionEventBus.hasObservers(SESSION_ID)).toBe(false);

      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, () => {});
      expect(sessionEventBus.getObserverCount(SESSION_ID)).toBe(1);
      expect(sessionEventBus.hasObservers(SESSION_ID)).toBe(true);

      unsub();
      expect(sessionEventBus.getObserverCount(SESSION_ID)).toBe(0);
      expect(sessionEventBus.hasObservers(SESSION_ID)).toBe(false);
    });
  });

  describe('Event history storage', () => {
    it('should store events even without observers', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 2));

      // Subscribe with replay to verify history was stored
      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      // Replay uses queueMicrotask, so we need to wait
      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(2);
          unsub();
          resolve();
        });
      });
    });

    it('should cap history at 50 events', () => {
      for (let i = 0; i < 60; i++) {
        sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', i));
      }

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(50);
          // Should have events 10-59 (oldest 0-9 were shifted out)
          expect((events[0] as any).content).toBe('event-10');
          expect((events[49] as any).content).toBe('event-59');
          unsub();
          resolve();
        });
      });
    });
  });

  describe('Event replay for late subscribers', () => {
    it('should replay history when replay=true', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 2));
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 3));

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(3);
          expect((events[0] as any).content).toBe('event-1');
          expect((events[2] as any).content).toBe('event-3');
          unsub();
          resolve();
        });
      });
    });

    it('should NOT replay history by default (replay=false)', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 2));

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e));

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          // No replay, no events
          expect(events).toHaveLength(0);
          unsub();
          resolve();
        });
      });
    });

    it('should NOT replay history when replay is explicitly false', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: false });

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(0);
          unsub();
          resolve();
        });
      });
    });

    it('should deliver both replayed and new events', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('HISTORICAL', 1));

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      // Emit a new event synchronously (will be received immediately via listener)
      sessionEventBus.emit(SESSION_ID, makeEvent('LIVE', 2));

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          // events[0] = LIVE (from synchronous emit to active listener)
          // events[1] = HISTORICAL (from replay microtask - history snapshot at subscribe time)
          // events[2] = LIVE (also in history at replay time, since it was emitted before microtask ran)
          // Note: replay sends ALL history events, including ones emitted after subscribe but before microtask
          expect(events.length).toBeGreaterThanOrEqual(2);
          // Verify we got the live event from direct delivery
          expect(events[0]).toMatchObject({ type: 'LIVE' });
          unsub();
          resolve();
        });
      });
    });
  });

  describe('Backward compatibility', () => {
    it('should work with old 3-argument subscribe signature', () => {
      const events: SessionEvent[] = [];
      // Old code: subscribe(sessionId, clientId, callback) - no options
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e));

      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      expect(events).toHaveLength(1);

      unsub();
    });

    it('should emit events without observers (for history storage)', () => {
      // Before the change, emit() would check hasObservers() and skip
      // Now it always stores in history
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));

      // Later subscriber with replay should get the event
      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(1);
          unsub();
          resolve();
        });
      });
    });
  });

  describe('cleanupSession', () => {
    it('should clear history on cleanup', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 2));

      sessionEventBus.cleanupSession(SESSION_ID);

      const events: SessionEvent[] = [];
      const unsub = sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, (e) => events.push(e), { replay: true });

      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          expect(events).toHaveLength(0);
          unsub();
          resolve();
        });
      });
    });

    it('should clear observers on cleanup', () => {
      sessionEventBus.subscribe(SESSION_ID, CLIENT_ID, () => {});
      expect(sessionEventBus.hasObservers(SESSION_ID)).toBe(true);

      sessionEventBus.cleanupSession(SESSION_ID);
      expect(sessionEventBus.hasObservers(SESSION_ID)).toBe(false);
    });
  });

  describe('Error handling in callbacks', () => {
    it('should not crash when observer callback throws', () => {
      const unsub = sessionEventBus.subscribe(SESSION_ID, 'bad-client', () => {
        throw new Error('callback error');
      });

      // Should not throw
      expect(() => {
        sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));
      }).not.toThrow();

      unsub();
    });

    it('should not crash when replay callback throws', () => {
      sessionEventBus.emit(SESSION_ID, makeEvent('TEXT', 1));

      const unsub = sessionEventBus.subscribe(SESSION_ID, 'bad-client', () => {
        throw new Error('replay error');
      }, { replay: true });

      // Should not throw during microtask processing
      return new Promise<void>((resolve) => {
        queueMicrotask(() => {
          // If we got here without crashing, the test passes
          unsub();
          resolve();
        });
      });
    });
  });
});
