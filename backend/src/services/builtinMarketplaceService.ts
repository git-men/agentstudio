/**
 * Builtin Marketplace Service
 * 
 * Manages initialization and re-synchronization of local marketplaces.
 * 
 * Sync targets (in priority order):
 * 1. Paths from BUILTIN_MARKETPLACES env var (comma-separated local paths)
 * 2. If not set, falls back to all registered local-type marketplaces
 * 
 * Features:
 * - File lock to prevent concurrent sync operations
 * - Can be triggered on startup or manually via API
 * - Only handles local type marketplaces (git/cos/archive handled separately)
 */

import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths.js';
import { pluginInstaller } from './pluginInstaller.js';
import { pluginScanner } from './pluginScanner.js';
import { agentImporter } from './agentImporter.js';
import { cleanBeforeInstall, flushMCPConfig } from './pluginInstallStrategy.js';

// ============================================================================
// State
// ============================================================================

let isSyncing = false;
let lastSyncTime: string | null = null;
let lastSyncResult: BuiltinMarketplaceSyncResult | null = null;

// Simple lock file path
const LOCK_FILE = path.join(process.env.HOME || '/tmp', '.agentstudio-marketplace-sync.lock');

export interface BuiltinMarketplaceSyncResult {
  success: boolean;
  marketplaces: Array<{
    name: string;
    pluginsTotal: number;
    pluginsInstalled: number;
    pluginsFailed: number;
    agentsImported: number;
  }>;
  duration: number;
  syncedAt: string;
  error?: string;
}

// ============================================================================
// Lock Management
// ============================================================================

/**
 * Acquire a file-based lock to prevent concurrent syncs.
 * Returns true if lock acquired, false if already locked.
 */
function acquireLock(): boolean {
  if (isSyncing) {
    return false;
  }

  try {
    // Check if lock file exists and is recent (within 5 minutes)
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 5 * 60 * 1000) {
        console.warn('[BuiltinMarketplaces] Lock file exists and is recent, skipping sync');
        return false;
      }
      // Stale lock, remove it
      console.warn('[BuiltinMarketplaces] Removing stale lock file');
      fs.unlinkSync(LOCK_FILE);
    }

    // Create lock file with PID
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    isSyncing = true;
    return true;
  } catch (error) {
    console.error('[BuiltinMarketplaces] Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release the sync lock.
 */
function releaseLock(): void {
  isSyncing = false;
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore cleanup errors
  }
}

// ============================================================================
// Core Sync Logic
// ============================================================================

/**
 * Resolve which marketplaces to sync.
 * 
 * Priority:
 * 1. Explicit builtinPaths parameter
 * 2. BUILTIN_MARKETPLACES env var (comma-separated local paths)
 * 3. Fallback: all registered local-type marketplaces
 * 
 * Returns a list of { name, sourcePath? } entries.
 */
async function resolveMarketplacesToSync(
  builtinPaths?: string
): Promise<Array<{ name: string; sourcePath?: string }>> {
  // 1. Explicit paths or env var
  const paths = builtinPaths || process.env.BUILTIN_MARKETPLACES;
  if (paths) {
    return paths.split(',').map(p => p.trim()).filter(Boolean).map(localPath => ({
      name: path.basename(localPath) || 'default',
      sourcePath: localPath,
    }));
  }

  // 2. Fallback: all registered local-type marketplaces
  console.info('[BuiltinMarketplaces] No BUILTIN_MARKETPLACES configured, falling back to all registered local marketplaces');
  const allMarketplaces = await pluginScanner.scanMarketplaces();
  const localMarketplaces = allMarketplaces.filter(mp => mp.type === 'local');

  if (localMarketplaces.length === 0) {
    console.info('[BuiltinMarketplaces] No local marketplaces registered');
  }

  return localMarketplaces.map(mp => ({
    name: mp.name || mp.id,
    // No sourcePath — already registered, just reinstall plugins
  }));
}

/**
 * Initialize/re-synchronize local marketplaces.
 * 
 * This is the main entry point, called both on startup and via API.
 * Uses a file lock to prevent concurrent executions.
 * 
 * When builtinPaths / BUILTIN_MARKETPLACES is set:
 *   - Registers each path as a local marketplace (re-copy from source)
 *   - Installs all plugins and imports agents
 * 
 * When neither is set (fallback mode):
 *   - Re-installs plugins for all already-registered local-type marketplaces
 * 
 * @param builtinPaths Comma-separated list of local marketplace paths.
 *                     If not provided, reads from BUILTIN_MARKETPLACES env var.
 *                     If neither set, falls back to all registered local marketplaces.
 * @returns Sync result with per-marketplace statistics.
 */
export async function syncBuiltinMarketplaces(
  builtinPaths?: string
): Promise<BuiltinMarketplaceSyncResult> {
  // Acquire lock
  if (!acquireLock()) {
    return {
      success: false,
      marketplaces: [],
      duration: 0,
      syncedAt: new Date().toISOString(),
      error: 'Sync already in progress',
    };
  }

  const startTime = Date.now();
  const marketplaceResults: BuiltinMarketplaceSyncResult['marketplaces'] = [];

  try {
    const targets = await resolveMarketplacesToSync(builtinPaths);

    if (targets.length === 0) {
      const duration = Date.now() - startTime;
      lastSyncTime = new Date().toISOString();
      lastSyncResult = {
        success: true,
        marketplaces: [],
        duration,
        syncedAt: lastSyncTime,
      };
      console.info('[BuiltinMarketplaces] No marketplaces to sync');
      return lastSyncResult;
    }

    console.info(`[BuiltinMarketplaces] Starting sync for ${targets.length} marketplace(s)...`);

    for (const target of targets) {
      const { name, sourcePath } = target;

      const mpResult = {
        name,
        pluginsTotal: 0,
        pluginsInstalled: 0,
        pluginsFailed: 0,
        agentsImported: 0,
      };

      try {
        if (sourcePath) {
          // --- Mode A: New/re-register from source path ---
          if (!fs.existsSync(sourcePath)) {
            console.warn(`[BuiltinMarketplaces] Path does not exist, skipping: ${sourcePath}`);
            continue;
          }

          console.info(`[BuiltinMarketplaces] Processing: ${name} (${sourcePath})`);

          if (pluginPaths.marketplaceExists(name)) {
            console.info(`[BuiltinMarketplaces] Re-syncing existing: ${name}`);
            await pluginInstaller.removeMarketplace(name);
          }

          const result = await pluginInstaller.addMarketplace({
            type: 'local',
            source: sourcePath,
            name,
          });

          if (!result.success) {
            console.error(`[BuiltinMarketplaces] Failed to add ${name}: ${result.error}`);
            continue;
          }
        } else {
          // --- Mode B: Already registered, just reinstall ---
          if (!pluginPaths.marketplaceExists(name)) {
            console.warn(`[BuiltinMarketplaces] Marketplace not found: ${name}`);
            continue;
          }
          console.info(`[BuiltinMarketplaces] Reinstalling plugins for: ${name}`);
        }

        // Clean before install (cursor-cli specific)
        cleanBeforeInstall();

        // Install all plugins
        const plugins = pluginPaths.listPlugins(name);
        mpResult.pluginsTotal = plugins.length;
        console.info(`[BuiltinMarketplaces] Installing ${plugins.length} plugins from ${name}`);

        for (const pluginName of plugins) {
          try {
            const installResult = await pluginInstaller.installPlugin({
              pluginName,
              marketplaceName: name,
              marketplaceId: name,
            });
            if (installResult.success) {
              mpResult.pluginsInstalled++;
            } else {
              mpResult.pluginsFailed++;
              console.warn(`[BuiltinMarketplaces] Plugin ${pluginName}: ${installResult.error}`);
            }
          } catch (pluginError) {
            mpResult.pluginsFailed++;
            console.error(`[BuiltinMarketplaces] Failed to install ${pluginName}:`, pluginError);
          }
        }

        // Flush MCP config (cursor-cli specific)
        flushMCPConfig();

        // Import AgentStudio agents
        try {
          const agentResult = await agentImporter.importAgentsFromMarketplace(name);
          mpResult.agentsImported = agentResult.importedCount;
          if (agentResult.importedCount > 0) {
            console.info(`[BuiltinMarketplaces] Imported ${agentResult.importedCount} agents from ${name}`);
          }
        } catch (agentError) {
          console.error(`[BuiltinMarketplaces] Failed to import agents from ${name}:`, agentError);
        }

        console.info(`[BuiltinMarketplaces] ${name}: ${mpResult.pluginsInstalled}/${mpResult.pluginsTotal} installed`);
      } catch (error) {
        console.error(`[BuiltinMarketplaces] Failed to init ${name}:`, error);
      }

      marketplaceResults.push(mpResult);
    }

    const duration = Date.now() - startTime;
    lastSyncTime = new Date().toISOString();
    lastSyncResult = {
      success: true,
      marketplaces: marketplaceResults,
      duration,
      syncedAt: lastSyncTime,
    };

    console.info(`[BuiltinMarketplaces] Sync complete in ${duration}ms`);
    return lastSyncResult;
  } catch (error) {
    const duration = Date.now() - startTime;
    const result: BuiltinMarketplaceSyncResult = {
      success: false,
      marketplaces: marketplaceResults,
      duration,
      syncedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    lastSyncResult = result;
    return result;
  } finally {
    releaseLock();
  }
}

// ============================================================================
// Status
// ============================================================================

/**
 * Get the current sync status
 */
export function getBuiltinMarketplaceStatus(): {
  isSyncing: boolean;
  lastSyncTime: string | null;
  lastSyncResult: BuiltinMarketplaceSyncResult | null;
  builtinPaths: string | undefined;
} {
  return {
    isSyncing,
    lastSyncTime,
    lastSyncResult,
    builtinPaths: process.env.BUILTIN_MARKETPLACES,
  };
}
