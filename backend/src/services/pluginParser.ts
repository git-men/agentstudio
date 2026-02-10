import * as fs from 'fs';
import * as path from 'path';
import { ParsedPlugin, PluginManifest, PluginComponent, PluginFile } from '../types/plugins';
import { pluginPaths } from './pluginPaths';

/**
 * Plugin Parser Service
 * Parses plugin directories according to Claude Code plugin specification
 */
class PluginParser {
  /**
   * Parse a plugin directory
   */
  async parsePlugin(pluginPath: string, marketplaceName: string, pluginName: string): Promise<ParsedPlugin> {
    // Read plugin manifest
    const manifest = await this.readManifest(pluginPath, pluginName, marketplaceName);

    // Parse components (also check marketplace.json for virtual plugin components like MCP)
    const components = await this.parseComponents(pluginPath, pluginName, marketplaceName);

    // Get all files
    const files = await this.getAllFiles(pluginPath);

    return {
      manifest,
      components,
      files,
      path: pluginPath,
      marketplaceName,
      pluginName,
    };
  }

  /**
   * Read plugin manifest (.claude-plugin/plugin.json or from marketplace.json)
   * Supports:
   * 1. Standard: pluginPath/.claude-plugin/plugin.json
   * 2. Virtual: defined in marketplace.json (walks up directory tree to find it)
   */
  private async readManifest(pluginPath: string, pluginName?: string, marketplaceName?: string): Promise<PluginManifest> {
    const manifestPath = path.join(pluginPath, '.claude-plugin', 'plugin.json');

    // First, try standard plugin.json
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, 'utf-8');
        const manifest = JSON.parse(content);

        // Strict minimum: name and description must exist
        if (!manifest.name || !manifest.description) {
          throw new Error('Plugin manifest is missing required fields (name, description)');
        }

        // Fill in optional fields from marketplace.json if missing
        if (marketplaceName) {
          const marketplaceManifest = this.readMarketplaceManifest(marketplaceName);
          if (marketplaceManifest) {
            if (!manifest.version) {
              manifest.version = marketplaceManifest.metadata?.version || '1.0.0';
            }
            if (!manifest.author) {
              manifest.author = marketplaceManifest.owner || { name: 'Unknown' };
            }
          }
        }

        // Default fallbacks for missing optional fields
        if (!manifest.version) manifest.version = '1.0.0';
        if (!manifest.author) manifest.author = { name: 'Unknown' };

        return manifest;
      } catch (error) {
        if (error instanceof Error && error.message.includes('missing required fields')) {
          throw new Error(`Failed to parse plugin manifest: ${error.message}`);
        }
        // If parsing failed, fall through to marketplace.json fallback
      }
    }

    // Fallback: search for marketplace.json by walking up the directory tree
    // This supports virtual plugins that are defined only in marketplace.json
    const syntheticManifest = this.readManifestFromMarketplaceJson(pluginPath, pluginName, marketplaceName);
    if (syntheticManifest) {
      return syntheticManifest;
    }

    throw new Error('Plugin manifest not found (.claude-plugin/plugin.json or marketplace.json)');
  }

  /**
   * Read the marketplace's marketplace.json file
   */
  private readMarketplaceManifest(marketplaceName: string): any | null {
    try {
      const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
      const manifestPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');
      if (fs.existsSync(manifestPath)) {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Try to create a synthetic manifest by searching for marketplace.json
   * Walks up the directory tree from pluginPath, or uses marketplaceName directly
   */
  private readManifestFromMarketplaceJson(
    pluginPath: string,
    pluginName?: string,
    marketplaceName?: string
  ): PluginManifest | null {
    // Strategy 1: If marketplaceName is provided, go directly to the marketplace root
    if (marketplaceName) {
      const marketplaceManifest = this.readMarketplaceManifest(marketplaceName);
      if (marketplaceManifest) {
        const manifest = this.extractPluginFromMarketplace(marketplaceManifest, pluginName || path.basename(pluginPath));
        if (manifest) return manifest;
      }
    }

    // Strategy 2: Walk up the directory tree to find marketplace.json
    let currentDir = pluginPath;
    const root = path.parse(currentDir).root;
    const maxDepth = 5; // Safety limit
    
    for (let i = 0; i < maxDepth; i++) {
      const marketplaceManifestPath = path.join(currentDir, '.claude-plugin', 'marketplace.json');
      
      if (fs.existsSync(marketplaceManifestPath)) {
        try {
          const content = fs.readFileSync(marketplaceManifestPath, 'utf-8');
          const marketplaceManifest = JSON.parse(content);
          const manifest = this.extractPluginFromMarketplace(
            marketplaceManifest, 
            pluginName || path.basename(pluginPath)
          );
          if (manifest) return manifest;
        } catch (error) {
          console.error('Failed to read marketplace manifest:', error);
        }
      }

      // Move up one directory
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir || parentDir === root) break;
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Extract a plugin definition from a marketplace manifest and create a synthetic PluginManifest
   */
  private extractPluginFromMarketplace(marketplaceManifest: any, pluginName: string): PluginManifest | null {
    if (!marketplaceManifest.plugins || !Array.isArray(marketplaceManifest.plugins)) {
      return null;
    }

    const pluginDef = marketplaceManifest.plugins.find((p: any) => p.name === pluginName);
    if (!pluginDef) return null;

    return {
      name: pluginDef.name,
      description: pluginDef.description || 'No description available',
      version: pluginDef.version || marketplaceManifest.metadata?.version || '1.0.0',
      author: pluginDef.author || marketplaceManifest.owner || { name: 'Unknown' },
    };
  }

  /**
   * Parse plugin components
   */
  private async parseComponents(pluginPath: string, pluginName?: string, marketplaceName?: string): Promise<ParsedPlugin['components']> {
    const components: ParsedPlugin['components'] = {
      commands: [],
      agents: [],
      skills: [],
      hooks: [],
      mcpServers: [],
    };

    // Check if this plugin is defined in marketplace.json with skills
    // Use marketplaceName to find marketplace.json directly, or walk up
    let marketplaceManifestPath: string | null = null;
    let usePluginPath = pluginPath;

    if (marketplaceName) {
      // Direct lookup via marketplace name
      const mpPath = pluginPaths.getMarketplacePath(marketplaceName);
      const mpManifest = path.join(mpPath, '.claude-plugin', 'marketplace.json');
      if (fs.existsSync(mpManifest)) {
        marketplaceManifestPath = mpManifest;
        usePluginPath = mpPath;
      }
    }

    // Fallback: check pluginPath itself, then parent
    if (!marketplaceManifestPath) {
      const selfPath = path.join(pluginPath, '.claude-plugin', 'marketplace.json');
      if (fs.existsSync(selfPath)) {
        marketplaceManifestPath = selfPath;
        usePluginPath = pluginPath;
      } else {
        const parentPath = path.join(path.dirname(pluginPath), '.claude-plugin', 'marketplace.json');
        if (fs.existsSync(parentPath)) {
          marketplaceManifestPath = parentPath;
          usePluginPath = path.dirname(pluginPath);
        }
      }
    }

    if (marketplaceManifestPath && pluginName) {
      try {
        const content = fs.readFileSync(marketplaceManifestPath, 'utf-8');
        const marketplaceManifest = JSON.parse(content);

        if (marketplaceManifest.plugins && Array.isArray(marketplaceManifest.plugins)) {
          const pluginDef = marketplaceManifest.plugins.find((p: any) => p.name === pluginName);

          // If plugin has skills array in marketplace.json, parse those
          if (pluginDef && pluginDef.skills && Array.isArray(pluginDef.skills)) {
            for (const skillPath of pluginDef.skills) {
              const fullSkillPath = path.join(usePluginPath, skillPath, 'SKILL.md');
              if (fs.existsSync(fullSkillPath)) {
                const relativePath = path.relative(pluginPath, fullSkillPath);
                const description = await this.extractDescription(fullSkillPath);
                const skillName = path.basename(path.dirname(fullSkillPath));
                components.skills.push({
                  type: 'skill',
                  name: skillName,
                  path: fullSkillPath,
                  relativePath,
                  description,
                });
              }
            }

            // Return early if we found marketplace-defined skills
            if (components.skills.length > 0) {
              return components;
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse marketplace manifest for components:', error);
      }
    }

    // Standard component parsing (original logic)

    // Parse commands (commands/*.md)
    const commandsDir = path.join(pluginPath, 'commands');
    if (fs.existsSync(commandsDir) && fs.statSync(commandsDir).isDirectory()) {
      const commandFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
      for (const file of commandFiles) {
        const commandPath = path.join(commandsDir, file);
        const relativePath = path.relative(pluginPath, commandPath);
        const description = await this.extractDescription(commandPath);
        components.commands.push({
          type: 'command',
          name: path.basename(file, '.md'),
          path: commandPath,
          relativePath,
          description,
        });
      }
    }

    // Parse agents (agents/*.md)
    const agentsDir = path.join(pluginPath, 'agents');
    if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
      const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
      for (const file of agentFiles) {
        const agentPath = path.join(agentsDir, file);
        const relativePath = path.relative(pluginPath, agentPath);
        const description = await this.extractDescription(agentPath);
        components.agents.push({
          type: 'agent',
          name: path.basename(file, '.md'),
          path: agentPath,
          relativePath,
          description,
        });
      }
    }

    // Parse skills (skills/*/SKILL.md)
    const skillsDir = path.join(pluginPath, 'skills');
    if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
      const skillDirs = fs.readdirSync(skillsDir).filter(f => {
        const skillPath = path.join(skillsDir, f);
        return fs.statSync(skillPath).isDirectory();
      });

      for (const dir of skillDirs) {
        const skillPath = path.join(skillsDir, dir, 'SKILL.md');
        if (fs.existsSync(skillPath)) {
          const relativePath = path.relative(pluginPath, skillPath);
          const description = await this.extractDescription(skillPath);
          components.skills.push({
            type: 'skill',
            name: dir,
            path: skillPath,
            relativePath,
            description,
          });
        }
      }
    }

    // Parse hooks (hooks/hooks.json)
    const hooksPath = path.join(pluginPath, 'hooks', 'hooks.json');
    if (fs.existsSync(hooksPath)) {
      try {
        const hooksContent = fs.readFileSync(hooksPath, 'utf-8');
        const hooks = JSON.parse(hooksContent);
        const relativePath = path.relative(pluginPath, hooksPath);
        if (hooks.hooks && Array.isArray(hooks.hooks)) {
          for (const hook of hooks.hooks) {
            components.hooks.push({
              type: 'hook',
              name: hook.event || 'unknown',
              path: hooksPath,
              relativePath,
              description: hook.description,
            });
          }
        }
      } catch (error) {
        console.error('Failed to parse hooks:', error);
      }
    }

    // Parse MCP servers (.mcp.json)
    // Supports two formats:
    // 1. Wrapped: { "mcpServers": { "name": { ... } } }  (Claude Code standard)
    // 2. Flat:    { "name": { "command": "...", ... } }   (used by some official plugins)
    const mcpPath = path.join(pluginPath, '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mcpContent = fs.readFileSync(mcpPath, 'utf-8');
        const mcp = JSON.parse(mcpContent);
        const relativePath = path.relative(pluginPath, mcpPath);

        // Determine the server entries object
        let serverEntries: Record<string, any>;
        if (mcp.mcpServers && typeof mcp.mcpServers === 'object') {
          // Wrapped format: { "mcpServers": { ... } }
          serverEntries = mcp.mcpServers;
        } else {
          // Flat format: the entire object is server entries
          // Filter out non-server keys (e.g. "$schema")
          serverEntries = {};
          for (const [key, value] of Object.entries(mcp)) {
            if (key.startsWith('$')) continue; // Skip schema/metadata keys
            if (typeof value === 'object' && value !== null) {
              serverEntries[key] = value;
            }
          }
        }

        for (const [name, config] of Object.entries(serverEntries)) {
          components.mcpServers.push({
            type: 'mcp',
            name,
            path: mcpPath,
            relativePath,
            description: (config as any).description,
          });
        }
      } catch (error) {
        console.error('Failed to parse MCP config:', error);
      }
    }

    return components;
  }

  /**
   * Extract description from markdown file (from frontmatter or first paragraph)
   */
  private async extractDescription(filePath: string): Promise<string | undefined> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Try to extract from frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const descMatch = frontmatter.match(/description:\s*(.+)/);
        if (descMatch) {
          return descMatch[1].trim();
        }
      }
      
      // Try to extract first paragraph
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
          return trimmed;
        }
      }
    } catch (error) {
      console.error('Failed to extract description:', error);
    }
    
    return undefined;
  }

  /**
   * Get all files in plugin directory
   */
  private async getAllFiles(pluginPath: string, baseDir: string = pluginPath): Promise<PluginFile[]> {
    const files: PluginFile[] = [];
    
    try {
      const entries = fs.readdirSync(pluginPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(pluginPath, entry.name);
        const relativePath = path.relative(baseDir, fullPath);
        
        // Skip node_modules and hidden files (except .claude-plugin and .mcp.json)
        if (entry.name === 'node_modules' || 
            (entry.name.startsWith('.') && entry.name !== '.claude-plugin' && entry.name !== '.mcp.json')) {
          continue;
        }
        
        if (entry.isDirectory()) {
          files.push({
            path: fullPath,
            relativePath,
            type: 'directory',
          });
          
          // Recursively get files in subdirectory
          const subFiles = await this.getAllFiles(fullPath, baseDir);
          files.push(...subFiles);
        } else {
          const stats = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            relativePath,
            type: 'file',
            size: stats.size,
          });
        }
      }
    } catch (error) {
      console.error('Failed to read directory:', error);
    }
    
    return files;
  }

  /**
   * Read file content
   */
  async readFileContent(filePath: string): Promise<string> {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${filePath}`);
    }
  }

  /**
   * Read README file if exists
   */
  async readReadme(pluginPath: string): Promise<string | undefined> {
    const readmeNames = ['README.md', 'README.MD', 'readme.md', 'README', 'README.txt'];
    
    for (const name of readmeNames) {
      const readmePath = path.join(pluginPath, name);
      if (fs.existsSync(readmePath)) {
        try {
          return fs.readFileSync(readmePath, 'utf-8');
        } catch (error) {
          console.error('Failed to read README:', error);
        }
      }
    }
    
    return undefined;
  }

  /**
   * Validate plugin structure
   */
  async validatePlugin(pluginPath: string, pluginName?: string, marketplaceName?: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    
    // Check if directory exists
    if (!fs.existsSync(pluginPath)) {
      errors.push('Plugin directory does not exist');
      return { valid: false, errors };
    }
    
    // Try to read manifest using the same logic as readManifest
    try {
      await this.readManifest(pluginPath, pluginName, marketplaceName);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      } else {
        errors.push('Failed to read plugin manifest');
      }
      return { valid: false, errors };
    }
    
    return {
      valid: true,
      errors: [],
    };
  }
}

export const pluginParser = new PluginParser();

