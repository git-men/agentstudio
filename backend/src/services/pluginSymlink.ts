import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths';
import { ParsedPlugin } from '../types/plugins';
import { getEnginePaths } from '../config/engineConfig';

/**
 * Plugin Symlink Service
 * Manages symlinks for plugin components in ~/.claude
 * Also handles MCP server configuration by merging into mcp.json
 */
class PluginSymlink {
  /**
   * Create symlinks for all components of a plugin
   */
  async createSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, marketplaceName, pluginName } = parsedPlugin;

    // Create command symlinks
    for (const command of components.commands) {
      await this.createCommandSymlink(command.path, command.name, marketplaceName, pluginName);
    }

    // Create agent symlinks
    for (const agent of components.agents) {
      await this.createAgentSymlink(agent.path, agent.name, marketplaceName, pluginName);
    }

    // Create skill symlinks
    for (const skill of components.skills) {
      // Skills are directories, so symlink the parent directory
      const skillDir = path.dirname(skill.path); // Remove SKILL.md
      await this.createSkillSymlink(skillDir, skill.name, marketplaceName, pluginName);
    }

    // Install MCP servers by merging their config into ~/.claude/mcp.json
    if (components.mcpServers.length > 0) {
      await this.installMcpServers(parsedPlugin);
    }
  }

  /**
   * Remove symlinks for a plugin
   */
  async removeSymlinks(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, marketplaceName, pluginName } = parsedPlugin;

    // Remove command symlinks
    for (const command of components.commands) {
      await this.removeCommandSymlink(command.name, marketplaceName, pluginName);
    }

    // Remove agent symlinks
    for (const agent of components.agents) {
      await this.removeAgentSymlink(agent.name, marketplaceName, pluginName);
    }

    // Remove skill symlinks
    for (const skill of components.skills) {
      await this.removeSkillSymlink(skill.name, marketplaceName, pluginName);
    }

    // Remove MCP server entries from mcp.json
    if (components.mcpServers.length > 0) {
      await this.removeMcpServers(parsedPlugin);
    }
  }

  /**
   * Create command symlink (~/.claude/commands/commandName.md -> plugin command file)
   */
  private async createCommandSymlink(
    sourcePath: string,
    commandName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const commandsDir = pluginPaths.getCommandsDir();
    // Use marketplace and plugin name prefix to avoid conflicts
    const symlinkName = `${commandName}.md`;
    const symlinkPath = path.join(commandsDir, symlinkName);

    await this.createSymlink(sourcePath, symlinkPath, 'command');
  }

  /**
   * Create agent symlink (~/.claude/agents/agentName.md -> plugin agent file)
   */
  private async createAgentSymlink(
    sourcePath: string,
    agentName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const agentsDir = pluginPaths.getAgentsDir();
    const symlinkName = `${agentName}.md`;
    const symlinkPath = path.join(agentsDir, symlinkName);

    await this.createSymlink(sourcePath, symlinkPath, 'agent');
  }

  /**
   * Create skill symlink (~/.claude/skills/skillName -> plugin skill directory)
   */
  private async createSkillSymlink(
    sourcePath: string,
    skillName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const skillsDir = pluginPaths.getSkillsDir();
    const symlinkName = skillName;
    const symlinkPath = path.join(skillsDir, symlinkName);

    await this.createSymlink(sourcePath, symlinkPath, 'skill');
  }

  /**
   * Remove command symlink
   */
  private async removeCommandSymlink(
    commandName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const commandsDir = pluginPaths.getCommandsDir();
    const symlinkName = `${commandName}.md`;
    const symlinkPath = path.join(commandsDir, symlinkName);

    await this.removeSymlink(symlinkPath, 'command');
  }

  /**
   * Remove agent symlink
   */
  private async removeAgentSymlink(
    agentName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const agentsDir = pluginPaths.getAgentsDir();
    const symlinkName = `${agentName}.md`;
    const symlinkPath = path.join(agentsDir, symlinkName);

    await this.removeSymlink(symlinkPath, 'agent');
  }

  /**
   * Remove skill symlink
   */
  private async removeSkillSymlink(
    skillName: string,
    marketplaceName: string,
    pluginName: string
  ): Promise<void> {
    const skillsDir = pluginPaths.getSkillsDir();
    const symlinkName = skillName;
    const symlinkPath = path.join(skillsDir, symlinkName);

    await this.removeSymlink(symlinkPath, 'skill');
  }

  /**
   * Generic symlink creation
   */
  private async createSymlink(sourcePath: string, symlinkPath: string, type: string): Promise<void> {
    try {
      // Check if symlink already exists
      if (fs.existsSync(symlinkPath)) {
        // Check if it's a symlink
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          const existingTarget = fs.readlinkSync(symlinkPath);
          if (existingTarget === sourcePath) {
            // Symlink already points to correct target
            console.log(`Symlink already exists for ${type}: ${symlinkPath}`);
            return;
          }
          // Remove existing symlink
          fs.unlinkSync(symlinkPath);
        } else {
          throw new Error(`File already exists and is not a symlink: ${symlinkPath}`);
        }
      }

      // Create symlink
      fs.symlinkSync(sourcePath, symlinkPath);
      console.log(`Created ${type} symlink: ${symlinkPath} -> ${sourcePath}`);
    } catch (error) {
      console.error(`Failed to create ${type} symlink:`, error);
      throw error;
    }
  }

  /**
   * Generic symlink removal
   */
  private async removeSymlink(symlinkPath: string, type: string): Promise<void> {
    try {
      if (fs.existsSync(symlinkPath)) {
        const stats = fs.lstatSync(symlinkPath);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(symlinkPath);
          console.log(`Removed ${type} symlink: ${symlinkPath}`);
        } else {
          console.warn(`File is not a symlink: ${symlinkPath}`);
        }
      }
    } catch (error) {
      console.error(`Failed to remove ${type} symlink:`, error);
      throw error;
    }
  }

  /**
   * Install MCP servers from a plugin's .mcp.json into the engine's mcp.json
   * Reads the plugin's .mcp.json file and merges server entries into ~/.claude/mcp.json
   */
  private async installMcpServers(parsedPlugin: ParsedPlugin): Promise<void> {
    const { components, pluginName } = parsedPlugin;
    const mcpConfigPath = getEnginePaths().mcpConfigPath;

    for (const mcpServer of components.mcpServers) {
      try {
        // Read the .mcp.json file from the plugin
        const mcpJsonPath = mcpServer.path;
        if (!fs.existsSync(mcpJsonPath)) continue;

        const mcpContent = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));

        // Extract server entries (handle both wrapped and flat formats)
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

        // Read existing mcp.json or create new
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

        // Merge server entries (with metadata tracking which plugin installed them)
        for (const [name, config] of Object.entries(serverEntries)) {
          existingConfig.mcpServers[name] = {
            ...(config as any),
            _installedBy: `${parsedPlugin.marketplaceName}/${pluginName}`,
          };
          console.log(`Registered MCP server: ${name} (from ${pluginName})`);
        }

        // Write back
        fs.writeFileSync(mcpConfigPath, JSON.stringify(existingConfig, null, 2), 'utf-8');
      } catch (error) {
        console.error(`Failed to install MCP server from ${pluginName}:`, error);
      }
    }
  }

  /**
   * Remove MCP server entries that were installed by this plugin
   */
  private async removeMcpServers(parsedPlugin: ParsedPlugin): Promise<void> {
    const { marketplaceName, pluginName } = parsedPlugin;
    const mcpConfigPath = getEnginePaths().mcpConfigPath;
    const installedBy = `${marketplaceName}/${pluginName}`;

    try {
      if (!fs.existsSync(mcpConfigPath)) return;

      const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      if (!config.mcpServers) return;

      let removed = false;
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if ((serverConfig as any)._installedBy === installedBy) {
          delete config.mcpServers[name];
          console.log(`Removed MCP server: ${name} (from ${pluginName})`);
          removed = true;
        }
      }

      if (removed) {
        fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch (error) {
      console.error(`Failed to remove MCP servers from ${pluginName}:`, error);
    }
  }

  /**
   * Check if symlinks exist for a plugin
   */
  async checkSymlinks(parsedPlugin: ParsedPlugin): Promise<boolean> {
    const { components } = parsedPlugin;

    // Check if at least one symlink exists for each type
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

    // Check if any MCP servers from this plugin are registered
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

