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
      ['/api/agui/chat', 'core.agui'],
      ['/api/agui/sessions/abc/interrupt', 'core.agui'],
      ['/api/agui/engines/cursor', 'core.agui'],
      ['/api/agents/frontend-tool-result', 'core.agui'],
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

    it('matches /api/projects/*/a2a-config to manage.projects', () => {
      expect(resolveModule('/api/projects/proj-1/a2a-config')).toBe('manage.projects');
    });

    it('matches /api/projects/*/api-keys to manage.projects', () => {
      expect(resolveModule('/api/projects/proj-1/api-keys')).toBe('manage.projects');
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

    it('enables core.agui (needed for frontend-tool-result and AGUI chat)', () => {
      expect(getModuleAccess('core.agui')).toBe('full');
      expect(isModuleEnabled('core.agui')).toBe(true);
    });

    it('disables core.files', () => {
      expect(getModuleAccess('core.files')).toBe('disabled');
      expect(isModuleEnabled('core.files')).toBe(false);
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

    it('disables manage.agents (not in proxy whitelist)', () => {
      expect(getModuleAccess('manage.agents')).toBe('disabled');
      expect(isModuleEnabled('manage.agents')).toBe(false);
    });

    it('disables system.a2a (not in proxy whitelist)', () => {
      expect(getModuleAccess('system.a2a')).toBe('disabled');
      expect(isModuleEnabled('system.a2a')).toBe(false);
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

    it('disables /agents (manage.agents is disabled in chat-only)', () => {
      expect(isFrontendPathEnabled('/agents')).toBe(false);
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
   * Allowed endpoints — aligned with sandbox-proxy route-guard business whitelist.
   * Each endpoint resolves to a module that is enabled (full or readonly)
   * and the HTTP method is permitted by the access level.
   */
  const allowedEndpoints: Array<{
    method: 'GET' | 'POST';
    path: string;
    expectedModule: string | null;
  }> = [
    // core.chat (full) — /api/agents/chat, /api/agents/user-response
    { method: 'POST', path: '/api/agents/chat',                                expectedModule: 'core.chat' },
    { method: 'POST', path: '/api/agents/user-response',                       expectedModule: 'core.chat' },
    // core.sessions (full) — /api/agents/sessions/*, /api/sessions/*
    { method: 'GET',  path: '/api/sessions/agent-1',                           expectedModule: 'core.sessions' },
    { method: 'GET',  path: '/api/sessions/agent-1/sess-1/messages',           expectedModule: 'core.sessions' },
    { method: 'POST', path: '/api/agents/sessions/sess-1/interrupt',           expectedModule: 'core.sessions' },
    // manage.projects (readonly) — /api/projects/*
    { method: 'GET',  path: '/api/projects/proj-1',                            expectedModule: 'manage.projects' },
    { method: 'GET',  path: '/api/projects/proj-1/a2a-config',                 expectedModule: 'manage.projects' },
    { method: 'GET',  path: '/api/projects/proj-1/api-keys',                   expectedModule: 'manage.projects' },
    // system.versions (full) — /api/projects/*/versions
    { method: 'GET',  path: '/api/projects/proj-1/versions',                   expectedModule: 'system.versions' },
    { method: 'GET',  path: '/api/projects/proj-1/versions/status',            expectedModule: 'system.versions' },
    { method: 'GET',  path: '/api/projects/proj-1/versions/commit',            expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/tag',               expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/checkout',          expectedModule: 'system.versions' },
    { method: 'POST', path: '/api/projects/proj-1/versions/rollback',          expectedModule: 'system.versions' },
    // core.agui (full) — AGUI protocol and frontend tool results
    { method: 'POST', path: '/api/agui/chat',                                  expectedModule: 'core.agui' },
    { method: 'POST', path: '/api/agui/sessions/sess-1/interrupt',             expectedModule: 'core.agui' },
    { method: 'GET',  path: '/api/agui/engines/cursor',                        expectedModule: 'core.agui' },
    { method: 'POST', path: '/api/agents/frontend-tool-result',                expectedModule: 'core.agui' },
    // extend.marketplace-skills (full) — /api/marketplace-skills*
    { method: 'GET',  path: '/api/marketplace-skills',                         expectedModule: 'extend.marketplace-skills' },
    { method: 'POST', path: '/api/marketplace-skills/toggle',                  expectedModule: 'extend.marketplace-skills' },
    { method: 'POST', path: '/api/marketplace-skills/batch',                   expectedModule: 'extend.marketplace-skills' },
    // infrastructure (no module) — always passes through
    { method: 'GET',  path: '/api/engine',                                     expectedModule: null },
  ];

  it.each(allowedEndpoints)(
    'ALLOW $method $path → module=$expectedModule',
    ({ method, path, expectedModule }) => {
      const resolved = resolveModule(path);
      expect(resolved).toBe(expectedModule);

      if (resolved === null) return;

      const access = getModuleAccess(resolved);
      if (access === 'full') return;

      if (access === 'readonly') {
        expect(method).toBe('GET');
        return;
      }

      throw new Error(
        `${method} ${path} resolves to "${resolved}" which has access="${access}" in chat-only. This endpoint would be blocked.`,
      );
    },
  );

  /**
   * Blocked endpoints — not in proxy whitelist, must be denied by productGate.
   */
  const blockedEndpoints: Array<{
    method: 'GET' | 'POST';
    path: string;
    expectedModule: string;
  }> = [
    // manage.agents (disabled) — agent listing not in proxy whitelist
    { method: 'GET',  path: '/api/agents',                                     expectedModule: 'manage.agents' },
    { method: 'GET',  path: '/api/agents/agent-1',                             expectedModule: 'manage.agents' },
    // system.a2a (disabled) — /api/a2a/* not in proxy whitelist
    { method: 'GET',  path: '/api/a2a/history/some-project/sess-1',            expectedModule: 'system.a2a' },
    // core.files (disabled) — explicitly denied in proxy
    { method: 'GET',  path: '/api/files/read',                                 expectedModule: 'core.files' },
    { method: 'POST', path: '/api/files/write',                                expectedModule: 'core.files' },
  ];

  it.each(blockedEndpoints)(
    'BLOCK $method $path → module=$expectedModule (disabled)',
    ({ method, path, expectedModule }) => {
      const resolved = resolveModule(path);
      expect(resolved).toBe(expectedModule);
      expect(getModuleAccess(resolved!)).toBe('disabled');
    },
  );

  it('does NOT allow dashboard access', () => {
    expect(isFrontendPathEnabled('/dashboard')).toBe(false);
  });

  it('does NOT allow settings access', () => {
    expect(isFrontendPathEnabled('/settings')).toBe(false);
  });
});
