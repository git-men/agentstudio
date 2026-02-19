import { describe, it, expect, beforeEach, vi } from 'vitest';
import { platformEventBus } from '../platformEventBus.js';
import type { HookEvent } from '../../../types/platformHooks.js';

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'run.end',
    timestamp: new Date().toISOString(),
    source: 'TestRunner',
    data: {},
    ...overrides,
  };
}

describe('PlatformEventBus', () => {
  beforeEach(() => {
    platformEventBus.removeAllListeners();
  });

  it('should deliver event to exact-type subscriber', () => {
    const events: HookEvent[] = [];
    platformEventBus.subscribe('run.end', e => events.push(e));

    const event = makeEvent();
    platformEventBus.emit(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toBe(event);
  });

  it('should not deliver event to subscriber for different type', () => {
    const events: HookEvent[] = [];
    platformEventBus.subscribe('run.start', e => events.push(e));

    platformEventBus.emit(makeEvent({ type: 'run.end' }));

    expect(events).toHaveLength(0);
  });

  it('should deliver all events to wildcard subscriber', () => {
    const events: HookEvent[] = [];
    platformEventBus.subscribe('*', e => events.push(e));

    platformEventBus.emit(makeEvent({ type: 'run.start' }));
    platformEventBus.emit(makeEvent({ type: 'run.end' }));
    platformEventBus.emit(makeEvent({ type: 'message.agent_reply' }));

    expect(events).toHaveLength(3);
    expect(events.map(e => e.type)).toEqual(['run.start', 'run.end', 'message.agent_reply']);
  });

  it('should stop delivering after unsubscribe', () => {
    const events: HookEvent[] = [];
    const unsub = platformEventBus.subscribe('run.end', e => events.push(e));

    platformEventBus.emit(makeEvent());
    expect(events).toHaveLength(1);

    unsub();
    platformEventBus.emit(makeEvent());
    expect(events).toHaveLength(1);
  });

  it('should deliver to multiple subscribers on same type', () => {
    const a: HookEvent[] = [];
    const b: HookEvent[] = [];
    platformEventBus.subscribe('run.end', e => a.push(e));
    platformEventBus.subscribe('run.end', e => b.push(e));

    platformEventBus.emit(makeEvent());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('should not crash when subscriber throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    platformEventBus.subscribe('run.end', () => {
      throw new Error('subscriber error');
    });

    const events: HookEvent[] = [];
    platformEventBus.subscribe('run.end', e => events.push(e));

    platformEventBus.emit(makeEvent());

    expect(events).toHaveLength(1);
    consoleSpy.mockRestore();
  });

  it('should preserve event payload integrity', () => {
    const received: HookEvent[] = [];
    platformEventBus.subscribe('run.end', e => received.push(e));

    const event = makeEvent({
      sessionId: 'sess-1',
      projectId: 'proj-1',
      agentId: 'agent-1',
      data: { engine: 'claude', durationMs: 1234 },
    });

    platformEventBus.emit(event);

    expect(received[0]).toStrictEqual(event);
    expect(received[0].data).toEqual({ engine: 'claude', durationMs: 1234 });
  });

  it('should report correct listener count', () => {
    expect(platformEventBus.listenerCount('run.end')).toBe(0);

    const unsub1 = platformEventBus.subscribe('run.end', () => {});
    const unsub2 = platformEventBus.subscribe('run.end', () => {});

    expect(platformEventBus.listenerCount('run.end')).toBe(2);

    unsub1();
    expect(platformEventBus.listenerCount('run.end')).toBe(1);

    unsub2();
    expect(platformEventBus.listenerCount('run.end')).toBe(0);
  });
});
