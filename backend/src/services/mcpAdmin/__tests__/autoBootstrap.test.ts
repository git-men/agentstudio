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
