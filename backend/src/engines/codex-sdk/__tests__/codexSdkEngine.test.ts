import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexSdkEngine } from '../codexSdkEngine.js';

vi.mock('@openai/codex-sdk', () => {
  const mockEvents = async function* () {
    yield { type: 'thread.started', thread_id: 'thread-abc' };
    yield {
      type: 'item.started',
      item: { id: 'msg-1', type: 'agent_message' },
    };
    yield {
      type: 'item.updated',
      item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
    };
    yield {
      type: 'item.completed',
      item: { id: 'msg-1', type: 'agent_message', text: 'Hello' },
    };
    yield { type: 'turn.completed' };
  };

  class MockThread {
    async runStreamed() {
      return { events: mockEvents() };
    }
  }

  class Codex {
    startThread() {
      return new MockThread();
    }
    resumeThread() {
      return new MockThread();
    }
  }

  return { Codex };
});

vi.mock('../../utils/sessionUtils.js', () => ({
  saveImageToHiddenDir: vi.fn().mockReturnValue('.codex/images/image_1.png'),
}));

vi.mock('../codex/historyParser.js', () => ({
  readCodexHistorySession: vi.fn().mockResolvedValue(null),
  readCodexHistorySessions: vi.fn().mockResolvedValue([]),
}));

describe('CodexSdkEngine', () => {
  let engine: CodexSdkEngine;

  beforeEach(() => {
    engine = new CodexSdkEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('type and capabilities', () => {
    it('has engine type codex-sdk', () => {
      expect(engine.type).toBe('codex-sdk');
    });

    it('supports mcp, skills, vision, streaming, and thinking', () => {
      expect(engine.capabilities.mcp.supported).toBe(true);
      expect(engine.capabilities.skills.supported).toBe(true);
      expect(engine.capabilities.features.vision).toBe(true);
      expect(engine.capabilities.features.streaming).toBe(true);
      expect(engine.capabilities.features.thinking).toBe(true);
      expect(engine.capabilities.features.multiTurn).toBe(true);
    });

    it('does not support subagents', () => {
      expect(engine.capabilities.features.subagents).toBe(false);
    });
  });

  describe('sendMessage()', () => {
    it('creates a new thread and streams events', async () => {
      const events: unknown[] = [];
      const result = await engine.sendMessage(
        'hello',
        { type: 'codex-sdk', workspace: '/tmp/workspace' },
        (event) => events.push(event),
      );

      expect(result.sessionId).toBeDefined();
      expect(events.length).toBeGreaterThan(0);
      const types = events.map((e: any) => e.type);
      expect(types).toContain('RUN_STARTED');
      expect(types).toContain('TEXT_MESSAGE_START');
      expect(types).toContain('TEXT_MESSAGE_CONTENT');
      expect(types).toContain('TEXT_MESSAGE_END');
      expect(types).toContain('RUN_FINISHED');
    });

    it('resumes an existing thread when sessionId is provided', async () => {
      const events: unknown[] = [];
      const result = await engine.sendMessage(
        'continue',
        { type: 'codex-sdk', workspace: '/tmp/workspace', sessionId: 'existing-session' },
        (event) => events.push(event),
      );

      expect(result.sessionId).toBeDefined();
      const types = events.map((e: any) => e.type);
      expect(types).toContain('RUN_FINISHED');
    });

    it('tracks active session count during execution', async () => {
      expect(engine.getActiveSessionCount()).toBe(0);

      const promise = engine.sendMessage(
        'hello',
        { type: 'codex-sdk', workspace: '/tmp' },
        () => {},
      );

      await promise;
      expect(engine.getActiveSessionCount()).toBe(0);
    });
  });

  describe('interruptSession()', () => {
    it('throws when interrupting a non-existent session', async () => {
      await expect(engine.interruptSession('missing-session')).rejects.toThrow(
        'Session not found: missing-session',
      );
    });
  });

  describe('mapSandboxMode()', () => {
    it('maps plan to read-only', () => {
      expect(engine.mapSandboxMode('plan')).toBe('read-only');
    });

    it('maps bypassPermissions to danger-full-access', () => {
      expect(engine.mapSandboxMode('bypassPermissions')).toBe('danger-full-access');
    });

    it('maps default to workspace-write', () => {
      expect(engine.mapSandboxMode('default')).toBe('workspace-write');
    });

    it('maps acceptEdits to workspace-write', () => {
      expect(engine.mapSandboxMode('acceptEdits')).toBe('workspace-write');
    });

    it('maps undefined to workspace-write', () => {
      expect(engine.mapSandboxMode(undefined)).toBe('workspace-write');
    });
  });

  describe('buildInput()', () => {
    it('returns plain string when no images', () => {
      const input = engine.buildInput('hello', undefined, '/tmp');
      expect(input).toBe('hello');
    });

    it('returns plain string for empty images array', () => {
      const input = engine.buildInput('hello', [], '/tmp');
      expect(input).toBe('hello');
    });

    it('returns array of UserInput when images are provided', () => {
      const images = [
        { data: 'base64data', mediaType: 'image/png' },
      ];
      const input = engine.buildInput('hello', images as any, '/tmp');
      expect(Array.isArray(input)).toBe(true);
      const items = input as Array<{ type: string }>;
      expect(items).toHaveLength(2);
      expect(items[0].type).toBe('text');
      expect(items[1].type).toBe('local_image');
    });

    it('skips unsupported image types', () => {
      const images = [
        { data: 'base64data', mediaType: 'image/bmp' },
      ];
      const input = engine.buildInput('hello', images as any, '/tmp');
      expect(Array.isArray(input)).toBe(true);
      const items = input as Array<{ type: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('text');
    });
  });

  describe('getSupportedModels()', () => {
    it('returns fallback models when cache file does not exist', async () => {
      const models = await engine.getSupportedModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].id).toBeDefined();
      expect(models[0].name).toBeDefined();
    });

    it('returns cached models on second call', async () => {
      const models1 = await engine.getSupportedModels();
      const models2 = await engine.getSupportedModels();
      expect(models1).toEqual(models2);
    });
  });

  describe('getActiveSessionCount()', () => {
    it('returns 0 when no sessions are active', () => {
      expect(engine.getActiveSessionCount()).toBe(0);
    });
  });
});
