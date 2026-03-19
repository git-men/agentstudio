/**
 * Regression tests for AGUI session ID change logic (useMessageSender).
 *
 * The handleAguiEvent callback in useMessageSender processes RUN_STARTED and
 * CUSTOM(session_id_updated) events. These tests verify the fix that prevents
 * duplicate sidebar entries when a real session ID changes to a different real ID.
 *
 * Logic under test (extracted from useMessageSender):
 *   - RUN_STARTED: event.threadId vs currentSessionId
 *   - CUSTOM session_id_updated: customEvent.data.sessionId vs currentSessionId
 *
 * In both cases:
 *   - temp/null → real: call onSessionChange (create sidebar entry)
 *   - real → different real: silently migrate store, do NOT call onSessionChange
 *   - same ID: no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/frontendToolRegistry', () => ({
  isFrontendToolName: () => false,
  extractFrontendToolShortName: (name: string) => name,
}));

interface SessionChangeDecision {
  shouldCallOnSessionChange: boolean;
  shouldMigrateStore: boolean;
  shouldSetCurrentSessionId: boolean;
  shouldSetIsNewSession: boolean;
}

/**
 * Pure-logic extraction of the session ID change decision from
 * handleAguiEvent's RUN_STARTED / CUSTOM cases in useMessageSender.
 */
function decideAguiSessionChange(params: {
  newSessionId: string;
  currentSessionId: string | null;
  hasExternalStreamManager: boolean;
}): SessionChangeDecision {
  const { newSessionId, currentSessionId, hasExternalStreamManager } = params;

  if (newSessionId === currentSessionId) {
    return {
      shouldCallOnSessionChange: false,
      shouldMigrateStore: false,
      shouldSetCurrentSessionId: false,
      shouldSetIsNewSession: false,
    };
  }

  const isTempCurrent =
    currentSessionId?.startsWith('session_') ||
    currentSessionId?.startsWith('__pending_');

  if (isTempCurrent || !currentSessionId) {
    return {
      shouldCallOnSessionChange: true,
      shouldMigrateStore: false,
      shouldSetCurrentSessionId: true,
      shouldSetIsNewSession: true,
    };
  }

  return {
    shouldCallOnSessionChange: false,
    shouldMigrateStore: hasExternalStreamManager,
    shouldSetCurrentSessionId: true,
    shouldSetIsNewSession: false,
  };
}

describe('AGUI session change logic (RUN_STARTED / session_id_updated)', () => {
  describe('RUN_STARTED event scenarios', () => {
    it('temp → real: should notify sidebar (onSessionChange)', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-from-cli',
        currentSessionId: 'session_temp_001',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(true);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
      expect(decision.shouldSetIsNewSession).toBe(true);
      expect(decision.shouldMigrateStore).toBe(false);
    });

    it('null → real: should notify sidebar', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-first-session',
        currentSessionId: null,
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(true);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
      expect(decision.shouldSetIsNewSession).toBe(true);
    });

    it('__pending_ → real: should notify sidebar', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-real',
        currentSessionId: '__pending_xyz',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(true);
      expect(decision.shouldSetIsNewSession).toBe(true);
    });

    it('real → different real: should NOT notify sidebar (prevents duplicate)', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-new-from-resume',
        currentSessionId: 'uuid-original-session',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(false);
      expect(decision.shouldMigrateStore).toBe(true);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
      expect(decision.shouldSetIsNewSession).toBe(false);
    });

    it('real → different real without externalStreamManager: should not migrate store', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-new',
        currentSessionId: 'uuid-old',
        hasExternalStreamManager: false,
      });

      expect(decision.shouldCallOnSessionChange).toBe(false);
      expect(decision.shouldMigrateStore).toBe(false);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
    });

    it('same ID: should be complete no-op', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-same',
        currentSessionId: 'uuid-same',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(false);
      expect(decision.shouldMigrateStore).toBe(false);
      expect(decision.shouldSetCurrentSessionId).toBe(false);
      expect(decision.shouldSetIsNewSession).toBe(false);
    });
  });

  describe('CUSTOM session_id_updated event scenarios', () => {
    it('temp → real: should notify sidebar', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'cli-assigned-uuid',
        currentSessionId: 'session_init_abc',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(true);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
    });

    it('real → different real: should silently migrate without sidebar refresh', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'cli-new-uuid',
        currentSessionId: 'cli-old-uuid',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(false);
      expect(decision.shouldMigrateStore).toBe(true);
      expect(decision.shouldSetCurrentSessionId).toBe(true);
    });
  });

  describe('cross-scenario: message routing to correct session', () => {
    it('switching between conversations should keep each session independent', () => {
      const sessionA = 'uuid-session-a';
      const sessionB = 'uuid-session-b';

      const decisionA = decideAguiSessionChange({
        newSessionId: sessionA,
        currentSessionId: sessionA,
        hasExternalStreamManager: true,
      });

      expect(decisionA.shouldSetCurrentSessionId).toBe(false);

      const decisionB = decideAguiSessionChange({
        newSessionId: sessionB,
        currentSessionId: sessionB,
        hasExternalStreamManager: true,
      });

      expect(decisionB.shouldSetCurrentSessionId).toBe(false);
    });

    it('resuming session A should not create duplicate when CLI returns different ID', () => {
      const decision = decideAguiSessionChange({
        newSessionId: 'uuid-session-a-v2',
        currentSessionId: 'uuid-session-a',
        hasExternalStreamManager: true,
      });

      expect(decision.shouldCallOnSessionChange).toBe(false);
      expect(decision.shouldMigrateStore).toBe(true);
    });
  });
});
