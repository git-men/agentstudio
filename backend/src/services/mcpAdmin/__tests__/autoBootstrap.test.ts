/**
 * MCP Admin Auto-Bootstrap Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const TEST_HOME = vi.hoisted(() => {
  const _path = require('path');
  const _os = require('os');
  const home = _path.join(_os.tmpdir(), 'mcp-admin-bootstrap-test-' + Date.now());
  delete process.env.DATA_DIR;
  process.env.AGENTSTUDIO_HOME = home;
  return home;
});

vi.mock('proper-lockfile', () => ({
  default: {
    lock: async () => async () => {},
  },
}));

import { autoBootstrapMcpAdmin, getSystemMcpServers } from '../autoBootstrap.js';
import { listAdminApiKeys } from '../adminApiKeyService.js';
import { MCP_SERVER_CONFIG_FILE } from '../../../config/paths.js';

describe('autoBootstrapMcpAdmin', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await fs.mkdir(path.dirname(MCP_SERVER_CONFIG_FILE), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should create admin key and MCP config on first run', async () => {
    await autoBootstrapMcpAdmin(4936);

    const keys = await listAdminApiKeys();
    const activeKeys = keys.filter(k => !k.revokedAt);
    expect(activeKeys.length).toBe(1);
    expect(activeKeys[0].description).toContain('Auto-Bootstrap');

    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
    expect(config.mcpServers['agentstudio-admin'].type).toBe('http');
    expect(config.mcpServers['agentstudio-admin'].url).toBe('http://localhost:4936/api/mcp-admin');
    expect(config.mcpServers['agentstudio-admin'].headers.Authorization).toMatch(/^Bearer ask_/);
  });

  it('should be idempotent — second run does not duplicate key', async () => {
    await autoBootstrapMcpAdmin(4936);
    await autoBootstrapMcpAdmin(4936);

    const keys = await listAdminApiKeys();
    const activeKeys = keys.filter(k => !k.revokedAt);
    expect(activeKeys.length).toBe(1);
  });

  it('should update URL when port changes', async () => {
    await autoBootstrapMcpAdmin(4936);

    let config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin'].url).toBe('http://localhost:4936/api/mcp-admin');

    await autoBootstrapMcpAdmin(5000);

    config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin'].url).toBe('http://localhost:5000/api/mcp-admin');
  });

  it('should preserve existing MCP servers in config', async () => {
    const existingConfig = {
      mcpServers: {
        'my-custom-mcp': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          source: 'local',
        },
      },
    };
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify(existingConfig, null, 2));

    await autoBootstrapMcpAdmin(4936);

    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['my-custom-mcp']).toBeDefined();
    expect(config.mcpServers['my-custom-mcp'].command).toBe('node');
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
  });

  it('should create backup when config file exists but has corrupted JSON', async () => {
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, '{ corrupted json !!!');

    await autoBootstrapMcpAdmin(4936);

    // Backup should be created
    expect(fsSync.existsSync(MCP_SERVER_CONFIG_FILE + '.bak')).toBe(true);
    const backup = fsSync.readFileSync(MCP_SERVER_CONFIG_FILE + '.bak', 'utf-8');
    expect(backup).toBe('{ corrupted json !!!');

    // agentstudio-admin should still be written
    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
  });

  it('should create backup when config file has unexpected structure (no mcpServers)', async () => {
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify({ servers: { foo: {} } }));

    await autoBootstrapMcpAdmin(4936);

    expect(fsSync.existsSync(MCP_SERVER_CONFIG_FILE + '.bak')).toBe(true);
    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
  });

  it('should create backup when mcpServers is null', async () => {
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify({ mcpServers: null }));

    await autoBootstrapMcpAdmin(4936);

    expect(fsSync.existsSync(MCP_SERVER_CONFIG_FILE + '.bak')).toBe(true);
    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
  });

  it('should handle mcpServers being an array gracefully', async () => {
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify({ mcpServers: [] }));

    await autoBootstrapMcpAdmin(4936);

    expect(fsSync.existsSync(MCP_SERVER_CONFIG_FILE + '.bak')).toBe(true);
    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
    expect(Array.isArray(config.mcpServers)).toBe(false);
  });

  it('should preserve multiple existing MCP servers', async () => {
    const existingConfig = {
      mcpServers: {
        'supabase': { type: 'stdio', command: 'npx', args: ['supabase-mcp'], source: 'local' },
        'playwright': { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], source: 'local' },
        'custom-http': { type: 'http', url: 'http://localhost:9000/mcp', source: 'local' },
      },
    };
    fsSync.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify(existingConfig, null, 2));

    await autoBootstrapMcpAdmin(4936);

    const config = JSON.parse(fsSync.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    expect(Object.keys(config.mcpServers).length).toBe(4);
    expect(config.mcpServers['supabase']).toBeDefined();
    expect(config.mcpServers['playwright']).toBeDefined();
    expect(config.mcpServers['custom-http']).toBeDefined();
    expect(config.mcpServers['agentstudio-admin']).toBeDefined();
  });
});

describe('getSystemMcpServers', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // ignore
    }
    await fs.mkdir(path.dirname(MCP_SERVER_CONFIG_FILE), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_HOME, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should return empty when no config exists', () => {
    const servers = getSystemMcpServers();
    expect(Object.keys(servers).length).toBe(0);
  });

  it('should return agentstudio-admin after bootstrap', async () => {
    await autoBootstrapMcpAdmin(4936);

    const servers = getSystemMcpServers();
    expect(servers['agentstudio-admin']).toBeDefined();
    expect(servers['agentstudio-admin'].url).toBe('http://localhost:4936/api/mcp-admin');
  });
});
