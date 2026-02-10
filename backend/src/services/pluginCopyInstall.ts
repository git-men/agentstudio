/**
 * Plugin Copy Install Service
 * 
 * Installs plugin components via file copy for the cursor-cli engine.
 * Unlike pluginSymlink.ts (which uses symlinks for claude-sdk),
 * this service copies files directly to the target directories.
 * 
 * Key differences from symlink approach:
 * - Skills: copied to ~/.cursor/skills-cursor/ (or builtinSkillsDir)
 * - MCP: accumulated and written as unified mcp.json
 * - Rules/Commands: copied with pluginName-id naming pattern
 * - Clean-before-install: clears target directories before installation
 * 
 * This logic is ported from as-mate's marketplace-service.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getEnginePaths } from '../config/engineConfig.js';
import { ParsedPlugin, PluginComponent } from '../types/plugins.js';

/** MCP server config entry */
interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

/** MCP manifest from plugin */
interface MCPManifest {
  name: string;
  version: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cursorEntry?: string;
}

/**
 * Plugin Copy Install Service
 * Installs plugins via file copy (for cursor-cli engine)
 */
class PluginCopyInstall {
  // MCP config accumulator: collects MCP configs across all plugins
  private mcpConfigAccumulator: Record<string, MCPServerConfig> = {};

  /**
   * Install all components of a plugin via file copy
   */
  async createSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, marketplaceName, pluginName } = parsedPlugin;

    // Install commands
    for (const command of components.commands) {
      await this.installCommand(command, pluginName);
    }

    // Install agents
    for (const agent of components.agents) {
      await this.installAgent(agent, pluginName);
    }

    // Install skills
    for (const skill of components.skills) {
      const skillDir = path.dirname(skill.path); // Remove SKILL.md to get directory
      await this.installSkill(skillDir, skill.name, pluginName);
    }

    // Collect MCP server configs (will be written out later via flushMCPConfig)
    for (const mcpServer of components.mcpServers) {
      await this.collectMCPServer(mcpServer, pluginName);
    }
  }

  /**
   * Remove installed plugin components
   */
  async removeSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, marketplaceName, pluginName } = parsedPlugin;
    const paths = getEnginePaths();

    // Remove commands
    for (const command of components.commands) {
      const targetPath = path.join(paths.commandsDir, `${command.name}.md`);
      this.safeRemove(targetPath);
    }

    // Remove agents
    for (const agent of components.agents) {
      const targetPath = path.join(paths.agentsDir, `${agent.name}.md`);
      this.safeRemove(targetPath);
    }

    // Remove skills
    for (const skill of components.skills) {
      const skillsDir = paths.builtinSkillsDir || paths.skillsDir;
      const targetPath = path.join(skillsDir, skill.name);
      this.safeRemoveDir(targetPath);
    }

    // Note: MCP config entries are not individually removed;
    // they'll be rebuilt on next full install
  }

  /**
   * Clean target directories before a full marketplace install.
   * Called before installPlugins to ensure a clean state.
   * 
   * For cursor-cli engine, this performs:
   * - Complete removal of skills directory (user customizations should be in workspace)
   * - Removal of marketplace-installed rules (files containing '-' with .mdc extension)
   * - Removal of marketplace-installed commands (files containing '-' with .md extension)
   * - Reset of MCP config accumulator
   */
  cleanBeforeInstall(): void {
    const paths = getEnginePaths();
    const skillsDir = paths.builtinSkillsDir || paths.skillsDir;

    // Clear skills directory completely
    if (fs.existsSync(skillsDir)) {
      fs.rmSync(skillsDir, { recursive: true, force: true });
      console.log(`[PluginCopyInstall] Skills directory cleared: ${skillsDir}`);
    }

    // Clear marketplace-installed rules (pattern: contains '-' and ends with .mdc)
    if (fs.existsSync(paths.rulesDir)) {
      const files = fs.readdirSync(paths.rulesDir);
      for (const file of files) {
        if (file.includes('-') && file.endsWith('.mdc')) {
          fs.rmSync(path.join(paths.rulesDir, file), { force: true });
        }
      }
      console.log(`[PluginCopyInstall] Marketplace rules cleared: ${paths.rulesDir}`);
    }

    // Clear marketplace-installed commands (pattern: contains '-' and ends with .md)
    if (fs.existsSync(paths.commandsDir)) {
      const files = fs.readdirSync(paths.commandsDir);
      for (const file of files) {
        if (file.includes('-') && file.endsWith('.md')) {
          fs.rmSync(path.join(paths.commandsDir, file), { force: true });
        }
      }
      console.log(`[PluginCopyInstall] Marketplace commands cleared: ${paths.commandsDir}`);
    }

    // Reset MCP accumulator
    this.mcpConfigAccumulator = {};
  }

  /**
   * Flush accumulated MCP config to mcp.json (overwrite mode).
   * Should be called after all plugins have been installed.
   */
  flushMCPConfig(): void {
    const paths = getEnginePaths();
    const mcpConfigPath = paths.mcpConfigPath;

    if (Object.keys(this.mcpConfigAccumulator).length === 0) {
      console.log('[PluginCopyInstall] No MCP servers to configure');
      return;
    }

    const mcpConfig = { mcpServers: this.mcpConfigAccumulator };
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
    console.log(`[PluginCopyInstall] MCP config written (${Object.keys(this.mcpConfigAccumulator).length} servers): ${mcpConfigPath}`);
  }

  /**
   * Check if copy-installed files exist for a plugin
   */
  async checkSymlinks(parsedPlugin: ParsedPlugin): Promise<boolean> {
    const { components } = parsedPlugin;
    const paths = getEnginePaths();

    for (const command of components.commands) {
      const targetPath = path.join(paths.commandsDir, `${command.name}.md`);
      if (fs.existsSync(targetPath)) return true;
    }

    for (const agent of components.agents) {
      const targetPath = path.join(paths.agentsDir, `${agent.name}.md`);
      if (fs.existsSync(targetPath)) return true;
    }

    for (const skill of components.skills) {
      const skillsDir = paths.builtinSkillsDir || paths.skillsDir;
      const targetPath = path.join(skillsDir, skill.name);
      if (fs.existsSync(targetPath)) return true;
    }

    return false;
  }

  // ==========================================================================
  // Private installation methods
  // ==========================================================================

  private async installCommand(command: PluginComponent, pluginName: string): Promise<void> {
    const paths = getEnginePaths();
    const targetPath = path.join(paths.commandsDir, `${command.name}.md`);

    try {
      fs.mkdirSync(paths.commandsDir, { recursive: true });
      fs.copyFileSync(command.path, targetPath);
      console.log(`[PluginCopyInstall] Command installed: ${command.name} -> ${targetPath}`);
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to install command ${command.name}:`, error);
    }
  }

  private async installAgent(agent: PluginComponent, pluginName: string): Promise<void> {
    const paths = getEnginePaths();
    const targetPath = path.join(paths.agentsDir, `${agent.name}.md`);

    try {
      fs.mkdirSync(paths.agentsDir, { recursive: true });
      fs.copyFileSync(agent.path, targetPath);
      console.log(`[PluginCopyInstall] Agent installed: ${agent.name} -> ${targetPath}`);
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to install agent ${agent.name}:`, error);
    }
  }

  private async installSkill(sourceDir: string, skillName: string, pluginName: string): Promise<void> {
    const paths = getEnginePaths();
    // For cursor-cli, use builtinSkillsDir (~/.cursor/skills-cursor/) if available
    const skillsDir = paths.builtinSkillsDir || paths.skillsDir;
    const targetDir = path.join(skillsDir, skillName);

    try {
      fs.mkdirSync(skillsDir, { recursive: true });

      // Overwrite mode: remove existing then copy
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.cpSync(sourceDir, targetDir, { recursive: true });
      console.log(`[PluginCopyInstall] Skill installed: ${skillName} -> ${targetDir}`);
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to install skill ${skillName}:`, error);
    }
  }

  private async collectMCPServer(mcpComponent: PluginComponent, pluginName: string): Promise<void> {
    try {
      const mcpDir = path.dirname(mcpComponent.path);
      const manifestPath = mcpComponent.path;

      if (!fs.existsSync(manifestPath)) {
        console.warn(`[PluginCopyInstall] MCP manifest not found: ${manifestPath}`);
        return;
      }

      const manifest: MCPManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Build entry file path
      const entryFile = manifest.cursorEntry
        ? path.join(mcpDir, manifest.cursorEntry)
        : path.join(mcpDir, 'dist', 'index.js');

      this.mcpConfigAccumulator[mcpComponent.name] = {
        command: process.execPath, // Use current Node.js path
        args: [entryFile],
        env: {
          MCP_PLUGIN: pluginName,
          ...(manifest.env || {}),
        },
      };

      console.log(`[PluginCopyInstall] MCP server collected: ${mcpComponent.name} (entry: ${entryFile})`);
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to collect MCP server ${mcpComponent.name}:`, error);
    }
  }

  // ==========================================================================
  // Utility methods
  // ==========================================================================

  private safeRemove(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[PluginCopyInstall] Removed: ${filePath}`);
      }
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to remove ${filePath}:`, error);
    }
  }

  private safeRemoveDir(dirPath: string): void {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[PluginCopyInstall] Removed directory: ${dirPath}`);
      }
    } catch (error) {
      console.error(`[PluginCopyInstall] Failed to remove directory ${dirPath}:`, error);
    }
  }
}

export const pluginCopyInstall = new PluginCopyInstall();
