/**
 * Unit tests for pluginSymlink.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';

/** Helper: make lstatSync throw ENOENT (simulates path does not exist) */
function mockLstatEnoent() {
  vi.mocked(fs.lstatSync).mockImplementation((() => {
    const err: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
    err.code = 'ENOENT';
    throw err;
  }) as any);
}

/** Helper: make lstatSync return a Stats-like object for a symlink */
function mockLstatSymlink(target?: string) {
  vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as any);
  if (target !== undefined) {
    vi.mocked(fs.readlinkSync).mockReturnValue(target as any);
  }
}

/** Helper: make lstatSync return a Stats-like object for a regular file */
function mockLstatFile() {
  vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as any);
}

// Mock modules
vi.mock('fs');
vi.mock('../pluginPaths');

vi.mock('../../config/engineConfig', () => ({
  getEnginePaths: vi.fn(() => ({
    userConfigDir: '/test/.claude',
    commandsDir: '/test/.claude/commands',
    agentsDir: '/test/.claude/agents',
    skillsDir: '/test/.claude/skills',
    hooksDir: '/test/.claude/hooks',
    mcpConfigPath: '/test/.claude/mcp.json',
    mcpDir: '/test/.claude/mcp',
    rulesDir: '/test/.claude/rules',
    pluginsDir: '/test/.claude/plugins',
    projectsDataDir: '/test/.claude/projects',
  })),
  getClaudeMirrorPaths: vi.fn(() => []),
}));

describe('PluginSymlink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSymlinks', () => {
    it('should create symlinks for commands', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      mockLstatEnoent(); // path does not exist
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.createSymlinks(mockParsedPlugin);

      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/test/plugins/test-plugin/commands/hello.md',
        '/test/.claude/commands/hello.md'
      );
    });

    it('should create symlinks for skills', async () => {
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
          skills: [{
            type: 'skill' as const,
            name: 'my-skill',
            path: '/test/plugins/test-plugin/skills/my-skill/SKILL.md',
            relativePath: 'skills/my-skill/SKILL.md'
          }],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      mockLstatEnoent(); // path does not exist
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getSkillsDir).mockReturnValue('/test/.claude/skills');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.createSymlinks(mockParsedPlugin);

      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/test/plugins/test-plugin/skills/my-skill',
        '/test/.claude/skills/my-skill'
      );
    });

    it('should not create symlink if it already exists and points to correct target', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      mockLstatSymlink('/test/plugins/test-plugin/commands/hello.md');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.createSymlinks(mockParsedPlugin);

      // Should not call symlinkSync since link already exists and points to correct target
      expect(fs.symlinkSync).not.toHaveBeenCalled();
    });

    it('should replace existing symlink if it points to different target', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      mockLstatSymlink('/old/path/hello.md');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.createSymlinks(mockParsedPlugin);

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(fs.symlinkSync).toHaveBeenCalled();
    });

    it('should handle dangling symlink (symlink exists but target does not) without EEXIST error', async () => {
      // Regression test: the old code used existsSync which returns false for dangling symlinks,
      // causing it to skip the lstat check and call symlinkSync directly → EEXIST.
      // The new code uses lstatSync which detects the symlink inode regardless of target existence.
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      // Dangling symlink: lstatSync succeeds (inode exists) but target is gone
      // existsSync would return false in this scenario — not used in new code
      mockLstatSymlink('/some/now-missing-target.md');
      vi.mocked(fs.existsSync).mockReturnValue(false); // dangling: target not accessible
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      // Should not throw EEXIST — should remove the dangling symlink and re-create it
      await expect(pluginSymlink.createSymlinks(mockParsedPlugin)).resolves.not.toThrow();

      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/.claude/commands/hello.md');
      expect(fs.symlinkSync).toHaveBeenCalledWith(
        '/test/plugins/test-plugin/commands/hello.md',
        '/test/.claude/commands/hello.md'
      );
    });

    it('should silently ignore EEXIST from symlinkSync (race condition guard)', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      mockLstatEnoent(); // path appears not to exist
      vi.mocked(fs.existsSync).mockReturnValue(false);
      // symlinkSync throws EEXIST (race: another process created it concurrently)
      vi.mocked(fs.symlinkSync).mockImplementation(() => {
        const err: NodeJS.ErrnoException = new Error('EEXIST: file already exists');
        err.code = 'EEXIST';
        throw err;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      // Should not throw — EEXIST is caught as idempotent
      await expect(pluginSymlink.createSymlinks(mockParsedPlugin)).resolves.not.toThrow();
    });
  });

  describe('removeSymlinks', () => {
    it('should remove symlinks for commands', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => true } as any);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.removeSymlinks(mockParsedPlugin);

      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should not remove non-symlink files', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockLstatFile();

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await pluginSymlink.removeSymlinks(mockParsedPlugin);

      // Should not call unlinkSync for non-symlink files
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('should remove dangling symlink (symlink exists but target does not)', async () => {
      // Regression test: the old code used existsSync which returns false for dangling symlinks
      // (target does not exist), causing the path to be skipped and the dangling symlink to
      // persist. The new code uses lstatSync which detects the symlink inode regardless of
      // whether the target exists.
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      // Dangling symlink: lstatSync succeeds (inode exists) but target is gone.
      // existsSync would return false in this scenario — not used in new code.
      const mockLstatStats = { isSymbolicLink: () => true } as fs.Stats;
      vi.mocked(fs.lstatSync).mockReturnValueOnce(mockLstatStats);
      vi.mocked(fs.existsSync).mockReturnValue(false); // dangling: target not accessible
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');

      await expect(pluginSymlink.removeSymlinks(mockParsedPlugin)).resolves.not.toThrow();
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('hello.md')
      );
    });
  });

  describe('checkSymlinks', () => {
    it('should return true if symlinks exist', async () => {
      const mockParsedPlugin = {
        manifest: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test',
          author: { name: 'Test' }
        },
        components: {
          commands: [{
            type: 'command' as const,
            name: 'hello',
            path: '/test/plugins/test-plugin/commands/hello.md',
            relativePath: 'commands/hello.md'
          }],
          agents: [],
          skills: [],
          hooks: [],
          mcpServers: []
        },
        files: [],
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getCommandsDir).mockReturnValue('/test/.claude/commands');

      const { pluginSymlink } = await import('../pluginSymlink');
      
      const result = await pluginSymlink.checkSymlinks(mockParsedPlugin);

      expect(result).toBe(true);
    });

    it('should return false if no symlinks exist', async () => {
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
        path: '/test/plugins/test-plugin',
        marketplaceName: 'test-market',
        pluginName: 'test-plugin'
      };

      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { pluginSymlink } = await import('../pluginSymlink');
      
      const result = await pluginSymlink.checkSymlinks(mockParsedPlugin);

      expect(result).toBe(false);
    });
  });
});

