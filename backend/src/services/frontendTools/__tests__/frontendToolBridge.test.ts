import { describe, it, expect, beforeEach } from 'vitest';
import { frontendToolBridge } from '../frontendToolBridge.js';

describe('FrontendToolBridge', () => {
  beforeEach(() => {
    // Cancel any leftover pending calls from prior tests
    const stats = frontendToolBridge.getStats();
    if (stats.totalPending > 0) {
      frontendToolBridge.cancelBySession('test-session', 'cleanup');
      frontendToolBridge.cancelBySession('session-1', 'cleanup');
      frontendToolBridge.cancelBySession('session-2', 'cleanup');
    }
  });

  describe('waitForResult + submitResult', () => {
    it('resolves with the submitted result', async () => {
      const promise = frontendToolBridge.waitForResult(
        'tc-1', 'my_tool', 'session-1', 'agent-1', { question: 'hello' },
      );

      const submitResult = frontendToolBridge.submitResult('tc-1', '{"answer":"world"}', 'session-1', 'agent-1');
      expect(submitResult.success).toBe(true);

      const result = await promise;
      expect(result).toBe('{"answer":"world"}');
    });

    it('rejects duplicate toolCallId', async () => {
      const p1 = frontendToolBridge.waitForResult('tc-dup', 'tool1', 'session-1', 'agent-1', {});
      await expect(
        frontendToolBridge.waitForResult('tc-dup', 'tool1', 'session-1', 'agent-1', {}),
      ).rejects.toThrow('Duplicate toolCallId');

      frontendToolBridge.cancel('tc-dup');
      await p1.catch(() => {}); // drain
    });
  });

  describe('submitResult validation', () => {
    it('fails for non-existent toolCallId', () => {
      const result = frontendToolBridge.submitResult('ghost', 'value', 'session-1', 'agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('No pending tool call');
    });

    it('fails for session ID mismatch', async () => {
      const promise = frontendToolBridge.waitForResult('tc-sess', 'tool1', 'session-1', 'agent-1', {});

      const result = frontendToolBridge.submitResult('tc-sess', 'value', 'wrong-session', 'agent-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Session ID mismatch');

      frontendToolBridge.cancel('tc-sess');
      await promise.catch(() => {});
    });

    it('fails for agent ID mismatch', async () => {
      const promise = frontendToolBridge.waitForResult('tc-agent', 'tool1', 'session-1', 'agent-1', {});

      const result = frontendToolBridge.submitResult('tc-agent', 'value', 'session-1', 'wrong-agent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Agent ID mismatch');

      frontendToolBridge.cancel('tc-agent');
      await promise.catch(() => {});
    });
  });

  describe('cancel', () => {
    it('rejects the pending promise', async () => {
      const promise = frontendToolBridge.waitForResult('tc-cancel', 'tool1', 'session-1', 'agent-1', {});

      const ok = frontendToolBridge.cancel('tc-cancel', 'user cancelled');
      expect(ok).toBe(true);

      await expect(promise).rejects.toThrow('user cancelled');
    });

    it('returns false for non-existent toolCallId', () => {
      expect(frontendToolBridge.cancel('no-such')).toBe(false);
    });
  });

  describe('cancelBySession', () => {
    it('cancels all pending calls for a session', async () => {
      const p1 = frontendToolBridge.waitForResult('tc-s1', 'tool1', 'session-1', 'agent-1', {});
      const p2 = frontendToolBridge.waitForResult('tc-s2', 'tool2', 'session-1', 'agent-1', {});
      const p3 = frontendToolBridge.waitForResult('tc-s3', 'tool3', 'session-2', 'agent-1', {});

      const count = frontendToolBridge.cancelBySession('session-1', 'session ended');
      expect(count).toBe(2);

      await expect(p1).rejects.toThrow('session ended');
      await expect(p2).rejects.toThrow('session ended');

      // p3 should still be pending (different session)
      expect(frontendToolBridge.hasPending('tc-s3')).toBe(true);

      frontendToolBridge.cancel('tc-s3');
      await p3.catch(() => {});
    });
  });

  describe('updateSessionId', () => {
    it('migrates pending calls to the new session ID', async () => {
      const promise = frontendToolBridge.waitForResult('tc-migrate', 'tool1', 'old-session', 'agent-1', {});

      const count = frontendToolBridge.updateSessionId('old-session', 'new-session');
      expect(count).toBe(1);

      // Submit with new session ID should work
      const result = frontendToolBridge.submitResult('tc-migrate', '"ok"', 'new-session', 'agent-1');
      expect(result.success).toBe(true);

      const value = await promise;
      expect(value).toBe('"ok"');
    });
  });

  describe('getStats', () => {
    it('reports correct pending count', async () => {
      expect(frontendToolBridge.getStats().totalPending).toBe(0);

      const p = frontendToolBridge.waitForResult('tc-stats', 'tool1', 'session-1', 'agent-1', {});
      expect(frontendToolBridge.getStats().totalPending).toBe(1);

      frontendToolBridge.cancel('tc-stats');
      await p.catch(() => {});

      expect(frontendToolBridge.getStats().totalPending).toBe(0);
    });
  });
});
