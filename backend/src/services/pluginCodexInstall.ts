/**
 * Codex Plugin Installer
 *
 * Handles plugin installation for Codex engines (both codex-cli and codex-sdk).
 * Creates symlinks in ~/.codex/ directories and merges MCP server config
 * into ~/.codex/config.toml using TOML format with _installedBy tracking.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { ParsedPlugin } from '../types/plugins.js';
import type { PluginInstaller } from './pluginInstallStrategy.js';

function getCodexDir(): string {
  return path.join(os.homedir(), '.codex');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class PluginCodexInstall implements PluginInstaller {
  async createSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, marketplaceName, pluginName } = parsedPlugin;
    const codexDir = getCodexDir();

    for (const command of components.commands) {
      const targetDir = path.join(codexDir, 'commands');
      ensureDir(targetDir);
      const symlinkPath = path.join(targetDir, `${command.name}.md`);
      await this.createSymlink(command.path, symlinkPath, 'command');
    }

    for (const agent of components.agents) {
      const targetDir = path.join(codexDir, 'agents');
      ensureDir(targetDir);
      const symlinkPath = path.join(targetDir, `${agent.name}.md`);
      await this.createSymlink(agent.path, symlinkPath, 'agent');
    }

    for (const skill of components.skills) {
      const skillDir = path.dirname(skill.path);
      const targetDir = path.join(codexDir, 'skills', 'marketplace', pluginName);
      ensureDir(path.dirname(targetDir));
      const symlinkPath = path.join(targetDir, skill.name);
      await this.createSymlink(skillDir, symlinkPath, 'skill');
    }

    if (components.mcpServers.length > 0) {
      await this.installMcpServersToml(parsedPlugin);
    }
  }

  async removeSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, pluginName } = parsedPlugin;
    const codexDir = getCodexDir();

    for (const command of components.commands) {
      const symlinkPath = path.join(codexDir, 'commands', `${command.name}.md`);
      await this.removeSymlink(symlinkPath, 'command');
    }

    for (const agent of components.agents) {
      const symlinkPath = path.join(codexDir, 'agents', `${agent.name}.md`);
      await this.removeSymlink(symlinkPath, 'agent');
    }

    for (const skill of components.skills) {
      const symlinkPath = path.join(codexDir, 'skills', 'marketplace', pluginName, skill.name);
      await this.removeSymlink(symlinkPath, 'skill');
    }

    if (components.mcpServers.length > 0) {
      await this.removeMcpServersToml(parsedPlugin);
    }
  }

  async checkSymlinks(parsedPlugin: ParsedPlugin): Promise<boolean> {
    const { components, pluginName } = parsedPlugin;
    const codexDir = getCodexDir();

    for (const command of components.commands) {
      const symlinkPath = path.join(codexDir, 'commands', `${command.name}.md`);
      if (fs.existsSync(symlinkPath)) return true;
    }

    for (const agent of components.agents) {
      const symlinkPath = path.join(codexDir, 'agents', `${agent.name}.md`);
      if (fs.existsSync(symlinkPath)) return true;
    }

    for (const skill of components.skills) {
      const symlinkPath = path.join(codexDir, 'skills', 'marketplace', pluginName, skill.name);
      if (fs.existsSync(symlinkPath)) return true;
    }

    const configPath = path.join(codexDir, 'config.toml');
    if (fs.existsSync(configPath)) {
      try {
        const config = parseToml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
        const mcpServers = (config.mcp_servers || {}) as Record<string, Record<string, unknown>>;
        const marker = `marketplace:${pluginName}`;
        for (const serverConfig of Object.values(mcpServers)) {
          if (serverConfig._installedBy === marker) return true;
        }
      } catch {
        // ignore parse errors
      }
    }

    return false;
  }

  private async installMcpServersToml(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, pluginName } = parsedPlugin;
    const configPath = path.join(getCodexDir(), 'config.toml');
    const marker = `marketplace:${pluginName}`;

    for (const mcpServer of components.mcpServers) {
      try {
        const mcpJsonPath = mcpServer.path;
        if (!fs.existsSync(mcpJsonPath)) continue;

        const mcpContent = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));

        let serverEntries: Record<string, Record<string, unknown>> = {};
        if (mcpContent.mcpServers && typeof mcpContent.mcpServers === 'object') {
          serverEntries = mcpContent.mcpServers;
        } else {
          for (const [key, value] of Object.entries(mcpContent)) {
            if (key.startsWith('$')) continue;
            if (typeof value === 'object' && value !== null) {
              serverEntries[key] = value as Record<string, unknown>;
            }
          }
        }

        if (Object.keys(serverEntries).length === 0) continue;

        let config: Record<string, unknown> = {};
        try {
          if (fs.existsSync(configPath)) {
            config = parseToml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
          }
        } catch {
          config = {};
        }

        if (!config.mcp_servers || typeof config.mcp_servers !== 'object') {
          config.mcp_servers = {};
        }

        const mcpServers = config.mcp_servers as Record<string, unknown>;

        for (const [name, serverConfig] of Object.entries(serverEntries)) {
          mcpServers[name] = {
            ...serverConfig,
            _installedBy: marker,
          };
          console.log(`[PluginCodexInstall] Registered TOML MCP server: ${name} (from ${pluginName})`);
        }

        ensureDir(getCodexDir());
        fs.writeFileSync(configPath, stringifyToml(config), 'utf-8');
      } catch (error) {
        console.error(`[PluginCodexInstall] Failed to install MCP server from ${pluginName}:`, error);
      }
    }
  }

  private async removeMcpServersToml(parsedPlugin: ParsedPlugin): Promise<void> {
    const { pluginName } = parsedPlugin;
    const configPath = path.join(getCodexDir(), 'config.toml');
    const marker = `marketplace:${pluginName}`;

    try {
      if (!fs.existsSync(configPath)) return;

      const config = parseToml(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      if (!config.mcp_servers || typeof config.mcp_servers !== 'object') return;

      const mcpServers = config.mcp_servers as Record<string, Record<string, unknown>>;
      let removed = false;

      for (const [name, serverConfig] of Object.entries(mcpServers)) {
        if (serverConfig._installedBy === marker) {
          delete mcpServers[name];
          console.log(`[PluginCodexInstall] Removed TOML MCP server: ${name} (from ${pluginName})`);
          removed = true;
        }
      }

      if (removed) {
        fs.writeFileSync(configPath, stringifyToml(config), 'utf-8');
      }
    } catch (error) {
      console.error(`[PluginCodexInstall] Failed to remove MCP servers from ${pluginName}:`, error);
    }
  }

  private async createSymlink(sourcePath: string, symlinkPath: string, type: string): Promise<void> {
    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          const existingTarget = fs.readlinkSync(symlinkPath);
          if (existingTarget === sourcePath) return;
          fs.unlinkSync(symlinkPath);
        } else {
          throw new Error(`File already exists and is not a symlink: ${symlinkPath}`);
        }
      }
      ensureDir(path.dirname(symlinkPath));
      fs.symlinkSync(sourcePath, symlinkPath);
      console.log(`[PluginCodexInstall] Created ${type} symlink: ${symlinkPath} -> ${sourcePath}`);
    } catch (error) {
      console.error(`[PluginCodexInstall] Failed to create ${type} symlink:`, error);
      throw error;
    }
  }

  private async removeSymlink(symlinkPath: string, type: string): Promise<void> {
    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(symlinkPath);
          console.log(`[PluginCodexInstall] Removed ${type} symlink: ${symlinkPath}`);
        }
      }
    } catch (error) {
      console.error(`[PluginCodexInstall] Failed to remove ${type} symlink:`, error);
    }
  }
}

export const pluginCodexInstall = new PluginCodexInstall();
