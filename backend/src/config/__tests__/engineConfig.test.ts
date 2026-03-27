/**
 * Unit tests for engineConfig.ts
 * Focused on the claude-internal-sdk engine support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// We need to reset the module state between tests since engineConfig uses a singleton
let engineConfigModule: typeof import('../engineConfig.js');

describe('engineConfig', () => {
  const originalEnv = process.env;
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    delete process.env.ENGINE;
    delete process.env.AGENT_SDK;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  async function loadModule() {
    engineConfigModule = await import('../engineConfig.js');
    return engineConfigModule;
  }

  describe('claude-internal-sdk engine type', () => {
    it('should detect claude-internal-sdk from ENGINE env var', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-internal-sdk');
      expect(config.name).toBe('Claude Internal SDK');
    });

    it('should detect claude-internal-sdk from legacy AGENT_SDK=claude-internal', async () => {
      process.env.AGENT_SDK = 'claude-internal';
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-internal-sdk');
    });

    it('should resolve alias "claude-internal" to "claude-internal-sdk"', async () => {
      process.env.ENGINE = 'claude-internal';
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-internal-sdk');
    });

    it('should resolve alias "claude_internal" to "claude-internal-sdk"', async () => {
      process.env.ENGINE = 'claude_internal';
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-internal-sdk');
    });
  });

  describe('claude-internal-sdk paths', () => {
    it('should use ~/.claude-internal as base directory', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      const config = mod.initializeEngine();
      const home = os.homedir();

      expect(config.paths.userConfigDir).toBe(path.join(home, '.claude-internal'));
      expect(config.paths.projectsDataDir).toBe(path.join(home, '.claude-internal', 'projects'));
      expect(config.paths.mcpConfigPath).toBe(path.join(home, '.claude-internal', 'mcp.json'));
      expect(config.paths.rulesDir).toBe(path.join(home, '.claude-internal', 'rules'));
      expect(config.paths.commandsDir).toBe(path.join(home, '.claude-internal', 'commands'));
      expect(config.paths.agentsDir).toBe(path.join(home, '.claude-internal', 'agents'));
      expect(config.paths.skillsDir).toBe(path.join(home, '.claude-internal', 'skills'));
      expect(config.paths.hooksDir).toBe(path.join(home, '.claude-internal', 'hooks'));
      expect(config.paths.pluginsDir).toBe(path.join(home, '.claude-internal', 'plugins'));
    });

    it('should differ from claude-sdk paths', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      const internalConfig = mod.initializeEngine();

      // Reset for claude-sdk
      vi.resetModules();
      delete process.env.ENGINE;
      process.env.ENGINE = 'claude-sdk';
      const mod2 = await import('../engineConfig.js');
      const claudeConfig = mod2.initializeEngine();

      expect(internalConfig.paths.userConfigDir).not.toBe(claudeConfig.paths.userConfigDir);
      expect(internalConfig.paths.userConfigDir).toContain('.claude-internal');
      expect(claudeConfig.paths.userConfigDir).toContain('.claude');
      expect(claudeConfig.paths.userConfigDir).not.toContain('.claude-internal');
    });
  });

  describe('claude-internal-sdk capabilities', () => {
    it('should have identical capabilities to claude-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      const internalConfig = mod.initializeEngine();

      vi.resetModules();
      process.env.ENGINE = 'claude-sdk';
      const mod2 = await import('../engineConfig.js');
      const claudeConfig = mod2.initializeEngine();

      expect(internalConfig.capabilities).toEqual(claudeConfig.capabilities);
    });
  });

  describe('isClaudeEngine helper', () => {
    it('should return true for claude-sdk', async () => {
      process.env.ENGINE = 'claude-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.isClaudeEngine()).toBe(true);
    });

    it('should return true for claude-internal-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.isClaudeEngine()).toBe(true);
    });

    it('should return false for cursor-cli', async () => {
      process.env.ENGINE = 'cursor-cli';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.isClaudeEngine()).toBe(false);
    });
  });

  describe('isClaudeInternalEngine helper', () => {
    it('should return true for claude-internal-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.isClaudeInternalEngine()).toBe(true);
    });

    it('should return false for claude-sdk', async () => {
      process.env.ENGINE = 'claude-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.isClaudeInternalEngine()).toBe(false);
    });
  });

  describe('getSdkConfigPath', () => {
    it('should return ~/.claude.json for claude-sdk', async () => {
      process.env.ENGINE = 'claude-sdk';
      const mod = await loadModule();
      mod.initializeEngine();
      const home = os.homedir();

      expect(mod.getSdkConfigPath()).toBe(path.join(home, '.claude.json'));
    });

    it('should return ~/.claude-internal/.claude.json for claude-internal-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      mod.initializeEngine();
      const home = os.homedir();

      expect(mod.getSdkConfigPath()).toBe(path.join(home, '.claude-internal', '.claude.json'));
    });
  });

  describe('getClaudeCliName', () => {
    it('should return "claude" for claude-sdk', async () => {
      process.env.ENGINE = 'claude-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.getClaudeCliName()).toBe('claude');
    });

    it('should return "claude-internal" for claude-internal-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.getClaudeCliName()).toBe('claude-internal');
    });
  });

  describe('getSdkDirName backward compat', () => {
    it('should return ".claude-internal" for claude-internal-sdk', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.getSdkDirName()).toBe('.claude-internal');
    });

    it('should return ".claude" for claude-sdk', async () => {
      process.env.ENGINE = 'claude-sdk';
      const mod = await loadModule();
      mod.initializeEngine();

      expect(mod.getSdkDirName()).toBe('.claude');
    });
  });

  describe('default engine detection', () => {
    it('should default to claude-sdk when no env is set', async () => {
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-sdk');
    });

    it('should prioritize ENGINE over AGENT_SDK', async () => {
      process.env.ENGINE = 'claude-internal-sdk';
      process.env.AGENT_SDK = 'claude-code';
      const mod = await loadModule();
      const config = mod.initializeEngine();

      expect(config.engine).toBe('claude-internal-sdk');
    });
  });
});
