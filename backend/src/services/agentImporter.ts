/**
 * Agent Importer Service
 * 
 * Imports AgentStudio-specific agents from marketplaces.
 * These agents are defined in marketplace.json under the 'agents' array
 * and are distinct from Claude Code's plugin agents (which are simple markdown files).
 */

import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths';
import { AgentConfig, BUILTIN_AGENTS } from '../types/agents';
import { MarketplaceManifest, MarketplaceAgent } from '../types/plugins';
import { AGENTS_DIR } from '../config/paths.js';

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

    if (!manifest || !manifest.agents || manifest.agents.length === 0) {
      return {
        marketplaceName,
        results: [],
        totalAgents: 0,
        importedCount: 0,
        errorCount: 0,
      };
    }

    for (const agentDef of manifest.agents) {
      const result = await this.importAgent(marketplaceName, agentDef);
      results.push(result);
    }

    const importedCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;

    console.info(`[AgentImporter] Imported ${importedCount}/${manifest.agents.length} agents from marketplace '${marketplaceName}'`);

    return {
      marketplaceName,
      results,
      totalAgents: manifest.agents.length,
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
      
      let agentConfig: Partial<AgentConfig>;

      // If source is provided, load from file
      if (agentDef.source && !agentDef.config) {
        const agentFilePath = path.resolve(marketplacePath, agentDef.source);
        
        if (!fs.existsSync(agentFilePath)) {
          return {
            success: false,
            error: `Agent file not found: ${agentFilePath}`,
          };
        }

        try {
          const content = fs.readFileSync(agentFilePath, 'utf-8');
          agentConfig = JSON.parse(content);
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
      
      // Check if agent already exists
      const existingAgentPath = path.join(AGENTS_DIR, `${agentId}.json`);
      if (fs.existsSync(existingAgentPath)) {
        // Check if it's a symlink (plugin-installed) or local
        try {
          const stats = fs.lstatSync(existingAgentPath);
          if (!stats.isSymbolicLink()) {
            // It's a local agent, don't overwrite
            return {
              success: false,
              agentId,
              agentName: agentConfig.name || agentDef.name,
              error: `Agent '${agentId}' already exists as a local agent`,
            };
          }
          // It's a symlink, we can update it
          fs.unlinkSync(existingAgentPath);
        } catch (error) {
          console.warn(`Failed to check existing agent ${agentId}:`, error);
        }
      }

      // Build complete agent config
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
        author: `Marketplace: ${marketplaceName}`,
        tags: agentConfig.tags || [],
        createdAt: now,
        updatedAt: now,
        enabled: true,
        source: 'plugin',
        installPath: path.resolve(marketplacePath, agentDef.source || ''),
      };

      // Save agent JSON to marketplace directory
      const marketplaceAgentPath = path.join(
        marketplacePath,
        '.claude-plugin',
        'agents',
        `${agentId}.json`
      );
      
      // Ensure directory exists
      const agentDir = path.dirname(marketplaceAgentPath);
      if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
      }

      // Write agent config
      fs.writeFileSync(marketplaceAgentPath, JSON.stringify(completeAgent, null, 2));

      // Create symlink in agents directory
      try {
        fs.symlinkSync(marketplaceAgentPath, existingAgentPath);
        console.info(`[AgentImporter] Created symlink for agent '${agentId}' from marketplace '${marketplaceName}'`);
      } catch (error) {
        // If symlink fails, copy the file instead
        console.warn(`[AgentImporter] Failed to create symlink for agent '${agentId}', copying instead:`, error);
        fs.copyFileSync(marketplaceAgentPath, existingAgentPath);
      }

      return {
        success: true,
        agentId,
        agentName: completeAgent.name,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Uninstall an agent (remove symlink)
   */
  async uninstallAgent(agentId: string): Promise<boolean> {
    try {
      const agentPath = path.join(AGENTS_DIR, `${agentId}.json`);
      
      if (!fs.existsSync(agentPath)) {
        return false;
      }

      // Check if it's a built-in agent
      if (BUILTIN_AGENTS.some(builtin => builtin.id === agentId)) {
        console.warn(`[AgentImporter] Cannot uninstall built-in agent '${agentId}'`);
        return false;
      }

      // Check if it's a plugin-installed agent (symlink)
      const stats = fs.lstatSync(agentPath);
      if (!stats.isSymbolicLink()) {
        console.warn(`[AgentImporter] Agent '${agentId}' is not a plugin-installed agent`);
        return false;
      }

      fs.unlinkSync(agentPath);
      console.info(`[AgentImporter] Uninstalled agent '${agentId}'`);
      return true;
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
   * Get installed agents from a specific marketplace
   */
  async getInstalledAgentsFromMarketplace(marketplaceName: string): Promise<string[]> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const agentFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'));
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
            installedAgents.push(file.replace('.json', ''));
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return installedAgents;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

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
