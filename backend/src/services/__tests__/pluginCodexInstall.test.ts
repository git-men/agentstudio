import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pluginCodexInstall } from '../pluginCodexInstall.js';
import type { ParsedPlugin, PluginComponent } from '../../types/plugins.js';

vi.mock('fs');
vi.mock('os');

const FAKE_HOME = '/fake/home';

function comp(type: PluginComponent['type'], name: string, p: string): PluginComponent {
  return { type, name, path: p, relativePath: name };
}

function makePlugin(overrides: Partial<ParsedPlugin> = {}): ParsedPlugin {
  return {
    manifest: { name: 'test-plugin', version: '1.0.0', engine: 'codex' } as any,
    components: {
      commands: [],
      agents: [],
      skills: [],
      hooks: [],
      mcpServers: [],
    },
    files: [],
    path: '/fake/marketplace/test-plugin',
    marketplaceName: 'test-market',
    pluginName: 'test-plugin',
    ...overrides,
  };
}

describe('pluginCodexInstall', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue(FAKE_HOME);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.symlinkSync).mockReturnValue(undefined);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createSymlinks()', () => {
    it('creates symlinks for commands', async () => {
      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'my-cmd', '/src/cmd.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/src/cmd.md',
        path.join(FAKE_HOME, '.codex', 'commands', 'my-cmd.md'),
      );
    });

    it('creates symlinks for agents', async () => {
      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [comp('agent', 'my-agent', '/src/agent.md')],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/src/agent.md',
        path.join(FAKE_HOME, '.codex', 'agents', 'my-agent.md'),
      );
    });

    it('creates symlinks for skills', async () => {
      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [],
          skills: [comp('skill', 'my-skill', '/src/skills/my-skill/index.md')],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/src/skills/my-skill',
        path.join(FAKE_HOME, '.codex', 'skills', 'marketplace', 'test-plugin', 'my-skill'),
      );
    });

    it('skips symlink creation if identical symlink already exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as any);
      vi.mocked(fs.readlinkSync as any).mockReturnValue('/src/cmd.md');

      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'my-cmd', '/src/cmd.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.symlinkSync).not.toHaveBeenCalled();
    });

    it('ensures directories are created', async () => {
      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'cmd1', '/src/cmd1.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });

  describe('removeSymlinks()', () => {
    it('removes command symlinks', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as any);

      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'my-cmd', '/src/cmd.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.removeSymlinks(plugin);

      expect(fs.unlinkSync).toHaveBeenCalledWith(
        path.join(FAKE_HOME, '.codex', 'commands', 'my-cmd.md'),
      );
    });

    it('does nothing if symlink does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'my-cmd', '/src/cmd.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      await pluginCodexInstall.removeSymlinks(plugin);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('TOML MCP server management', () => {
    it('merges MCP servers into config.toml with _installedBy marker', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (String(p).endsWith('mcp.json')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        if (String(p).endsWith('mcp.json')) {
          return JSON.stringify({
            mcpServers: {
              'my-server': { command: 'node', args: ['server.js'] },
            },
          });
        }
        return '';
      });

      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [comp('mcp', 'mcp-config', '/src/mcp.json')],
        },
      });

      await pluginCodexInstall.createSymlinks(plugin);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenPath = String(writeCall[0]);
      const writtenContent = String(writeCall[1]);
      expect(writtenPath).toContain('config.toml');
      expect(writtenContent).toContain('my-server');
      expect(writtenContent).toContain('marketplace:test-plugin');
    });

    it('removes MCP servers by _installedBy marker', async () => {
      const existingToml = [
        '[mcp_servers.my-server]',
        'command = "node"',
        'args = ["server.js"]',
        '_installedBy = "marketplace:test-plugin"',
        '',
        '[mcp_servers.keep-server]',
        'command = "python"',
        '_installedBy = "marketplace:other-plugin"',
      ].join('\n');

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(existingToml);

      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [comp('mcp', 'mcp-config', '/src/mcp.json')],
        },
      });

      await pluginCodexInstall.removeSymlinks(plugin);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenContent = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
      expect(writtenContent).not.toContain('my-server');
      expect(writtenContent).toContain('keep-server');
    });

    it('handles missing config.toml gracefully on removal', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [comp('mcp', 'mcp-config', '/src/mcp.json')],
        },
      });

      await expect(pluginCodexInstall.removeSymlinks(plugin)).resolves.not.toThrow();
    });

    it('handles malformed config.toml gracefully', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        if (String(p).endsWith('mcp.json')) return true;
        if (String(p).endsWith('config.toml')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        if (String(p).endsWith('mcp.json')) {
          return JSON.stringify({
            mcpServers: { 'srv': { command: 'test' } },
          });
        }
        if (String(p).endsWith('config.toml')) {
          return '{{invalid toml}}';
        }
        return '';
      });

      const plugin = makePlugin({
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [comp('mcp', 'mcp-config', '/src/mcp.json')],
        },
      });

      await expect(pluginCodexInstall.createSymlinks(plugin)).resolves.not.toThrow();
    });
  });

  describe('checkSymlinks()', () => {
    it('returns false when no components are installed', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const plugin = makePlugin();
      const result = await pluginCodexInstall.checkSymlinks(plugin);
      expect(result).toBe(false);
    });

    it('returns true when command symlink exists', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return String(p).includes('commands/my-cmd.md');
      });

      const plugin = makePlugin({
        components: {
          commands: [comp('command', 'my-cmd', '/src/cmd.md')],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: [],
        },
      });

      const result = await pluginCodexInstall.checkSymlinks(plugin);
      expect(result).toBe(true);
    });

    it('returns true when MCP server with matching marker exists in TOML', async () => {
      const existingToml = [
        '[mcp_servers.my-server]',
        'command = "node"',
        '_installedBy = "marketplace:test-plugin"',
      ].join('\n');

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return String(p).endsWith('config.toml');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(existingToml);

      const plugin = makePlugin();
      const result = await pluginCodexInstall.checkSymlinks(plugin);
      expect(result).toBe(true);
    });
  });
});
