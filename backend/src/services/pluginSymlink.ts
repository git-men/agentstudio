import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths';
import { ParsedPlugin } from '../types/plugins';
import { getEnginePaths, getClaudeMirrorPaths } from '../config/engineConfig';
import type { EnginePathConfig } from '../types/engine';
import { atomicWriteFileSync } from '../utils/fileUtils.js';

/**
 * Plugin Symlink Service
 * Manages symlinks for plugin components in ~/.claude and ~/.claude-internal.
 * When the active engine is claude-sdk or claude-internal-sdk, symlinks and MCP
 * config are mirrored to the sibling directory so both CLI variants share
 * the same installed plugins.
 */
class PluginSymlink {
  private getAllTargetPaths(): EnginePathConfig[] {
    return [getEnginePaths(), ...getClaudeMirrorPaths()];
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async createSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components } = parsedPlugin;
    const allPaths = this.getAllTargetPaths();

    for (const paths of allPaths) {
      for (const command of components.commands) {
        this.ensureDir(paths.commandsDir);
        await this.createSymlink(
          command.path,
          path.join(paths.commandsDir, `${command.name}.md`),
          'command',
        );
      }

      for (const agent of components.agents) {
        this.ensureDir(paths.agentsDir);
        await this.createSymlink(
          agent.path,
          path.join(paths.agentsDir, `${agent.name}.md`),
          'agent',
        );
      }

      for (const skill of components.skills) {
        const skillDir = path.dirname(skill.path);
        this.ensureDir(paths.skillsDir);
        await this.createSymlink(
          skillDir,
          path.join(paths.skillsDir, skill.name),
          'skill',
        );
      }
    }

    if (components.mcpServers.length > 0) {
      await this.installMcpServers(parsedPlugin);
    }
  }

  async removeSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components } = parsedPlugin;
    const allPaths = this.getAllTargetPaths();

    for (const paths of allPaths) {
      for (const command of components.commands) {
        await this.removeSymlink(
          path.join(paths.commandsDir, `${command.name}.md`),
          'command',
        );
      }

      for (const agent of components.agents) {
        await this.removeSymlink(
          path.join(paths.agentsDir, `${agent.name}.md`),
          'agent',
        );
      }

      for (const skill of components.skills) {
        await this.removeSymlink(
          path.join(paths.skillsDir, skill.name),
          'skill',
        );
      }
    }

    if (components.mcpServers.length > 0) {
      await this.removeMcpServers(parsedPlugin);
    }
  }

  private async createSymlink(sourcePath: string, symlinkPath: string, type: string): Promise<void> {
    try {
      let existingStats: fs.Stats | null = null;
      try {
        existingStats = fs.lstatSync(symlinkPath);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }

      if (existingStats !== null) {
        if (existingStats.isSymbolicLink()) {
          const existingTarget = fs.readlinkSync(symlinkPath);
          if (existingTarget === sourcePath) {
            return; // already points to correct target, idempotent skip
          }
          fs.unlinkSync(symlinkPath);
        } else {
          console.warn(`Skipping ${type} symlink, path exists and is not a symlink: ${symlinkPath}`);
          return;
        }
      }

      fs.symlinkSync(sourcePath, symlinkPath);
      console.log(`Created ${type} symlink: ${symlinkPath} -> ${sourcePath}`);
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Last-resort guard: concurrent or race condition, idempotent ignore
        console.warn(`Skipping ${type} symlink (EEXIST race condition): ${symlinkPath}`);
        return;
      }
      console.error(`Failed to create ${type} symlink at ${symlinkPath}:`, error);
      throw error;
    }
  }

  private async removeSymlink(symlinkPath: string, type: string): Promise<void> {
    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(symlinkPath);
          console.log(`Removed ${type} symlink: ${symlinkPath}`);
        }
      }
    } catch (error) {
      console.error(`Failed to remove ${type} symlink at ${symlinkPath}:`, error);
      throw error;
    }
  }

  private async installMcpServers(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, pluginName, marketplaceName } = parsedPlugin;
    const allPaths = this.getAllTargetPaths();

    for (const mcpServer of components.mcpServers) {
      try {
        const mcpJsonPath = mcpServer.path;
        if (!fs.existsSync(mcpJsonPath)) continue;

        const mcpContent = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));

        let serverEntries: Record<string, any> = {};
        if (mcpContent.mcpServers && typeof mcpContent.mcpServers === 'object') {
          serverEntries = mcpContent.mcpServers;
        } else {
          for (const [key, value] of Object.entries(mcpContent)) {
            if (key.startsWith('$')) continue;
            if (typeof value === 'object' && value !== null) {
              serverEntries[key] = value;
            }
          }
        }

        if (Object.keys(serverEntries).length === 0) continue;

        for (const paths of allPaths) {
          this.mergeMcpEntries(paths.mcpConfigPath, serverEntries, marketplaceName, pluginName);
        }
      } catch (error) {
        console.error(`Failed to install MCP server from ${pluginName}:`, error);
      }
    }
  }

  private mergeMcpEntries(
    mcpConfigPath: string,
    serverEntries: Record<string, any>,
    marketplaceName: string,
    pluginName: string,
  ): void {
    let existingConfig: Record<string, any> = {};
    if (fs.existsSync(mcpConfigPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      } catch {
        existingConfig = {};
      }
    }

    if (!existingConfig.mcpServers) {
      existingConfig.mcpServers = {};
    }

    for (const [name, config] of Object.entries(serverEntries)) {
      existingConfig.mcpServers[name] = {
        ...(config as any),
        _installedBy: `${marketplaceName}/${pluginName}`,
      };
      console.log(`Registered MCP server: ${name} in ${mcpConfigPath} (from ${pluginName})`);
    }

    atomicWriteFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2));
  }

  private async removeMcpServers(parsedPlugin: ParsedPlugin): Promise<void> {
    const { marketplaceName, pluginName } = parsedPlugin;
    const installedBy = `${marketplaceName}/${pluginName}`;
    const allPaths = this.getAllTargetPaths();

    for (const paths of allPaths) {
      try {
        const mcpConfigPath = paths.mcpConfigPath;
        if (!fs.existsSync(mcpConfigPath)) continue;

        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
        if (!config.mcpServers) continue;

        let removed = false;
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          if ((serverConfig as any)._installedBy === installedBy) {
            delete config.mcpServers[name];
            console.log(`Removed MCP server: ${name} from ${mcpConfigPath} (from ${pluginName})`);
            removed = true;
          }
        }

        if (removed) {
          atomicWriteFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
        }
      } catch (error) {
        console.error(`Failed to remove MCP servers from ${pluginName}:`, error);
      }
    }
  }

  async checkSymlinks(parsedPlugin: ParsedPlugin): Promise<boolean> {
    const { components } = parsedPlugin;

    for (const command of components.commands) {
      const commandsDir = pluginPaths.getCommandsDir();
      const symlinkPath = path.join(commandsDir, `${command.name}.md`);
      if (fs.existsSync(symlinkPath)) {
        return true;
      }
    }

    for (const agent of components.agents) {
      const agentsDir = pluginPaths.getAgentsDir();
      const symlinkPath = path.join(agentsDir, `${agent.name}.md`);
      if (fs.existsSync(symlinkPath)) {
        return true;
      }
    }

    for (const skill of components.skills) {
      const skillsDir = pluginPaths.getSkillsDir();
      const symlinkPath = path.join(skillsDir, skill.name);
      if (fs.existsSync(symlinkPath)) {
        return true;
      }
    }

    for (const mcpServer of components.mcpServers) {
      const mcpConfigPath = getEnginePaths().mcpConfigPath;
      if (fs.existsSync(mcpConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
          if (config.mcpServers) {
            for (const serverConfig of Object.values(config.mcpServers)) {
              if ((serverConfig as any)._installedBy === `${parsedPlugin.marketplaceName}/${parsedPlugin.pluginName}`) {
                return true;
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return false;
  }
}

export const pluginSymlink = new PluginSymlink();
