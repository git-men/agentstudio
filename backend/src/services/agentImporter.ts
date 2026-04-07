/**
 * Agent Importer Service
 * 
 * Imports AgentStudio-specific agents from marketplaces.
 * Supports two agent definition formats:
 * - JSON: traditional agent.json with full AgentConfig fields
 * - Markdown: agent.md with YAML frontmatter (config) + markdown body (system prompt)
 *
 * These agents are distinct from Claude Code's native plugin agents (plain .md files
 * without frontmatter that get symlinked to ~/.claude/agents/).
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { pluginPaths } from './pluginPaths';
import { AgentConfig, BUILTIN_AGENTS } from '../types/agents';
import { MarketplaceManifest, MarketplaceAgent } from '../types/plugins';
import { AGENTS_DIR } from '../config/paths.js';
import { robustSymlinkSync } from '../utils/fileUtils.js';

/**
 * Parse an agent definition from a .md file with YAML frontmatter.
 *
 * Format:
 * ```
 * ---
 * id: my-agent
 * name: My Agent
 * description: ...
 * permissionMode: acceptEdits
 * maxTurns: 25
 * allowedTools:
 *   - { name: Read, enabled: true }
 * ui:
 *   icon: 🤖
 *   headerTitle: My Agent
 * ---
 * System prompt markdown content here...
 * ```
 */
function parseAgentMd(content: string): Partial<AgentConfig> | null {
  try {
    const parsed = matter(content);
    const frontmatter = parsed.data as Record<string, unknown>;
    const markdownBody = parsed.content.trim();

    if (!frontmatter || Object.keys(frontmatter).length === 0) {
      return null;
    }

    // Determine systemPrompt based on preset mode:
    //   preset: claude_code   →  { type: 'preset', preset: 'claude_code', append: markdownBody }
    //   (no preset)           →  markdownBody as full replacement string (legacy behavior)
    let systemPrompt: any;
    const preset = frontmatter.preset as string | undefined;
    if (preset) {
      systemPrompt = { type: 'preset', preset, ...(markdownBody ? { append: markdownBody } : {}) };
    } else {
      systemPrompt = markdownBody || (frontmatter.systemPrompt as string);
    }

    const { preset: _preset, ...restFrontmatter } = frontmatter;
    const agentConfig: Partial<AgentConfig> = {
      ...restFrontmatter as Partial<AgentConfig>,
      systemPrompt,
    };

    return agentConfig;
  } catch {
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface AgentImportResult {
  success: boolean;
  agentId?: string;
  agentName?: string;
  error?: string;
}

export interface MarketplaceAgentImportResult {
  marketplaceName: string;
  results: AgentImportResult[];
  totalAgents: number;
  importedCount: number;
  errorCount: number;
}

// ============================================================================
// Agent Importer Service
// ============================================================================

class AgentImporter {
  /**
   * Import all agents from a marketplace
   */
  async importAgentsFromMarketplace(marketplaceName: string): Promise<MarketplaceAgentImportResult> {
    const results: AgentImportResult[] = [];
    const manifest = await this.loadMarketplaceManifest(marketplaceName);

    // Try manifest-based import first
    let agentDefs: MarketplaceAgent[] = manifest?.agents || [];

    // Fallback: if no agents in manifest, scan marketplace directory for */agent.json files
    if (agentDefs.length === 0) {
      agentDefs = this.scanAgentFiles(marketplaceName);
      if (agentDefs.length > 0) {
        console.info(`[AgentImporter] Discovered ${agentDefs.length} agent(s) by scanning directory for '${marketplaceName}'`);
      }
    }

    // Fallback 2: scan inside plugins/*/agents/ directories
    if (agentDefs.length === 0) {
      agentDefs = this.scanPluginAgentFiles(marketplaceName);
      if (agentDefs.length > 0) {
        console.info(`[AgentImporter] Discovered ${agentDefs.length} agent(s) by scanning plugin directories for '${marketplaceName}'`);
      }
    }

    if (agentDefs.length === 0) {
      return {
        marketplaceName,
        results: [],
        totalAgents: 0,
        importedCount: 0,
        errorCount: 0,
      };
    }

    for (const agentDef of agentDefs) {
      const result = await this.importAgent(marketplaceName, agentDef);
      results.push(result);
    }

    const importedCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    console.info(`[AgentImporter] Imported ${importedCount}/${agentDefs.length} agents from marketplace '${marketplaceName}'`);

    return {
      marketplaceName,
      results,
      totalAgents: agentDefs.length,
      importedCount,
      errorCount,
    };
  }

  /**
   * Import a single agent from a marketplace
   */
  async importAgent(marketplaceName: string, agentDef: MarketplaceAgent): Promise<AgentImportResult> {
    try {
      const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);

      // Resolve source path — manifests may use "source" or "path" interchangeably
      const agentSource = agentDef.source || agentDef.path;
      // Resolved absolute path to the source file (null for inline-config agents)
      let agentFilePath: string | null = null;

      let agentConfig: Partial<AgentConfig>;

      // If source is provided, load from file
      if (agentSource && !agentDef.config) {
        agentFilePath = path.resolve(marketplacePath, agentSource);

        if (!fs.existsSync(agentFilePath)) {
          return {
            success: false,
            error: `Agent file not found: ${agentFilePath}`,
          };
        }

        try {
          const content = fs.readFileSync(agentFilePath, 'utf-8');
          if (agentFilePath.endsWith('.md')) {
            // Markdown format: YAML frontmatter + markdown body as system prompt
            const parsed = parseAgentMd(content);
            if (!parsed) {
              return {
                success: false,
                error: `Failed to parse agent .md file: no YAML frontmatter found in ${agentFilePath}`,
              };
            }
            agentConfig = parsed;
          } else {
            agentConfig = JSON.parse(content);
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to parse agent file: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      } else if (agentDef.config) {
        // Use inline config
        agentConfig = this.convertMarketplaceAgentConfig(agentDef);
      } else {
        return {
          success: false,
          error: 'Agent definition must have either source or config',
        };
      }

      // Generate agent ID from name if not provided
      const agentId = agentConfig.id || this.generateAgentId(agentDef.name);

      // For .md source files: symlink directly to the .md source (no compilation)
      // For .json source files: compile to .claude-plugin/agents/{id}.json then symlink
      const isMdSource = agentFilePath ? agentFilePath.endsWith('.md') : false;

      // Remove any existing link/copy for this agent (both .json and .md variants)
      for (const ext of ['.json', '.md']) {
        const candidate = path.join(AGENTS_DIR, `${agentId}${ext}`);
        if (fs.existsSync(candidate) || this.isDeadSymlink(candidate)) {
          try {
            const stats = fs.lstatSync(candidate);
            if (stats.isSymbolicLink() || stats.isFile()) {
              fs.unlinkSync(candidate);
            }
          } catch {
            try { fs.unlinkSync(candidate); } catch { /* ignore */ }
          }
        }
      }

      let symlinkTarget: string;
      let symlinkDest: string;

      if (isMdSource && agentFilePath) {
        // .md source: symlink {AGENTS_DIR}/{id}.md → absolute path of the .md file
        symlinkTarget = agentFilePath;
        symlinkDest = path.join(AGENTS_DIR, `${agentId}.md`);
      } else {
        // .json source (or inline config): compile to .claude-plugin/agents/{id}.json
        const now = new Date().toISOString();
        const completeAgent: AgentConfig = {
          id: agentId,
          name: agentDef.name,
          description: agentDef.description || agentConfig.description || '',
          version: agentDef.version || agentConfig.version || '1.0.0',
          systemPrompt: agentConfig.systemPrompt || { type: 'preset', preset: 'claude_code' },
          maxTurns: agentConfig.maxTurns,
          permissionMode: (agentConfig.permissionMode as any) || 'acceptEdits',
          allowedTools: agentConfig.allowedTools || [],
          ui: agentConfig.ui || {
            icon: '🤖',
            headerTitle: agentDef.name,
            headerDescription: agentDef.description || '',
          },
          workingDirectory: agentConfig.workingDirectory,
          dataDirectory: agentConfig.dataDirectory,
          fileTypes: agentConfig.fileTypes,
          author: `Marketplace: ${marketplaceName}`,
          tags: agentConfig.tags || [],
          hooks: agentConfig.hooks || {},
          createdAt: now,
          updatedAt: now,
          enabled: true,
          source: 'plugin',
          installPath: path.resolve(marketplacePath, agentSource || ''),
        };

        const compiledPath = path.join(marketplacePath, '.claude-plugin', 'agents', `${agentId}.json`);
        fs.mkdirSync(path.dirname(compiledPath), { recursive: true });
        fs.writeFileSync(compiledPath, JSON.stringify(completeAgent, null, 2));

        symlinkTarget = compiledPath;
        symlinkDest = path.join(AGENTS_DIR, `${agentId}.json`);
      }

      const method = robustSymlinkSync(symlinkTarget, symlinkDest);
      console.info(`[AgentImporter] Linked agent '${agentId}' [${method}] → ${symlinkTarget}`);

      // Sync LAVS assets if the agent source lives in a directory with lavs.json
      if (agentFilePath) {
        const sourceDir = path.dirname(agentFilePath);
        const lavsManifest = path.join(sourceDir, 'lavs.json');
        if (fs.existsSync(lavsManifest)) {
          const destDir = path.join(AGENTS_DIR, agentId);
          if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true });
          }
          this.copyDirectory(sourceDir, destDir);
          console.info(`[AgentImporter] Synced LAVS assets for '${agentId}' → ${destDir}`);
        }
      }

      return {
        success: true,
        agentId,
        agentName: agentConfig.name || agentDef.name,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Uninstall an agent (remove symlink) — checks both .json and .md variants.
   */
  async uninstallAgent(agentId: string): Promise<boolean> {
    try {
      // Check if it's a built-in agent
      if (BUILTIN_AGENTS.some(builtin => builtin.id === agentId)) {
        console.warn(`[AgentImporter] Cannot uninstall built-in agent '${agentId}'`);
        return false;
      }

      let removed = false;
      for (const ext of ['.json', '.md']) {
        const agentPath = path.join(AGENTS_DIR, `${agentId}${ext}`);
        let stats: fs.Stats | null = null;
        try { stats = fs.lstatSync(agentPath); } catch { continue; }

        if (stats.isSymbolicLink() || stats.isFile()) {
          fs.unlinkSync(agentPath);
          console.info(`[AgentImporter] Uninstalled agent '${agentId}${ext}' [${stats.isSymbolicLink() ? 'symlink' : 'file'}]`);
          removed = true;
        } else {
          console.warn(`[AgentImporter] Agent '${agentId}${ext}' is not a file/symlink, skipping`);
        }
      }
      return removed;
    } catch (error) {
      console.error(`[AgentImporter] Failed to uninstall agent '${agentId}':`, error);
      return false;
    }
  }

  /**
   * Uninstall all agents from a marketplace
   */
  async uninstallMarketplaceAgents(marketplaceName: string): Promise<number> {
    const manifest = await this.loadMarketplaceManifest(marketplaceName);
    
    if (!manifest || !manifest.agents) {
      return 0;
    }

    let uninstalledCount = 0;
    for (const agentDef of manifest.agents) {
      const agentId = this.generateAgentId(agentDef.name);
      if (await this.uninstallAgent(agentId)) {
        uninstalledCount++;
      }
    }

    console.info(`[AgentImporter] Uninstalled ${uninstalledCount} agents from marketplace '${marketplaceName}'`);
    return uninstalledCount;
  }

  /**
   * List agents available in a marketplace
   */
  async listMarketplaceAgents(marketplaceName: string): Promise<MarketplaceAgent[]> {
    const manifest = await this.loadMarketplaceManifest(marketplaceName);
    return manifest?.agents || [];
  }

  /**
   * Get installed agents from a specific marketplace.
   * Checks both .json and .md symlinks.
   */
  async getInstalledAgentsFromMarketplace(marketplaceName: string): Promise<string[]> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const agentFiles = fs.readdirSync(AGENTS_DIR)
      .filter(f => f.endsWith('.json') || f.endsWith('.md'));
    const installedAgents: string[] = [];

    for (const file of agentFiles) {
      const filePath = path.join(AGENTS_DIR, file);
      try {
        const stats = fs.lstatSync(filePath);
        if (stats.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(filePath);
          const realPath = path.isAbsolute(linkTarget)
            ? linkTarget
            : path.resolve(path.dirname(filePath), linkTarget);

          if (realPath.startsWith(marketplacePath)) {
            const ext = file.endsWith('.json') ? '.json' : '.md';
            installedAgents.push(file.slice(0, -ext.length));
          }
        } else if (stats.isFile()) {
          // Copy-fallback: check file content for marketplace origin
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (file.endsWith('.json')) {
              const parsed = JSON.parse(content);
              if (parsed.installPath && parsed.installPath.includes(marketplaceName)) {
                installedAgents.push(file.slice(0, -'.json'.length));
              } else if (parsed.author && parsed.author.includes(marketplaceName)) {
                installedAgents.push(file.slice(0, -'.json'.length));
              }
            } else if (file.endsWith('.md')) {
              // .md files copied from marketplace — check if source exists in marketplace
              const agentId = file.slice(0, -'.md'.length);
              const agentDir = path.join(marketplacePath, 'agents', agentId);
              if (fs.existsSync(agentDir)) {
                installedAgents.push(agentId);
              }
            }
          } catch { /* content check failed, skip */ }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return installedAgents;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Scan marketplace agents/ directory for agent definitions.
   *
   * Supports three layouts:
   *   1. {agents}/{name}.md               — single-file .md agent
   *   2. {agents}/{name}/agent.json        — directory with agent.json
   *   3. {agents}/{name}/{name}.md         — directory with <name>.md (new convention)
   *
   * This is a fallback when the marketplace manifest does not declare agents.
   */
  private scanAgentFiles(marketplaceName: string): MarketplaceAgent[] {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const agentsDir = path.join(marketplacePath, 'agents');
    if (!fs.existsSync(agentsDir)) {
      return [];
    }

    const agents: MarketplaceAgent[] = [];
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        // Layout 1: single-file .md agent
        if (!entry.isDirectory() && entry.name.endsWith('.md')) {
          const mdPath = path.join(agentsDir, entry.name);
          try {
            const content = fs.readFileSync(mdPath, 'utf-8');
            const parsed = parseAgentMd(content);
            if (parsed) {
              agents.push({
                name: (parsed as any).name || entry.name.slice(0, -3),
                source: `agents/${entry.name}`,
                description: (parsed as any).description,
                version: (parsed as any).version,
              });
            }
          } catch (parseError) {
            console.warn(`[AgentImporter] Failed to parse ${mdPath}:`, parseError);
          }
          continue;
        }

        if (!entry.isDirectory()) continue;
        const entryPath = path.join(agentsDir, entry.name);

        // Layout 2: {name}/agent.json
        const agentJsonPath = path.join(entryPath, 'agent.json');
        if (fs.existsSync(agentJsonPath)) {
          try {
            const content = fs.readFileSync(agentJsonPath, 'utf-8');
            const agentConfig = JSON.parse(content);
            agents.push({
              name: agentConfig.name || entry.name,
              source: `agents/${entry.name}/agent.json`,
              description: agentConfig.description,
              version: agentConfig.version,
            });
          } catch (parseError) {
            console.warn(`[AgentImporter] Failed to parse ${agentJsonPath}:`, parseError);
          }
          continue;
        }

        // Layout 3: {name}/{name}.md
        const agentMdPath = path.join(entryPath, `${entry.name}.md`);
        if (fs.existsSync(agentMdPath)) {
          try {
            const content = fs.readFileSync(agentMdPath, 'utf-8');
            const parsed = parseAgentMd(content);
            if (parsed) {
              agents.push({
                name: (parsed as any).name || entry.name,
                source: `agents/${entry.name}/${entry.name}.md`,
                description: (parsed as any).description,
                version: (parsed as any).version,
              });
            }
          } catch (parseError) {
            console.warn(`[AgentImporter] Failed to parse ${agentMdPath}:`, parseError);
          }
          continue;
        }

        // Layout 4: {name}/agent.md
        const agentMdGenericPath = path.join(entryPath, 'agent.md');
        if (fs.existsSync(agentMdGenericPath)) {
          try {
            const content = fs.readFileSync(agentMdGenericPath, 'utf-8');
            const parsed = parseAgentMd(content);
            if (parsed) {
              agents.push({
                name: (parsed as any).name || entry.name,
                source: `agents/${entry.name}/agent.md`,
                description: (parsed as any).description,
                version: (parsed as any).version,
              });
            }
          } catch (parseError) {
            console.warn(`[AgentImporter] Failed to parse ${agentMdGenericPath}:`, parseError);
          }
        }
      }
    } catch (error) {
      console.warn(`[AgentImporter] Failed to scan agent files for '${marketplaceName}':`, error);
    }

    return agents;
  }

  /**
   * Scan agents/ directories inside each plugin of a marketplace.
   * Reuses the same layout detection as scanAgentFiles but scoped to plugins/{name}/agents/.
   */
  private scanPluginAgentFiles(marketplaceName: string): MarketplaceAgent[] {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const pluginsDir = path.join(marketplacePath, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      return [];
    }

    const agents: MarketplaceAgent[] = [];
    try {
      const pluginEntries = fs.readdirSync(pluginsDir, { withFileTypes: true });
      for (const pluginEntry of pluginEntries) {
        if (!pluginEntry.isDirectory() || pluginEntry.name.startsWith('.')) continue;

        const agentsDir = path.join(pluginsDir, pluginEntry.name, 'agents');
        if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) continue;

        const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;

          // Layout 1: single-file .md agent
          if (!entry.isDirectory() && entry.name.endsWith('.md')) {
            const mdPath = path.join(agentsDir, entry.name);
            try {
              const content = fs.readFileSync(mdPath, 'utf-8');
              const parsed = parseAgentMd(content);
              if (parsed) {
                agents.push({
                  name: (parsed as any).name || entry.name.slice(0, -3),
                  source: `plugins/${pluginEntry.name}/agents/${entry.name}`,
                  description: (parsed as any).description,
                  version: (parsed as any).version,
                });
              }
            } catch (parseError) {
              console.warn(`[AgentImporter] Failed to parse ${mdPath}:`, parseError);
            }
            continue;
          }

          if (!entry.isDirectory()) continue;
          const entryPath = path.join(agentsDir, entry.name);
          const relPrefix = `plugins/${pluginEntry.name}/agents/${entry.name}`;

          // Layout 2: {name}/agent.json
          const agentJsonPath = path.join(entryPath, 'agent.json');
          if (fs.existsSync(agentJsonPath)) {
            try {
              const content = fs.readFileSync(agentJsonPath, 'utf-8');
              const agentConfig = JSON.parse(content);
              agents.push({
                name: agentConfig.name || entry.name,
                source: `${relPrefix}/agent.json`,
                description: agentConfig.description,
                version: agentConfig.version,
              });
            } catch (parseError) {
              console.warn(`[AgentImporter] Failed to parse ${agentJsonPath}:`, parseError);
            }
            continue;
          }

          // Layout 3: {name}/{name}.md
          const namedMdPath = path.join(entryPath, `${entry.name}.md`);
          if (fs.existsSync(namedMdPath)) {
            try {
              const content = fs.readFileSync(namedMdPath, 'utf-8');
              const parsed = parseAgentMd(content);
              if (parsed) {
                agents.push({
                  name: (parsed as any).name || entry.name,
                  source: `${relPrefix}/${entry.name}.md`,
                  description: (parsed as any).description,
                  version: (parsed as any).version,
                });
              }
            } catch (parseError) {
              console.warn(`[AgentImporter] Failed to parse ${namedMdPath}:`, parseError);
            }
            continue;
          }

          // Layout 4: {name}/agent.md
          const agentMdPath = path.join(entryPath, 'agent.md');
          if (fs.existsSync(agentMdPath)) {
            try {
              const content = fs.readFileSync(agentMdPath, 'utf-8');
              const parsed = parseAgentMd(content);
              if (parsed) {
                agents.push({
                  name: (parsed as any).name || entry.name,
                  source: `${relPrefix}/agent.md`,
                  description: (parsed as any).description,
                  version: (parsed as any).version,
                });
              }
            } catch (parseError) {
              console.warn(`[AgentImporter] Failed to parse ${agentMdPath}:`, parseError);
            }
          }
        }
      }
    } catch (error) {
      console.warn(`[AgentImporter] Failed to scan plugin agent files for '${marketplaceName}':`, error);
    }

    return agents;
  }

  private copyDirectory(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith('.md')) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /** Check if a path is a dead (dangling) symlink */
  private isDeadSymlink(filePath: string): boolean {
    try {
      fs.lstatSync(filePath); // succeeds for symlinks even if target missing
      fs.statSync(filePath);  // follows the link; throws if target missing
      return false;
    } catch {
      try {
        return fs.lstatSync(filePath).isSymbolicLink();
      } catch {
        return false;
      }
    }
  }

  /**
   * Load marketplace manifest
   */
  private async loadMarketplaceManifest(marketplaceName: string): Promise<MarketplaceManifest | null> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const manifestPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');

    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`[AgentImporter] Failed to load marketplace manifest for '${marketplaceName}':`, error);
      return null;
    }
  }

  /**
   * Convert marketplace agent config to AgentConfig format
   */
  private convertMarketplaceAgentConfig(agentDef: MarketplaceAgent): Partial<AgentConfig> {
    const config = agentDef.config;
    if (!config) {
      return {};
    }

    return {
      systemPrompt: config.systemPrompt as any,
      permissionMode: config.permissionMode as any,
      maxTurns: config.maxTurns,
      allowedTools: config.allowedTools,
      ui: config.ui ? {
        icon: config.ui.icon || '🤖',
        headerTitle: config.ui.headerTitle || agentDef.name,
        headerDescription: config.ui.headerDescription || agentDef.description || '',
        welcomeMessage: config.ui.welcomeMessage,
      } : undefined,
      tags: config.tags,
    };
  }

  /**
   * Generate agent ID from name
   */
  private generateAgentId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}

export const agentImporter = new AgentImporter();
