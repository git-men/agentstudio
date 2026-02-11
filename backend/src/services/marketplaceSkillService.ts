/**
 * Marketplace Skill Service
 * 
 * Provides skill-level management for marketplace plugins.
 * Unlike the plugin-level enable/disable (which toggles all components at once),
 * this service allows enabling/disabling individual skills within plugins.
 * 
 * Key concepts:
 * - Skills are grouped by plugin name (plugin acts as category/group)
 * - Each skill can be independently enabled/disabled via symlink/copy management
 * - The "enabled" state is determined by whether the skill exists in the target directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths';
import { pluginParser } from './pluginParser';
import { pluginScanner } from './pluginScanner';
import { getEnginePaths, isCursorEngine } from '../config/engineConfig';
import type { PluginComponent } from '../types/plugins';

// ============================================
// Types
// ============================================

export interface MarketplaceSkillItem {
  /** Unique skill ID: marketplaceName/pluginName/skillName */
  id: string;
  /** Skill directory name */
  name: string;
  /** Skill description (from SKILL.md frontmatter) */
  description?: string;
  /** Whether the skill is currently installed/enabled */
  enabled: boolean;
  /** Plugin name this skill belongs to */
  pluginName: string;
  /** Marketplace name */
  marketplaceName: string;
  /** Full path to skill source directory */
  sourcePath: string;
}

export interface MarketplaceSkillGroup {
  /** Group name (typically plugin name or description) */
  name: string;
  /** Plugin name for API identification */
  pluginName: string;
  /** Marketplace name */
  marketplaceName: string;
  /** Plugin description */
  description?: string;
  /** Total skills in this group */
  totalCount: number;
  /** Number of enabled skills in this group */
  enabledCount: number;
  /** All skills in this group */
  skills: MarketplaceSkillItem[];
}

export interface MarketplaceSkillsResponse {
  /** Total skill count across all groups */
  totalCount: number;
  /** Total enabled skill count */
  enabledCount: number;
  /** Skills grouped by plugin */
  groups: MarketplaceSkillGroup[];
}

export interface SkillToggleResult {
  success: boolean;
  skillId: string;
  enabled: boolean;
  error?: string;
}

export interface BatchToggleRequest {
  actions: Array<{
    skillId: string;
    enabled: boolean;
  }>;
}

export interface BatchToggleResult {
  results: SkillToggleResult[];
  successCount: number;
  failCount: number;
}

// ============================================
// Service Implementation
// ============================================

class MarketplaceSkillService {
  /**
   * Get all marketplace skills grouped by plugin.
   * Scans all marketplaces, parses plugins, extracts skills,
   * and checks which ones are currently installed.
   */
  async getGroupedSkills(search?: string): Promise<MarketplaceSkillsResponse> {
    const marketplaceNames = pluginPaths.listMarketplaces();
    const groups: MarketplaceSkillGroup[] = [];
    let totalCount = 0;
    let enabledCount = 0;

    for (const marketplaceName of marketplaceNames) {
      const pluginNames = pluginPaths.listPlugins(marketplaceName);

      for (const pluginName of pluginNames) {
        try {
          const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);
          const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);

          // Skip plugins with no skills
          if (parsedPlugin.components.skills.length === 0) {
            continue;
          }

          const skills: MarketplaceSkillItem[] = [];

          for (const skillComponent of parsedPlugin.components.skills) {
            const skillDir = path.dirname(skillComponent.path); // Remove SKILL.md
            const skillName = skillComponent.name;
            const skillId = `${marketplaceName}/${pluginName}/${skillName}`;
            const isEnabled = this.isSkillInstalled(skillName);

            // Apply search filter
            if (search) {
              const searchLower = search.toLowerCase();
              const matchesName = skillName.toLowerCase().includes(searchLower);
              const matchesDesc = skillComponent.description?.toLowerCase().includes(searchLower);
              const matchesPlugin = pluginName.toLowerCase().includes(searchLower);
              const matchesMarketplace = marketplaceName.toLowerCase().includes(searchLower);
              if (!matchesName && !matchesDesc && !matchesPlugin && !matchesMarketplace) {
                continue;
              }
            }

            skills.push({
              id: skillId,
              name: skillName,
              description: skillComponent.description,
              enabled: isEnabled,
              pluginName,
              marketplaceName,
              sourcePath: skillDir,
            });

            totalCount++;
            if (isEnabled) enabledCount++;
          }

          // Skip groups with no matching skills (after search filter)
          if (skills.length === 0) continue;

          // Use plugin manifest description as group name, fallback to plugin name
          const groupName = parsedPlugin.manifest.description || parsedPlugin.manifest.name || pluginName;
          const groupEnabledCount = skills.filter(s => s.enabled).length;

          groups.push({
            name: groupName,
            pluginName,
            marketplaceName,
            description: parsedPlugin.manifest.description,
            totalCount: skills.length,
            enabledCount: groupEnabledCount,
            skills,
          });
        } catch (error) {
          console.error(`Failed to parse plugin ${pluginName} in ${marketplaceName}:`, error);
        }
      }
    }

    return {
      totalCount,
      enabledCount,
      groups,
    };
  }

  /**
   * Enable a single skill by creating its symlink or copying its files.
   */
  async enableSkill(skillId: string): Promise<SkillToggleResult> {
    try {
      const { marketplaceName, pluginName, skillName } = this.parseSkillId(skillId);
      const skillComponent = await this.findSkillComponent(marketplaceName, pluginName, skillName);

      if (!skillComponent) {
        return { success: false, skillId, enabled: false, error: 'Skill not found' };
      }

      const skillSourceDir = path.dirname(skillComponent.path);
      const targetDir = this.getSkillTargetPath(skillName);

      if (isCursorEngine()) {
        // Copy mode: copy skill directory
        this.ensureDir(path.dirname(targetDir));
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        fs.cpSync(skillSourceDir, targetDir, { recursive: true });
        console.log(`[MarketplaceSkillService] Skill enabled (copy): ${skillName} -> ${targetDir}`);
      } else {
        // Symlink mode: create symlink
        this.ensureDir(path.dirname(targetDir));
        if (fs.existsSync(targetDir)) {
          const stats = fs.lstatSync(targetDir);
          if (stats.isSymbolicLink()) {
            fs.unlinkSync(targetDir);
          } else {
            return { 
              success: false, 
              skillId, 
              enabled: false, 
              error: 'Target path exists and is not a symlink' 
            };
          }
        }
        fs.symlinkSync(skillSourceDir, targetDir);
        console.log(`[MarketplaceSkillService] Skill enabled (symlink): ${skillName} -> ${skillSourceDir}`);
      }

      return { success: true, skillId, enabled: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[MarketplaceSkillService] Failed to enable skill ${skillId}:`, error);
      return { success: false, skillId, enabled: false, error: errorMessage };
    }
  }

  /**
   * Disable a single skill by removing its symlink or deleting its copied files.
   */
  async disableSkill(skillId: string): Promise<SkillToggleResult> {
    try {
      const { skillName } = this.parseSkillId(skillId);
      const targetDir = this.getSkillTargetPath(skillName);

      if (!fs.existsSync(targetDir)) {
        // Already disabled
        return { success: true, skillId, enabled: false };
      }

      if (isCursorEngine()) {
        // Copy mode: remove directory
        fs.rmSync(targetDir, { recursive: true, force: true });
        console.log(`[MarketplaceSkillService] Skill disabled (removed): ${skillName}`);
      } else {
        // Symlink mode: remove symlink
        const stats = fs.lstatSync(targetDir);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(targetDir);
          console.log(`[MarketplaceSkillService] Skill disabled (unlinked): ${skillName}`);
        } else {
          // It's a regular directory (user-created skill), don't remove
          return {
            success: false,
            skillId,
            enabled: true,
            error: 'Cannot disable user-created skill via marketplace API',
          };
        }
      }

      return { success: true, skillId, enabled: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[MarketplaceSkillService] Failed to disable skill ${skillId}:`, error);
      return { success: false, skillId, enabled: true, error: errorMessage };
    }
  }

  /**
   * Toggle a skill's enabled state.
   */
  async toggleSkill(skillId: string, enabled: boolean): Promise<SkillToggleResult> {
    return enabled ? this.enableSkill(skillId) : this.disableSkill(skillId);
  }

  /**
   * Batch toggle multiple skills.
   */
  async batchToggle(request: BatchToggleRequest): Promise<BatchToggleResult> {
    const results: SkillToggleResult[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const action of request.actions) {
      const result = await this.toggleSkill(action.skillId, action.enabled);
      results.push(result);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    return { results, successCount, failCount };
  }

  /**
   * Enable all skills in a plugin group.
   */
  async enableAllInGroup(marketplaceName: string, pluginName: string): Promise<BatchToggleResult> {
    const skills = await this.getPluginSkills(marketplaceName, pluginName);
    const request: BatchToggleRequest = {
      actions: skills.map(s => ({ skillId: s.id, enabled: true })),
    };
    return this.batchToggle(request);
  }

  /**
   * Disable all skills in a plugin group.
   */
  async disableAllInGroup(marketplaceName: string, pluginName: string): Promise<BatchToggleResult> {
    const skills = await this.getPluginSkills(marketplaceName, pluginName);
    const request: BatchToggleRequest = {
      actions: skills.map(s => ({ skillId: s.id, enabled: false })),
    };
    return this.batchToggle(request);
  }

  // ============================================
  // Private helpers
  // ============================================

  /**
   * Parse a skill ID into its components.
   * Format: marketplaceName/pluginName/skillName
   */
  private parseSkillId(skillId: string): {
    marketplaceName: string;
    pluginName: string;
    skillName: string;
  } {
    const parts = skillId.split('/');
    if (parts.length !== 3) {
      throw new Error(`Invalid skill ID format: ${skillId}. Expected: marketplaceName/pluginName/skillName`);
    }
    return {
      marketplaceName: parts[0],
      pluginName: parts[1],
      skillName: parts[2],
    };
  }

  /**
   * Find a specific skill component from a plugin.
   */
  private async findSkillComponent(
    marketplaceName: string,
    pluginName: string,
    skillName: string
  ): Promise<PluginComponent | null> {
    try {
      const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);
      const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);
      return parsedPlugin.components.skills.find(s => s.name === skillName) || null;
    } catch (error) {
      console.error(`Failed to find skill ${skillName} in ${marketplaceName}/${pluginName}:`, error);
      return null;
    }
  }

  /**
   * Get all skills from a specific plugin.
   */
  private async getPluginSkills(
    marketplaceName: string,
    pluginName: string
  ): Promise<MarketplaceSkillItem[]> {
    try {
      const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);
      const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);

      return parsedPlugin.components.skills.map(skillComponent => {
        const skillDir = path.dirname(skillComponent.path);
        const skillName = skillComponent.name;
        const skillId = `${marketplaceName}/${pluginName}/${skillName}`;
        const isEnabled = this.isSkillInstalled(skillName);

        return {
          id: skillId,
          name: skillName,
          description: skillComponent.description,
          enabled: isEnabled,
          pluginName,
          marketplaceName,
          sourcePath: skillDir,
        };
      });
    } catch (error) {
      console.error(`Failed to get skills for ${marketplaceName}/${pluginName}:`, error);
      return [];
    }
  }

  /**
   * Check if a skill is currently installed in the target directory.
   */
  private isSkillInstalled(skillName: string): boolean {
    const targetPath = this.getSkillTargetPath(skillName);
    return fs.existsSync(targetPath);
  }

  /**
   * Get the target path where a skill should be installed.
   */
  private getSkillTargetPath(skillName: string): string {
    const paths = getEnginePaths();
    // For cursor-cli, prefer builtinSkillsDir if available
    const skillsDir = (isCursorEngine() && paths.builtinSkillsDir) 
      ? paths.builtinSkillsDir 
      : paths.skillsDir;
    return path.join(skillsDir, skillName);
  }

  /**
   * Ensure a directory exists.
   */
  private ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}

export const marketplaceSkillService = new MarketplaceSkillService();
