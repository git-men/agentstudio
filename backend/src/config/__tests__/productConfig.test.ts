import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveModule,
  FEATURE_MODULES,
  initializeProduct,
  getModuleAccess,
  getProductEdition,
  isModuleEnabled,
  isModuleWritable,
  isFrontendPathEnabled,
  getProductInfo,
  _resetProductConfig,
} from '../productConfig.js';

afterEach(() => {
  _resetProductConfig();
  delete process.env.PRODUCT_EDITION;
});

// =============================================================================
// 1. resolveModule — Route-to-Module Mapping
// =============================================================================

describe('resolveModule', () => {
  describe('core modules', () => {
    it.each([
      ['/api/agents/chat', 'core.chat'],
      ['/api/agents/chat/some-extra', 'core.chat'],
      ['/api/agents/user-response', 'core.chat'],
      ['/api/agui/chat', 'core.chat'],
      ['/api/agui/sessions/abc/interrupt', 'core.chat'],
      ['/api/agui/engines/cursor', 'core.chat'],
      ['/api/sessions/agent-1', 'core.sessions'],
      ['/api/sessions/agent-1/session-1/messages', 'core.sessions'],
      ['/api/agents/sessions/sess-1/interrupt', 'core.sessions'],
      ['/api/files/read', 'core.files'],
      ['/api/files/read-multiple', 'core.files'],
      ['/api/files/write', 'core.files'],
      ['/api/media/image.png', 'core.files'],
      ['/media/some-file', 'core.files'],
    ])('resolves %s → %s', (path, expected) => {
      expect(resolveModule(path)).toBe(expected);
    });
  });

  describe('management modules', () => {
    it.each([
      ['/api/agents', 'manage.agents'],
      ['/api/agents/agent-1', 'manage.agents'],
      ['/api/projects', 'manage.projects'],
      ['/api/projects/proj-1', 'manage.projects'],
      ['/api/mcp/servers', 'manage.mcp'],
    ])('resolves %s → %s', (path, expected) => {
      expect(resolveModule(path)).toBe(expected);
    });
  });

  describe('extension modules', () => {
    it.each([
      ['/api/commands', 'extend.commands'],
      ['/api/subagents', 'extend.subagents'],
      ['/api/skills', 'extend.skills'],
      ['/api/plugins', 'extend.plugins'],
      ['/api/marketplace-skills', 'extend.marketplace-skills'],
      ['/api/marketplace-skills/toggle', 'extend.marketplace-skills'],
      ['/api/marketplace-skills/batch', 'extend.marketplace-skills'],
      ['/api/rules', 'extend.rules'],
      ['/api/hooks', 'extend.hooks'],
    ])('resolves %s → %s', (path, expected) => {
      expect(resolveModule(path)).toBe(expected);
    });
  });

  describe('system modules', () => {
    it.each([
      ['/api/settings', 'system.settings'],
      ['/api/config', 'system.settings'],
      ['/api/scheduled-tasks', 'system.scheduler'],
      ['/api/tunnel', 'system.tunnel'],
      ['/api/a2a', 'system.a2a'],
      ['/api/a2a/history/proj/sess', 'system.a2a'],
      ['/a2a/.well-known/agent.json', 'system.a2a'],
      ['/api/mcp-admin', 'system.mcp-admin'],
      ['/api/version', 'system.versions'],
      ['/api/speech-to-text', 'system.voice'],
      ['/api/slack', 'system.integrations'],
    ])('resolves %s → %s', (path, expected) => {
      expect(resolveModule(path)).toBe(expected);
    });
  });

  describe('wildcard pattern matching', () => {
    it('matches /api/projects/*/versions with any projectId', () => {
      expect(resolveModule('/api/projects/proj-123/versions')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-123/versions/status')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-123/versions/tag')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-123/versions/checkout')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-123/versions/rollback')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-123/versions/commit')).toBe('system.versions');
    });

    it('matches /api/projects/*/a2a-config to system.a2a', () => {
      expect(resolveModule('/api/projects/proj-1/a2a-config')).toBe('system.a2a');
    });

    it('matches /api/projects/*/api-keys to system.a2a', () => {
      expect(resolveModule('/api/projects/proj-1/api-keys')).toBe('system.a2a');
    });
  });

  describe('specificity ordering', () => {
    it('prefers /api/projects/*/versions (4 segments) over /api/projects (2 segments)', () => {
      expect(resolveModule('/api/projects/proj-1/versions')).toBe('system.versions');
      expect(resolveModule('/api/projects/proj-1')).toBe('manage.projects');
    });

    it('prefers /api/agents/chat (3 segments) over /api/agents (2 segments)', () => {
      expect(resolveModule('/api/agents/chat')).toBe('core.chat');
      expect(resolveModule('/api/agents')).toBe('manage.agents');
    });

    it('prefers /api/agents/sessions (3 segments) over /api/agents (2 segments)', () => {
      expect(resolveModule('/api/agents/sessions/s1/interrupt')).toBe('core.sessions');
    });

    it('prefers /api/agents/user-response over /api/agents', () => {
      expect(resolveModule('/api/agents/user-response')).toBe('core.chat');
    });
  });

  describe('infrastructure routes (no module match)', () => {
    it.each([
      '/api/engine',
      '/api/auth',
      '/api/health',
      '/api/games/publish',
      '/api/unknown-route',
    ])('returns null for %s', (path) => {
      expect(resolveModule(path)).toBeNull();
    });
  });
});

// =============================================================================
// 2. Edition Presets
// =============================================================================

describe('edition presets', () => {
  describe('full edition', () => {
    beforeEach(() => {
      process.env.PRODUCT_EDITION = 'full';
      initializeProduct();
    });

    it('sets edition to full', () => {
      expect(getProductEdition()).toBe('full');
    });

    it('enables all modules with full access', () => {
      for (const mod of FEATURE_MODULES) {
        expect(getModuleAccess(mod.id)).toBe('full');
        expect(isModuleEnabled(mod.id)).toBe(true);
        expect(isModuleWritable(mod.id)).toBe(true);
      }
    });
  });

  describe('chat-only edition', () => {
    beforeEach(() => {
      process.env.PRODUCT_EDITION = 'chat-only';
      initializeProduct();
    });

    it('sets edition to chat-only', () => {
      expect(getProductEdition()).toBe('chat-only');
    });

    it('enables core.chat with full access', () => {
      expect(getModuleAccess('core.chat')).toBe('full');
    });

    it('enables core.sessions with full access', () => {
      expect(getModuleAccess('core.sessions')).toBe('full');
    });

    it('disables core.files', () => {
      expect(getModuleAccess('core.files')).toBe('disabled');
      expect(isModuleEnabled('core.files')).toBe(false);
    });

    it('sets manage.agents to readonly', () => {
      expect(getModuleAccess('manage.agents')).toBe('readonly');
      expect(isModuleEnabled('manage.agents')).toBe(true);
      expect(isModuleWritable('manage.agents')).toBe(false);
    });

    it('sets manage.projects to readonly', () => {
      expect(getModuleAccess('manage.projects')).toBe('readonly');
      expect(isModuleEnabled('manage.projects')).toBe(true);
      expect(isModuleWritable('manage.projects')).toBe(false);
    });

    it('enables system.versions with full access', () => {
      expect(getModuleAccess('system.versions')).toBe('full');
    });

    it('enables extend.marketplace-skills with full access', () => {
      expect(getModuleAccess('extend.marketplace-skills')).toBe('full');
    });

    it('sets system.a2a to readonly', () => {
      expect(getModuleAccess('system.a2a')).toBe('readonly');
      expect(isModuleEnabled('system.a2a')).toBe(true);
      expect(isModuleWritable('system.a2a')).toBe(false);
    });

    it('disables all management UI modules', () => {
      expect(getModuleAccess('manage.dashboard')).toBe('disabled');
      expect(getModuleAccess('manage.mcp')).toBe('disabled');
    });

    it('disables extension modules not needed for chat', () => {
      expect(getModuleAccess('extend.commands')).toBe('disabled');
      expect(getModuleAccess('extend.subagents')).toBe('disabled');
      expect(getModuleAccess('extend.skills')).toBe('disabled');
      expect(getModuleAccess('extend.plugins')).toBe('disabled');
      expect(getModuleAccess('extend.rules')).toBe('disabled');
      expect(getModuleAccess('extend.hooks')).toBe('disabled');
    });

    it('disables system modules not needed for chat', () => {
      expect(getModuleAccess('system.settings')).toBe('disabled');
      expect(getModuleAccess('system.scheduler')).toBe('disabled');
      expect(getModuleAccess('system.tunnel')).toBe('disabled');
      expect(getModuleAccess('system.mcp-admin')).toBe('disabled');
      expect(getModuleAccess('system.voice')).toBe('disabled');
      expect(getModuleAccess('system.integrations')).toBe('disabled');
    });
  });

  describe('lite edition', () => {
    beforeEach(() => {
      process.env.PRODUCT_EDITION = 'lite';
      initializeProduct();
    });

    it('sets edition to lite', () => {
      expect(getProductEdition()).toBe('lite');
    });

    it('enables all core modules with full access', () => {
      expect(getModuleAccess('core.chat')).toBe('full');
      expect(getModuleAccess('core.sessions')).toBe('full');
      expect(getModuleAccess('core.files')).toBe('full');
    });

    it('enables all management modules with full access', () => {
      expect(getModuleAccess('manage.dashboard')).toBe('full');
      expect(getModuleAccess('manage.agents')).toBe('full');
      expect(getModuleAccess('manage.projects')).toBe('full');
      expect(getModuleAccess('manage.mcp')).toBe('full');
    });

    it('selectively enables extensions', () => {
      expect(getModuleAccess('extend.commands')).toBe('full');
      expect(getModuleAccess('extend.rules')).toBe('full');
      expect(getModuleAccess('extend.plugins')).toBe('disabled');
      expect(getModuleAccess('extend.skills')).toBe('disabled');
    });

    it('sets system.versions to readonly', () => {
      expect(getModuleAccess('system.versions')).toBe('readonly');
    });

    it('disables heavy system modules', () => {
      expect(getModuleAccess('system.scheduler')).toBe('disabled');
      expect(getModuleAccess('system.tunnel')).toBe('disabled');
    });
  });

  describe('edition detection and aliases', () => {
    it('defaults to full when no env is set', () => {
      initializeProduct();
      expect(getProductEdition()).toBe('full');
    });

    it('falls back to full for invalid edition values', () => {
      process.env.PRODUCT_EDITION = 'nonsense';
      initializeProduct();
      expect(getProductEdition()).toBe('full');
    });
  });
});

// =============================================================================
// 3. Helper Functions
// =============================================================================

describe('helper functions', () => {
  describe('isFrontendPathEnabled', () => {
    beforeEach(() => {
      process.env.PRODUCT_EDITION = 'chat-only';
      initializeProduct();
    });

    it('enables /chat (core.chat is full)', () => {
      expect(isFrontendPathEnabled('/chat')).toBe(true);
    });

    it('disables /dashboard (manage.dashboard is disabled)', () => {
      expect(isFrontendPathEnabled('/dashboard')).toBe(false);
    });

    it('disables /plugins (extend.plugins is disabled)', () => {
      expect(isFrontendPathEnabled('/plugins')).toBe(false);
    });

    it('allows unknown paths (fail-open)', () => {
      expect(isFrontendPathEnabled('/unknown-page')).toBe(true);
    });

    it('enables /agents in readonly (isModuleEnabled checks full|readonly)', () => {
      expect(isFrontendPathEnabled('/agents')).toBe(true);
    });
  });

  describe('getProductInfo', () => {
    beforeEach(() => {
      process.env.PRODUCT_EDITION = 'chat-only';
      initializeProduct();
    });

    it('returns edition and module info', () => {
      const info = getProductInfo();
      expect(info.edition).toBe('chat-only');
      expect(info.name).toBe('Chat Edition');
      expect(info.modules['core.chat']).toBe('full');
      expect(info.modules['core.files']).toBe('disabled');
    });

    it('includes all feature modules in availableModules', () => {
      const info = getProductInfo();
      expect(info.availableModules.length).toBe(FEATURE_MODULES.length);
      const chatModule = info.availableModules.find(m => m.id === 'core.chat');
      expect(chatModule).toBeDefined();
      expect(chatModule!.access).toBe('full');
      expect(chatModule!.category).toBe('core');
    });
  });
});

// =============================================================================
// 4. VAG API Endpoint Validation
// =============================================================================

describe('VAG frontend API validation under chat-only', () => {
  beforeEach(() => {
    process.env.PRODUCT_EDITION = 'chat-only';
    initializeProduct();
  });

  /**
   * Every API endpoint used by the VAG frontend, mapped to expected module
   * and the HTTP method used. The test verifies that each endpoint resolves
   * to the correct module AND that the module's access level permits the
   * given HTTP method.
   */
  const vagEndpoints: Array<{
    method: 'GET' | 'POST';
    path: string;
    expectedModule: string | null;
  }> = [
    { method: 'GET',  path: '/api/sessions/agent-1',                           expectedModule: 'core.sessions' },
    { method: 'GET',  path: '/api/sessions/agent-1/sess-1/messages',           expectedModule: 'core.sessions' },
    { method: 'POST', path: '/api/agents/sessions/sess-1/interrupt',           expectedModule: 'core.sessions' },
    { method: 'POST', path: '/api/agui/sessions/sess-1/interrupt',             expectedModule: 'core.chat' },
    { method: 'POST', path: '/api/agents/chat',                                expectedModule: 'core.chat' },
    { method: 'POST', path: '/api/agui/chat',                                  expectedModule: 'core.chat' },
    { method: 'POST', path: '/api/agents/user-response',                       expectedModule: 'core.chat' },
    { method: 'GET',  path: '/api/engine',                                     expectedModule: null },
    { method: 'GET',  path: '/api/agui/engines/cursor',                        expectedModule: 'core.chat' },
    { method: 'GET',  path: '/api/projects/proj-1/versions',                   expectedModule: 'system.versions' },
    { method: 'GET',  path: '/api/projects/proj-1/versions/status',            expectedModule: 'system.versions' },
    { method: 'GET',  path: '/api/projects/proj-1/versions/commit',            expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/tag',               expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/checkout',          expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/rollback',          expectedModule: 'system.versions' },
    { method: 'GET',  path: '/api/marketplace-skills',                         expectedModule: 'extend.marketplace-skills' },
    { method: 'POST', path: '/api/marketplace-skills/toggle',                  expectedModule: 'extend.marketplace-skills' },
    { method: 'POST', path: '/api/marketplace-skills/batch',                   expectedModule: 'extend.marketplace-skills' },
    { method: 'GET',  path: '/api/a2a/history/some-project/sess-1',            expectedModule: 'system.a2a' },
  ];

  it.each(vagEndpoints)(
    '$method $path → module=$expectedModule should be accessible',
    ({ method, path, expectedModule }) => {
      const resolved = resolveModule(path);
      expect(resolved).toBe(expectedModule);

      if (resolved === null) {
        // Infrastructure route — always passes through
        return;
      }

      const access = getModuleAccess(resolved);
      if (access === 'full') {
        // All methods allowed
        return;
      }

      if (access === 'readonly') {
        expect(method).toBe('GET');
        return;
      }

      // If we get here, the module is disabled — test should fail
      throw new Error(
        `${method} ${path} resolves to "${resolved}" which has access="${access}" in chat-only. This endpoint would be blocked.`,
      );
    },
  );

  it('does NOT allow file operations', () => {
    expect(getModuleAccess('core.files')).toBe('disabled');
    expect(isModuleEnabled('core.files')).toBe(false);
  });

  it('does NOT allow dashboard access', () => {
    expect(isFrontendPathEnabled('/dashboard')).toBe(false);
  });

  it('does NOT allow settings access', () => {
    expect(isFrontendPathEnabled('/settings')).toBe(false);
  });
});
