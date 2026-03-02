/**
 * Builtin Marketplace Service
 * 
 * Two independent responsibilities:
 * 
 * 1. **Default Marketplace** — AgentStudio official marketplace (as-marketplace).
 *    Always auto-initialized on startup. Prefers local sibling directory (dev),
 *    falls back to GitHub clone (production/standalone).
 *    Controlled by: DISABLE_DEFAULT_MARKETPLACE=true
 * 
 * 2. **Builtin Marketplaces** — Business-side specified marketplaces via
 *    BUILTIN_MARKETPLACES env var. Supports multiple types with prefix syntax:
 *      - No prefix (path)  → local   e.g. /marketplace
 *      - local:/path       → local   e.g. local:/marketplace
 *      - github:owner/repo → github  e.g. github:jeffkit/as-marketplace
 *      - git:url           → git     e.g. git:https://git.woa.com/org/repo.git
 *      - @branch suffix    → branch  e.g. github:owner/repo@develop
 *    Controlled by: DISABLE_BUILTIN_MARKETPLACES=true
 * 
 * Features:
 * - File lock to prevent concurrent sync operations
 * - Can be triggered on startup or manually via API
 * - Supports local, github, and git marketplace types
 */

import * as fs from 'fs';
import * as path from 'path';
import { pluginPaths } from './pluginPaths.js';
import { pluginInstaller } from './pluginInstaller.js';
import { pluginScanner } from './pluginScanner.js';
import { agentImporter } from './agentImporter.js';
import { cleanBeforeInstall, flushMCPConfig } from './pluginInstallStrategy.js';
import type { MarketplaceType } from '../types/plugins.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MARKETPLACE_REPO = 'jeffkit/as-marketplace';
const DEFAULT_MARKETPLACE_NAME = 'as-marketplace';

// ============================================================================
// Types
// ============================================================================

/**
 * A marketplace sync target with explicit type information.
 */
export interface SyncTarget {
  name: string;
  type: MarketplaceType;
  source: string;
  branch?: string;
}

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
// State
// ============================================================================

let isSyncing = false;
let lastSyncTime: string | null = null;
let lastSyncResult: BuiltinMarketplaceSyncResult | null = null;

const LOCK_FILE = path.join(process.env.HOME || '/tmp', '.agentstudio-marketplace-sync.lock');

// ============================================================================
// Lock Management
// ============================================================================

function acquireLock(): boolean {
  if (isSyncing) {
    return false;
  }

  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 5 * 60 * 1000) {
        console.warn('[BuiltinMarketplaces] Lock file exists and is recent, skipping sync');
        return false;
      }
      console.warn('[BuiltinMarketplaces] Removing stale lock file');
      fs.unlinkSync(LOCK_FILE);
    }

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
// Parsing: BUILTIN_MARKETPLACES multi-type format
// ============================================================================

/**
 * Parse a single BUILTIN_MARKETPLACES entry into a SyncTarget.
 * 
 * Format rules:
 *   - github:owner/repo[@branch]  → type: 'github'
 *   - git:url[@branch]            → type: 'git'
 *   - local:/path                 → type: 'local'
 *   - /path or ./path or ../path  → type: 'local' (backward compatible, no prefix)
 */
export function parseMarketplaceEntry(entry: string): SyncTarget | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  // github: prefix
  if (trimmed.startsWith('github:')) {
    const rest = trimmed.slice('github:'.length);
    const { value, branch } = extractBranch(rest);
    const name = value.split('/').pop() || value;
    return { name, type: 'github', source: value, branch: branch || 'main' };
  }

  // git: prefix
  if (trimmed.startsWith('git:')) {
    const rest = trimmed.slice('git:'.length);
    const { value, branch } = extractBranch(rest);
    const name = path.basename(value).replace(/\.git$/, '') || 'git-marketplace';
    return { name, type: 'git', source: value, branch: branch || 'main' };
  }

  // local: prefix (explicit)
  if (trimmed.startsWith('local:')) {
    const localPath = trimmed.slice('local:'.length);
    return { name: path.basename(localPath) || 'default', type: 'local', source: localPath };
  }

  // No prefix — treat as local path (backward compatible)
  return { name: path.basename(trimmed) || 'default', type: 'local', source: trimmed };
}

/**
 * Extract an optional @branch suffix from a source string.
 * For git URLs containing '@' (e.g. git@github.com:...), only the last @segment
 * after the final '/' is treated as a branch specifier.
 */
export function extractBranch(source: string): { value: string; branch?: string } {
  const lastSlash = source.lastIndexOf('/');
  const afterSlash = lastSlash >= 0 ? source.slice(lastSlash) : source;

  const atIdx = afterSlash.lastIndexOf('@');
  if (atIdx > 0) {
    const branch = afterSlash.slice(atIdx + 1);
    const value = source.slice(0, lastSlash >= 0 ? lastSlash : 0) + afterSlash.slice(0, atIdx);
    return { value, branch };
  }

  return { value: source };
}

// ============================================================================
// Default Marketplace
// ============================================================================

/**
 * Initialize the AgentStudio official default marketplace.
 * 
 * Behavior:
 *   1. Already registered → skip addMarketplace, only reinstall plugins + import agents
 *   2. Not registered → clone from GitHub (HTTPS, shallow)
 * 
 * The source is always the hardcoded GitHub repo — no local discovery fallback.
 * Controlled by DISABLE_DEFAULT_MARKETPLACE=true.
 */
export async function initDefaultMarketplace(): Promise<BuiltinMarketplaceSyncResult> {
  const startTime = Date.now();
  const mpResult = {
    name: DEFAULT_MARKETPLACE_NAME,
    pluginsTotal: 0,
    pluginsInstalled: 0,
    pluginsFailed: 0,
    agentsImported: 0,
  };

  try {
    const alreadyExists = pluginPaths.marketplaceExists(DEFAULT_MARKETPLACE_NAME);

    if (!alreadyExists) {
      console.info(`[DefaultMarketplace] Cloning from GitHub: ${DEFAULT_MARKETPLACE_REPO}`);
      const result = await pluginInstaller.addMarketplace({
        type: 'github',
        source: DEFAULT_MARKETPLACE_REPO,
        name: DEFAULT_MARKETPLACE_NAME,
        branch: 'main',
        autoUpdate: { enabled: true, checkInterval: 60 },
      });
      if (!result.success) {
        throw new Error(`Failed to clone marketplace: ${result.error}`);
      }
    } else {
      console.info('[DefaultMarketplace] Already registered, reinstalling plugins');
    }

    // Install all plugins + import agents (idempotent)
    await installMarketplaceContents(DEFAULT_MARKETPLACE_NAME, mpResult);

    const duration = Date.now() - startTime;
    console.info(`[DefaultMarketplace] Initialized in ${duration}ms (${mpResult.pluginsInstalled}/${mpResult.pluginsTotal} plugins, ${mpResult.agentsImported} agents)`);

    return {
      success: true,
      marketplaces: [mpResult],
      duration,
      syncedAt: new Date().toISOString(),
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[DefaultMarketplace] Failed: ${errMsg}`);
    return {
      success: false,
      marketplaces: [mpResult],
      duration,
      syncedAt: new Date().toISOString(),
      error: errMsg,
    };
  }
}

// ============================================================================
// Builtin Marketplaces (BUILTIN_MARKETPLACES env var)
// ============================================================================

/**
 * Resolve BUILTIN_MARKETPLACES entries into typed SyncTargets.
 * 
 * Priority:
 *   1. Explicit builtinPaths parameter (API call)
 *   2. BUILTIN_MARKETPLACES env var
 *   3. Fallback: all registered local-type marketplaces (reinstall only)
 */
async function resolveMarketplacesToSync(
  builtinPaths?: string
): Promise<SyncTarget[]> {
  const raw = builtinPaths || process.env.BUILTIN_MARKETPLACES;
  if (raw) {
    const targets = raw.split(',')
      .map(e => parseMarketplaceEntry(e))
      .filter((t): t is SyncTarget => t !== null);
    return targets;
  }

  // Fallback: all registered local-type marketplaces (reinstall plugins only)
  console.info('[BuiltinMarketplaces] No BUILTIN_MARKETPLACES configured, falling back to registered local marketplaces');
  const allMarketplaces = await pluginScanner.scanMarketplaces();
  const localMarketplaces = allMarketplaces.filter(mp => mp.type === 'local');

  if (localMarketplaces.length === 0) {
    console.info('[BuiltinMarketplaces] No local marketplaces registered');
  }

  return localMarketplaces.map(mp => ({
    name: mp.name || mp.id,
    type: 'local' as MarketplaceType,
    source: '',
  }));
}

/**
 * Initialize/re-synchronize builtin marketplaces from BUILTIN_MARKETPLACES env var.
 * Supports local, github, and git types.
 * 
 * Uses a file lock to prevent concurrent executions.
 */
export async function syncBuiltinMarketplaces(
  builtinPaths?: string
): Promise<BuiltinMarketplaceSyncResult> {
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
      const mpResult = {
        name: target.name,
        pluginsTotal: 0,
        pluginsInstalled: 0,
        pluginsFailed: 0,
        agentsImported: 0,
      };

      try {
        if (target.source) {
          await addOrUpdateMarketplace(target);
        } else {
          // Fallback mode: already registered, just reinstall plugins
          if (!pluginPaths.marketplaceExists(target.name)) {
            console.warn(`[BuiltinMarketplaces] Marketplace not found: ${target.name}`);
            continue;
          }
          console.info(`[BuiltinMarketplaces] Reinstalling plugins for: ${target.name}`);
        }

        await installMarketplaceContents(target.name, mpResult);
        console.info(`[BuiltinMarketplaces] ${target.name}: ${mpResult.pluginsInstalled}/${mpResult.pluginsTotal} installed`);
      } catch (error) {
        console.error(`[BuiltinMarketplaces] Failed to init ${target.name}:`, error);
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
// Shared Helpers
// ============================================================================

/**
 * Register or re-register a marketplace based on its type.
 */
async function addOrUpdateMarketplace(target: SyncTarget): Promise<void> {
  const { name, type, source, branch } = target;

  if (type === 'local' && !fs.existsSync(source)) {
    throw new Error(`Local path does not exist: ${source}`);
  }

  console.info(`[BuiltinMarketplaces] Processing: ${name} (${type}: ${source}${branch ? '@' + branch : ''})`);

  // Remove existing marketplace before re-adding (for local type, ensures fresh copy)
  if (pluginPaths.marketplaceExists(name)) {
    if (type === 'local') {
      console.info(`[BuiltinMarketplaces] Re-syncing existing local: ${name}`);
      await pluginInstaller.removeMarketplace(name);
    } else {
      // For github/git, the marketplace directory already has a .git — just reinstall plugins
      console.info(`[BuiltinMarketplaces] Already registered (${type}): ${name}, skipping clone`);
      return;
    }
  }

  const autoUpdate = type === 'local'
    ? { enabled: true, checkInterval: 5 }
    : { enabled: true, checkInterval: 60 };

  const result = await pluginInstaller.addMarketplace({
    type,
    source,
    name,
    branch: (type === 'github' || type === 'git') ? (branch || 'main') : undefined,
    autoUpdate,
  });

  if (!result.success) {
    throw new Error(`Failed to add marketplace ${name}: ${result.error}`);
  }
}

/**
 * Install all plugins and import agents from a registered marketplace.
 * Shared by both initDefaultMarketplace and syncBuiltinMarketplaces.
 */
async function installMarketplaceContents(
  marketplaceName: string,
  result: { pluginsTotal: number; pluginsInstalled: number; pluginsFailed: number; agentsImported: number },
): Promise<void> {
  cleanBeforeInstall();

  const plugins = pluginPaths.listPlugins(marketplaceName);
  result.pluginsTotal = plugins.length;
  console.info(`[BuiltinMarketplaces] Installing ${plugins.length} plugins from ${marketplaceName}`);

  for (const pluginName of plugins) {
    try {
      const installResult = await pluginInstaller.installPlugin({
        pluginName,
        marketplaceName,
        marketplaceId: marketplaceName,
      });
      if (installResult.success) {
        result.pluginsInstalled++;
      } else {
        result.pluginsFailed++;
        console.warn(`[BuiltinMarketplaces] Plugin ${pluginName}: ${installResult.error}`);
      }
    } catch (pluginError) {
      result.pluginsFailed++;
      console.error(`[BuiltinMarketplaces] Failed to install ${pluginName}:`, pluginError);
    }
  }

  flushMCPConfig();

  try {
    const agentResult = await agentImporter.importAgentsFromMarketplace(marketplaceName);
    result.agentsImported = agentResult.importedCount;
    if (agentResult.importedCount > 0) {
      console.info(`[BuiltinMarketplaces] Imported ${agentResult.importedCount} agents from ${marketplaceName}`);
    }
  } catch (agentError) {
    console.error(`[BuiltinMarketplaces] Failed to import agents from ${marketplaceName}:`, agentError);
  }
}

// ============================================================================
// Status
// ============================================================================

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
