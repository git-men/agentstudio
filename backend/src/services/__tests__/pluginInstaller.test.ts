/**
 * Unit tests for pluginInstaller.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { exec } from 'child_process';

// Mock modules
vi.mock('fs');
vi.mock('child_process');
vi.mock('../pluginPaths');
vi.mock('../pluginParser');
vi.mock('../pluginSymlink');
vi.mock('../pluginScanner');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PluginInstaller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addMarketplace', () => {
    it('should add a git marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(exec).mockImplementation((cmd: any, callback?: any) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue(['plugin1', 'plugin2']);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'test-market',
        type: 'git',
        source: 'https://github.com/test/repo.git',
        branch: 'main'
      });

      expect(result.success).toBe(true);
      expect(result.pluginCount).toBe(2);
    });

    it('should add a github marketplace with shorthand', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(exec).mockImplementation((cmd: any, callback?: any) => {
        expect(cmd).toContain('https://github.com/test/repo.git');
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue([]);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'test-market',
        type: 'github',
        source: 'test/repo'
      });

      expect(result.success).toBe(true);
    });

    it('should add a local marketplace', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return !pathStr.includes('marketplaces/test-market');
      });
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      vi.mocked(fs.copyFileSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue([]);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'test-market',
        type: 'local',
        source: '/local/path/to/marketplace'
      });

      expect(result.success).toBe(true);
    });

    it('should fail if marketplace already exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'test-market',
        type: 'local',
        source: '/local/path'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('syncMarketplace', () => {
    it('should sync a git marketplace', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return p.toString().includes('.git') || !p.toString().includes('nonexistent');
      });
      vi.mocked(exec).mockImplementation((cmd: any, options: any, callback?: any) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue(['plugin1']);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.syncMarketplace('test-market');

      expect(result.success).toBe(true);
      expect(result.pluginCount).toBe(1);
    });

    it('should fail to sync non-git marketplace', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return !p.toString().includes('.git');
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.syncMarketplace('test-market');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a git repository');
    });
  });

  describe('installPlugin', () => {
    it('should install a valid plugin', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/path',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      const mockInstalledPlugin = {
        id: 'test-plugin@test-market',
        name: 'test-plugin',
        version: '1.0.0',
        marketplace: 'test-market',
        marketplaceName: 'test-market',
        enabled: true,
        installedAt: new Date().toISOString(),
        manifest: mockParsedPlugin.manifest,
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        installPath: '/test/path',
        symlinkCreated: true
      };

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.pluginExists).mockReturnValue(true);
      vi.mocked(pluginPaths.getPluginPath).mockReturnValue('/test/path');

      const { pluginParser } = await import('../pluginParser');
      vi.mocked(pluginParser.parsePlugin).mockResolvedValue(mockParsedPlugin as any);
      vi.mocked(pluginParser.validatePlugin).mockResolvedValue({ valid: true, errors: [] });

      const { pluginSymlink } = await import('../pluginSymlink');
      vi.mocked(pluginSymlink.createSymlinks).mockResolvedValue(undefined);

      const { pluginScanner } = await import('../pluginScanner');
      vi.mocked(pluginScanner.scanPlugin).mockResolvedValue(mockInstalledPlugin as any);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.installPlugin({
        pluginName: 'test-plugin',
        marketplaceName: 'test-market',
        marketplaceId: 'test-market'
      });

      expect(result.success).toBe(true);
      expect(result.plugin?.name).toBe('test-plugin');
    });

    it('should fail to install non-existent plugin', async () => {
      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.pluginExists).mockReturnValue(false);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.installPlugin({
        pluginName: 'nonexistent',
        marketplaceName: 'test-market',
        marketplaceId: 'test-market'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail to install invalid plugin', async () => {
      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.pluginExists).mockReturnValue(true);
      vi.mocked(pluginPaths.getPluginPath).mockReturnValue('/test/path');

      const { pluginParser } = await import('../pluginParser');
      vi.mocked(pluginParser.parsePlugin).mockResolvedValue({} as any);
      vi.mocked(pluginParser.validatePlugin).mockResolvedValue({
        valid: false,
        errors: ['Missing required field: name']
      });

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.installPlugin({
        pluginName: 'invalid-plugin',
        marketplaceName: 'test-market',
        marketplaceId: 'test-market'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('validation failed');
    });
  });

  describe('uninstallPlugin', () => {
    it('should uninstall a plugin', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/path',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getPluginPath).mockReturnValue('/test/path');

      const { pluginParser } = await import('../pluginParser');
      vi.mocked(pluginParser.parsePlugin).mockResolvedValue(mockParsedPlugin as any);

      const { pluginSymlink } = await import('../pluginSymlink');
      vi.mocked(pluginSymlink.removeSymlinks).mockResolvedValue(undefined);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.uninstallPlugin('test-plugin', 'test-market');

      expect(result).toBe(true);
    });

    it('should return false for non-existent plugin', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getPluginPath).mockReturnValue('/test/path');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.uninstallPlugin('nonexistent', 'test-market');

      expect(result).toBe(false);
    });
  });

  describe('addMarketplace - COS type', () => {
    it('should add a COS marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      
      // Mock fetch for archive download
      const mockResponse = {
        ok: true,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('mock archive content');
          }
        }
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      // Mock exec for tar extraction
      vi.mocked(exec).mockImplementation((cmd: any, callback?: any) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/cos-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue(['plugin1']);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'cos-market',
        type: 'cos',
        source: 'https://bucket.cos.region.myqcloud.com/marketplace.tar.gz'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('addMarketplace - Archive type', () => {
    it('should add an archive marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.readdirSync).mockReturnValue(['single-dir'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
      vi.mocked(fs.renameSync).mockReturnValue(undefined);
      vi.mocked(fs.rmdirSync).mockReturnValue(undefined);
      vi.mocked(fs.rmSync).mockReturnValue(undefined);
      
      // Mock fetch for archive download
      const mockResponse = {
        ok: true,
        body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('mock archive content');
          }
        }
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      // Mock exec for tar extraction
      vi.mocked(exec).mockImplementation((cmd: any, callback?: any) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/archive-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue([]);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'archive-market',
        type: 'archive',
        source: 'https://example.com/marketplace.tar.gz'
      });

      expect(result.success).toBe(true);
    });

    it('should fail if archive download fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.rmSync).mockReturnValue(undefined);
      
      // Mock fetch to return error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/failed-market');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'failed-market',
        type: 'archive',
        source: 'https://example.com/nonexistent.tar.gz'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to download');
    });
  });

  describe('checkForUpdates', () => {
    it('should check for updates in a git marketplace', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return pathStr.includes('.git') || pathStr.includes('marketplace');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: 'test-market',
        version: '1.0.0'
      }));
      
      vi.mocked(exec).mockImplementation((cmd: any, options: any, callback?: any) => {
        const cb = typeof options === 'function' ? options : callback;
        // Simulate "behind" status
        if (cmd.includes('git status')) {
          cb(null, 'Your branch is behind', '');
        } else {
          cb(null, '', '');
        }
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.checkForUpdates('test-market');

      expect(result.marketplaceId).toBe('test-market');
      expect(result.hasUpdate).toBe(true);
    });

    it('should report no update when up to date', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return pathStr.includes('.git') || pathStr.includes('marketplace');
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        name: 'test-market',
        version: '1.0.0'
      }));
      
      vi.mocked(exec).mockImplementation((cmd: any, options: any, callback?: any) => {
        const cb = typeof options === 'function' ? options : callback;
        // Simulate up-to-date status
        cb(null, 'Your branch is up to date', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.checkForUpdates('test-market');

      expect(result.hasUpdate).toBe(false);
    });
  });

  describe('addMarketplace with autoUpdate config', () => {
    it('should save autoUpdate configuration', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(exec).mockImplementation((cmd: any, callback?: any) => {
        if (callback) callback(null, '', '');
        return {} as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/auto-update-market');
      vi.mocked(pluginPaths.listPlugins).mockReturnValue([]);

      const { pluginInstaller } = await import('../pluginInstaller');
      
      const result = await pluginInstaller.addMarketplace({
        name: 'auto-update-market',
        type: 'github',
        source: 'test/repo',
        autoUpdate: {
          enabled: true,
          checkInterval: 30
        }
      });

      expect(result.success).toBe(true);
      
      // Verify metadata was saved with autoUpdate config
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.agentstudio-metadata.json'),
        expect.stringContaining('"autoUpdate"')
      );
    });
  });
});

