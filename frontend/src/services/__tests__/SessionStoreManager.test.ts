import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSessionStore } from '../../stores/createSessionStore';
import { SessionStreamManager } from '../SessionStreamManager';

vi.mock('../frontendToolRegistry', () => ({
  isFrontendToolName: () => false,
  extractFrontendToolShortName: (name: string) => name,
}));

/**
 * We need a fresh singleton for each test, so we re-import the module.
 * The singleton is module-scoped, so we use `vi.resetModules()`.
 */
async function freshManager() {
  vi.resetModules();
  const mod = await import('../SessionStoreManager');
  return mod.sessionStoreManager;
}

describe('SessionStoreManager', () => {
  let manager: Awaited<ReturnType<typeof freshManager>>;

  beforeEach(async () => {
    manager = await freshManager();
  });

  describe('getOrCreate', () => {
    it('creates a new store on first call', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      expect(store).toBeDefined();
      expect(store.getState().sessionId).toBe('s1');
      expect(store.getState().agentId).toBe('agent-1');
    });

    it('returns the same store on second call with same sessionId', () => {
      const storeA = manager.getOrCreate('s1', 'agent-1');
      const storeB = manager.getOrCreate('s1', 'agent-1');
      expect(storeA).toBe(storeB);
    });

    it('returns different stores for different sessionIds', () => {
      const storeA = manager.getOrCreate('s1', 'agent-1');
      const storeB = manager.getOrCreate('s2', 'agent-1');
      expect(storeA).not.toBe(storeB);
    });
  });

  describe('getStore', () => {
    it('returns undefined for unknown session', () => {
      expect(manager.getStore('unknown')).toBeUndefined();
    });

    it('returns the store after getOrCreate', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      expect(manager.getStore('s1')).toBe(store);
    });
  });

  describe('attachStream / getStream', () => {
    it('returns undefined when no stream attached', () => {
      expect(manager.getStream('s1')).toBeUndefined();
    });

    it('returns the attached stream', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      const stream = new SessionStreamManager(store);
      manager.attachStream('s1', stream);
      expect(manager.getStream('s1')).toBe(stream);
    });
  });

  describe('dispose', () => {
    it('removes store and stream from maps', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      const stream = new SessionStreamManager(store);
      manager.attachStream('s1', stream);

      manager.dispose('s1');

      expect(manager.getStore('s1')).toBeUndefined();
      expect(manager.getStream('s1')).toBeUndefined();
    });

    it('calls stream.dispose()', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      const stream = new SessionStreamManager(store);
      const disposeSpy = vi.spyOn(stream, 'dispose');
      manager.attachStream('s1', stream);

      manager.dispose('s1');

      expect(disposeSpy).toHaveBeenCalled();
    });

    it('calls store.getState().dispose()', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      store.getState().addMessage({ content: 'test', role: 'user' });
      expect(store.getState().messages.length).toBe(1);

      manager.dispose('s1');

      expect(store.getState().isDisposed).toBe(true);
      expect(store.getState().messages).toEqual([]);
    });

    it('is idempotent — calling on an already-disposed session is a no-op', () => {
      manager.getOrCreate('s1', 'agent-1');
      manager.dispose('s1');
      expect(() => manager.dispose('s1')).not.toThrow();
    });

    it('does not affect other sessions', () => {
      manager.getOrCreate('s1', 'agent-1');
      const storeB = manager.getOrCreate('s2', 'agent-1');
      storeB.getState().addMessage({ content: 'msg-b', role: 'user' });

      manager.dispose('s1');

      expect(manager.getStore('s2')).toBe(storeB);
      expect(storeB.getState().messages.length).toBe(1);
    });
  });

  describe('disposeAll', () => {
    it('cleans up all tracked sessions', () => {
      manager.getOrCreate('s1', 'agent-1');
      manager.getOrCreate('s2', 'agent-1');
      manager.getOrCreate('s3', 'agent-1');

      manager.disposeAll();

      expect(manager.getActiveSessionIds()).toEqual([]);
      expect(manager.getStore('s1')).toBeUndefined();
      expect(manager.getStore('s2')).toBeUndefined();
      expect(manager.getStore('s3')).toBeUndefined();
    });

    it('calls dispose on each stream', () => {
      const store1 = manager.getOrCreate('s1', 'agent-1');
      const store2 = manager.getOrCreate('s2', 'agent-1');
      const stream1 = new SessionStreamManager(store1);
      const stream2 = new SessionStreamManager(store2);
      const spy1 = vi.spyOn(stream1, 'dispose');
      const spy2 = vi.spyOn(stream2, 'dispose');
      manager.attachStream('s1', stream1);
      manager.attachStream('s2', stream2);

      manager.disposeAll();

      expect(spy1).toHaveBeenCalled();
      expect(spy2).toHaveBeenCalled();
    });

    it('is safe to call when empty', () => {
      expect(() => manager.disposeAll()).not.toThrow();
    });
  });

  describe('migrateSession (duplicate sidebar regression)', () => {
    it('re-keys store from oldId to newId', () => {
      const store = manager.getOrCreate('old-uuid', 'agent-1');
      store.getState().addMessage({ content: 'hello', role: 'user' });

      const migrated = manager.migrateSession('old-uuid', 'new-uuid');

      expect(migrated).toBe(store);
      expect(manager.getStore('old-uuid')).toBeUndefined();
      expect(manager.getStore('new-uuid')).toBe(store);
      expect(store.getState().sessionId).toBe('new-uuid');
      expect(store.getState().messages).toHaveLength(1);
    });

    it('re-keys attached stream along with the store', () => {
      const store = manager.getOrCreate('old-uuid', 'agent-1');
      const stream = new SessionStreamManager(store);
      manager.attachStream('old-uuid', stream);

      manager.migrateSession('old-uuid', 'new-uuid');

      expect(manager.getStream('old-uuid')).toBeUndefined();
      expect(manager.getStream('new-uuid')).toBe(stream);
    });

    it('returns existing store if oldId === newId (no-op)', () => {
      const store = manager.getOrCreate('same-id', 'agent-1');
      const result = manager.migrateSession('same-id', 'same-id');

      expect(result).toBe(store);
      expect(manager.getStore('same-id')).toBe(store);
    });

    it('returns undefined if oldId store does not exist', () => {
      const result = manager.migrateSession('nonexistent', 'new-id');
      expect(result).toBeUndefined();
    });

    it('preserves messages and state across migration', () => {
      const store = manager.getOrCreate('temp-session', 'agent-1');
      store.getState().addMessage({ content: 'msg1', role: 'user' });
      store.getState().addMessage({ content: 'msg2', role: 'assistant' });
      store.getState().setStatus('running');
      store.getState().setTitle('My Chat');

      manager.migrateSession('temp-session', 'real-uuid-123');

      const migrated = manager.getStore('real-uuid-123')!;
      expect(migrated.getState().messages).toHaveLength(2);
      expect(migrated.getState().messages[0].content).toBe('msg1');
      expect(migrated.getState().messages[1].content).toBe('msg2');
      expect(migrated.getState().status).toBe('running');
      expect(migrated.getState().title).toBe('My Chat');
      expect(migrated.getState().sessionId).toBe('real-uuid-123');
    });

    it('updates getActiveSessionIds after migration', () => {
      manager.getOrCreate('old-id', 'agent-1');
      manager.getOrCreate('other-id', 'agent-1');

      manager.migrateSession('old-id', 'new-id');

      const ids = manager.getActiveSessionIds();
      expect(ids).toContain('new-id');
      expect(ids).toContain('other-id');
      expect(ids).not.toContain('old-id');
    });

    it('does not affect other sessions', () => {
      manager.getOrCreate('session-a', 'agent-1');
      const storeB = manager.getOrCreate('session-b', 'agent-1');
      storeB.getState().addMessage({ content: 'independent', role: 'user' });

      manager.migrateSession('session-a', 'session-a-new');

      expect(manager.getStore('session-b')).toBe(storeB);
      expect(storeB.getState().messages).toHaveLength(1);
      expect(storeB.getState().sessionId).toBe('session-b');
    });
  });

  describe('getActiveSessionIds', () => {
    it('returns empty array initially', () => {
      expect(manager.getActiveSessionIds()).toEqual([]);
    });

    it('returns correct list after creating stores', () => {
      manager.getOrCreate('s1', 'agent-1');
      manager.getOrCreate('s2', 'agent-1');
      const ids = manager.getActiveSessionIds();
      expect(ids).toContain('s1');
      expect(ids).toContain('s2');
      expect(ids.length).toBe(2);
    });

    it('removes disposed sessions from the list', () => {
      manager.getOrCreate('s1', 'agent-1');
      manager.getOrCreate('s2', 'agent-1');
      manager.dispose('s1');
      const ids = manager.getActiveSessionIds();
      expect(ids).toEqual(['s2']);
    });
  });

  describe('getStoreSnapshot', () => {
    it('returns undefined for unknown session', () => {
      expect(manager.getStoreSnapshot('unknown')).toBeUndefined();
    });

    it('returns current state of a session store', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      store.getState().setTitle('Test Title');

      const snapshot = manager.getStoreSnapshot('s1');
      expect(snapshot?.title).toBe('Test Title');
      expect(snapshot?.sessionId).toBe('s1');
    });

    it('reflects state changes', () => {
      const store = manager.getOrCreate('s1', 'agent-1');
      expect(manager.getStoreSnapshot('s1')?.status).toBe('idle');

      store.getState().setStatus('running');
      expect(manager.getStoreSnapshot('s1')?.status).toBe('running');
    });
  });
});
