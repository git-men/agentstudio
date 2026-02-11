/**
 * Marketplace Skills API Client
 * 
 * Provides methods for managing marketplace skills:
 * - List skills grouped by plugin/category
 * - Toggle individual skill enable/disable
 * - Batch toggle multiple skills
 * - Enable/disable all skills in a group
 */

import { getApiBase } from '../lib/config';
import { authFetch } from '../lib/authFetch';

// ============================================
// Types
// ============================================

export interface MarketplaceSkillItem {
  /** Unique skill ID: marketplaceName/pluginName/skillName */
  id: string;
  /** Skill directory name */
  name: string;
  /** Skill description */
  description?: string;
  /** Whether the skill is currently installed/enabled */
  enabled: boolean;
  /** Plugin name this skill belongs to */
  pluginName: string;
  /** Marketplace name */
  marketplaceName: string;
}

export interface MarketplaceSkillGroup {
  /** Group name (typically plugin description or name) */
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
  totalCount: number;
  enabledCount: number;
  groups: MarketplaceSkillGroup[];
}

export interface SkillToggleResult {
  success: boolean;
  skillId: string;
  enabled: boolean;
  error?: string;
}

export interface BatchToggleResult {
  results: SkillToggleResult[];
  successCount: number;
  failCount: number;
  message?: string;
}

// ============================================
// API Client
// ============================================

class MarketplaceSkillsAPI {
  private baseURL = `${getApiBase()}/marketplace-skills`;

  /**
   * Get all marketplace skills grouped by plugin.
   */
  async getGroupedSkills(search?: string): Promise<MarketplaceSkillsResponse> {
    const params = new URLSearchParams();
    if (search) params.append('search', search);

    const url = params.toString()
      ? `${this.baseURL}?${params.toString()}`
      : this.baseURL;

    const response = await authFetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch marketplace skills: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Toggle a single skill's enabled state.
   */
  async toggleSkill(skillId: string, enabled: boolean): Promise<SkillToggleResult> {
    const response = await authFetch(`${this.baseURL}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId, enabled }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to toggle skill: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Batch toggle multiple skills.
   */
  async batchToggle(
    actions: Array<{ skillId: string; enabled: boolean }>
  ): Promise<BatchToggleResult> {
    const response = await authFetch(`${this.baseURL}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to batch toggle skills: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Enable all skills in a plugin group.
   */
  async enableAllInGroup(
    marketplaceName: string,
    pluginName: string
  ): Promise<BatchToggleResult> {
    const response = await authFetch(
      `${this.baseURL}/group/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/enable-all`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to enable all skills: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Disable all skills in a plugin group.
   */
  async disableAllInGroup(
    marketplaceName: string,
    pluginName: string
  ): Promise<BatchToggleResult> {
    const response = await authFetch(
      `${this.baseURL}/group/${encodeURIComponent(marketplaceName)}/${encodeURIComponent(pluginName)}/disable-all`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to disable all skills: ${response.statusText}`);
    }

    return response.json();
  }
}

export const marketplaceSkillsAPI = new MarketplaceSkillsAPI();
