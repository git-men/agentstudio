/**
 * Session Concurrency Control Tests
 * 
 * Tests for preventing duplicate requests to the same session.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../sessionManager.js';
import { ClaudeSession } from '../claudeSession.js';

// Mock the claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(() => {
    const mockGenerator = (async function* () {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'mock-session-id-123'
      };
    })();
    
    (mockGenerator as any).interrupt = vi.fn();
    (mockGenerator as any).close = vi.fn();
    return mockGenerator;
  })
}));

describe('Session Concurrency Control', () => {
  let sessionManager: SessionManager;
  
  beforeEach(() => {
    sessionManager = new SessionManager();
  });
  
  afterEach(async () => {
    await sessionManager.shutdown();
  });

  describe('ClaudeSession.isCurrentlyProcessing', () => {
    it('should return false initially', () => {
      const mockOptions = {
        systemPrompt: 'test prompt',
        allowedTools: [],
        maxTurns: 10,
        cwd: '/test/path'
      };
      
      const session = new ClaudeSession('test-agent', mockOptions);
      expect(session.isCurrentlyProcessing()).toBe(false);
    });
  });

  describe('SessionManager.isSessionBusy', () => {
    it('should return false for non-existent session', () => {
      const isBusy = sessionManager.isSessionBusy('non-existent-session');
      expect(isBusy).toBe(false);
    });

    it('should return false for idle session', async () => {
      const mockOptions = {
        systemPrompt: 'test prompt',
        allowedTools: [],
        maxTurns: 10,
        cwd: '/test/path'
      };
      
      const session = await sessionManager.createNewSession('test-agent', mockOptions, 'test-session-id');
      
      const isBusy = sessionManager.isSessionBusy('test-session-id');
      expect(isBusy).toBe(false);
    });
  });

  describe('ClaudeSession.sendMessage concurrency', () => {
    it('should throw error when session is already processing', async () => {
      const mockOptions = {
        systemPrompt: 'test prompt',
        allowedTools: [],
        maxTurns: 10,
        cwd: '/test/path'
      };
      
      const session = new ClaudeSession('test-agent', mockOptions);
      
      // First call should succeed
      const callback1 = vi.fn();
      await session.sendMessage({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] } }, callback1);
      
      // Session should now be processing
      expect(session.isCurrentlyProcessing()).toBe(true);
      
      // Second call should throw
      const callback2 = vi.fn();
      await expect(
        session.sendMessage({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'World' }] } }, callback2)
      ).rejects.toThrow('Session is busy processing another request');
      
      // First callback should have been registered, second should not
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe('SessionManager session lifecycle', () => {
    it('should track sessions correctly', async () => {
      const mockOptions = {
        systemPrompt: 'test prompt',
        allowedTools: [],
        maxTurns: 10,
        cwd: '/test/path'
      };
      
      const session = await sessionManager.createNewSession('test-agent', mockOptions, 'session-123');
      
      const retrieved = sessionManager.getSession('session-123');
      expect(retrieved).toBe(session);
      
      expect(sessionManager.hasActiveSession('session-123')).toBe(true);
    });

    it('should return null for unknown session', () => {
      const session = sessionManager.getSession('unknown-session');
      expect(session).toBeNull();
    });
  });
});
