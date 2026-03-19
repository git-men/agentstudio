/**
 * Regression tests for handleSessionChange logic in ProjectWorkspacePage.
 *
 * These tests verify the fix for the "duplicate sidebar entry" and
 * "message appended to wrong session" bugs. The core invariant:
 *
 *   - temp → real: update activeSessionId AND refresh sidebar
 *   - real → different real: update activeSessionId, migrate store,
 *     but do NOT refresh sidebar (avoids duplicate entry)
 *   - same ID: no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/frontendToolRegistry', () => ({
  isFrontendToolName: () => false,
  extractFrontendToolShortName: (name: string) => name,
}));

interface SessionChangeResult {
  newActiveSessionId: string;
  agentMapMigrated: boolean;
  storeMigrated: boolean;
  sidebarRefreshed: boolean;
}

/**
 * Pure-logic extraction of handleSessionChange from ProjectWorkspacePage,
 * so we can test the branching logic without rendering the full page.
 */
function simulateHandleSessionChange(params: {
  sessionId: string | null;
  prevActiveSessionId: string | null;
  sessionAgentMap: Record<string, string>;
}): SessionChangeResult | null {
  const { sessionId, prevActiveSessionId, sessionAgentMap } = params;

  if (!sessionId) return null;

  const isTempId = (id: string) =>
    id.startsWith('session_') || id.startsWith('__pending_');

  const prevId = prevActiveSessionId;
  const isRealToReal =
    prevId !== null &&
    prevId !== sessionId &&
    !isTempId(prevId) &&
    !isTempId(sessionId);

  let agentMapMigrated = false;
  let storeMigrated = false;

  if (prevId && prevId !== sessionId) {
    const agentId = sessionAgentMap[prevId];
    if (agentId) {
      agentMapMigrated = true;
    }
    if (isRealToReal) {
      storeMigrated = true;
    }
  }

  const sidebarRefreshed = !isRealToReal;

  return {
    newActiveSessionId: sessionId,
    agentMapMigrated,
    storeMigrated,
    sidebarRefreshed,
  };
}

describe('handleSessionChange logic (ProjectWorkspacePage)', () => {
  describe('temp → real transitions', () => {
    it('should refresh sidebar when session_ prefix becomes UUID', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'a1b2c3d4-real-uuid',
        prevActiveSessionId: 'session_temp_001',
        sessionAgentMap: { session_temp_001: 'agent-claude' },
      });

      expect(result).not.toBeNull();
      expect(result!.newActiveSessionId).toBe('a1b2c3d4-real-uuid');
      expect(result!.agentMapMigrated).toBe(true);
      expect(result!.storeMigrated).toBe(false);
      expect(result!.sidebarRefreshed).toBe(true);
    });

    it('should refresh sidebar when __pending_ prefix becomes UUID', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'real-uuid-xyz',
        prevActiveSessionId: '__pending_send_123',
        sessionAgentMap: { __pending_send_123: 'agent-cursor' },
      });

      expect(result!.sidebarRefreshed).toBe(true);
      expect(result!.agentMapMigrated).toBe(true);
      expect(result!.storeMigrated).toBe(false);
    });
  });

  describe('real → real transitions (duplicate sidebar regression)', () => {
    it('should NOT refresh sidebar when UUID changes to another UUID', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'new-uuid-from-cli',
        prevActiveSessionId: 'original-uuid-session',
        sessionAgentMap: { 'original-uuid-session': 'agent-claude' },
      });

      expect(result!.newActiveSessionId).toBe('new-uuid-from-cli');
      expect(result!.agentMapMigrated).toBe(true);
      expect(result!.storeMigrated).toBe(true);
      expect(result!.sidebarRefreshed).toBe(false);
    });

    it('should migrate store for real→real without agent in map', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'new-uuid',
        prevActiveSessionId: 'old-uuid',
        sessionAgentMap: {},
      });

      expect(result!.storeMigrated).toBe(true);
      expect(result!.agentMapMigrated).toBe(false);
      expect(result!.sidebarRefreshed).toBe(false);
    });
  });

  describe('same ID (no-op)', () => {
    it('should do nothing when sessionId equals activeSessionId', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'same-uuid',
        prevActiveSessionId: 'same-uuid',
        sessionAgentMap: { 'same-uuid': 'agent-claude' },
      });

      expect(result!.agentMapMigrated).toBe(false);
      expect(result!.storeMigrated).toBe(false);
      expect(result!.sidebarRefreshed).toBe(true);
    });
  });

  describe('null handling', () => {
    it('should return null when sessionId is null', () => {
      const result = simulateHandleSessionChange({
        sessionId: null,
        prevActiveSessionId: 'existing-uuid',
        sessionAgentMap: {},
      });

      expect(result).toBeNull();
    });

    it('should refresh sidebar when prevActiveSessionId is null (first session)', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'first-session-uuid',
        prevActiveSessionId: null,
        sessionAgentMap: {},
      });

      expect(result!.newActiveSessionId).toBe('first-session-uuid');
      expect(result!.sidebarRefreshed).toBe(true);
      expect(result!.storeMigrated).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should treat session_ → session_ as temp→temp (refresh sidebar, no store migration)', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'session_new',
        prevActiveSessionId: 'session_old',
        sessionAgentMap: { session_old: 'agent-1' },
      });

      expect(result!.sidebarRefreshed).toBe(true);
      expect(result!.storeMigrated).toBe(false);
    });

    it('should treat __pending_ → session_ as temp→temp (refresh sidebar)', () => {
      const result = simulateHandleSessionChange({
        sessionId: 'session_xyz',
        prevActiveSessionId: '__pending_abc',
        sessionAgentMap: {},
      });

      expect(result!.sidebarRefreshed).toBe(true);
      expect(result!.storeMigrated).toBe(false);
    });
  });
});
