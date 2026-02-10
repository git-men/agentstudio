/**
 * Plugin Install Strategy
 * 
 * Routes plugin installation to the appropriate engine-specific installer:
 * - cursor-cli: Uses pluginCopyInstall (file copy + MCP json merge)
 * - claude-sdk: Uses pluginSymlink (symbolic links)
 * 
 * This module provides a unified interface so callers don't need to
 * know which engine is active.
 */

import { isCursorEngine } from '../config/engineConfig.js';
import { pluginSymlink } from './pluginSymlink.js';
import { pluginCopyInstall } from './pluginCopyInstall.js';
import type { ParsedPlugin } from '../types/plugins.js';

/**
 * Common interface for plugin installation
 */
export interface PluginInstaller {
  createSymlinks(parsedPlugin: ParsedPlugin): Promise<void>;
  removeSymlinks(parsedPlugin: ParsedPlugin): Promise<void>;
  checkSymlinks(parsedPlugin: ParsedPlugin): Promise<boolean>;
}

/**
 * Get the plugin installer for the current engine.
 * 
 * - cursor-cli: returns pluginCopyInstall (file copy mode)
 * - claude-sdk: returns pluginSymlink (symlink mode)
 */
export function getPluginInstaller(): PluginInstaller {
  return isCursorEngine() ? pluginCopyInstall : pluginSymlink;
}

/**
 * Clean target directories before a full marketplace install.
 * Only applicable for cursor-cli engine (copy mode).
 * For claude-sdk (symlink mode), this is a no-op.
 */
export function cleanBeforeInstall(): void {
  if (isCursorEngine()) {
    pluginCopyInstall.cleanBeforeInstall();
  }
  // claude-sdk symlink mode doesn't need pre-cleaning
}

/**
 * Flush accumulated MCP config after all plugins are installed.
 * Only applicable for cursor-cli engine (writes unified mcp.json).
 * For claude-sdk, this is a no-op.
 */
export function flushMCPConfig(): void {
  if (isCursorEngine()) {
    pluginCopyInstall.flushMCPConfig();
  }
  // claude-sdk doesn't need unified MCP config
}
