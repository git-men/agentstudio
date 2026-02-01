/**
 * Marketplace Update Service
 * 
 * Background service that periodically checks for updates to marketplaces
 * and optionally auto-updates them.
 */

import { pluginInstaller } from './pluginInstaller';
import { pluginPaths } from './pluginPaths';
import * as fs from 'fs';
import * as path from 'path';
import { MarketplaceUpdateCheckResult, MarketplaceUpdateCheckBatchResult } from '../types/plugins';

// ============================================================================
// Types
// ============================================================================

interface MarketplaceUpdateConfig {
  enabled: boolean;
  defaultCheckInterval: number; // Default interval in minutes
  autoApplyUpdates: boolean; // Whether to auto-apply updates or just notify
}

interface UpdateCheckJob {
  marketplaceName: string;
  intervalMs: number;
  timeoutId: NodeJS.Timeout | null;
  lastCheck: Date | null;
  lastResult: MarketplaceUpdateCheckResult | null;
}

// ============================================================================
// Service State
// ============================================================================

let isInitialized = false;
let config: MarketplaceUpdateConfig = {
  enabled: true,
  defaultCheckInterval: 60, // 60 minutes default
  autoApplyUpdates: false, // Just check by default, don't auto-update
};

const updateJobs: Map<string, UpdateCheckJob> = new Map();
const updateListeners: Set<(result: MarketplaceUpdateCheckResult) => void> = new Set();

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the marketplace update service
 */
export function initializeMarketplaceUpdateService(customConfig?: Partial<MarketplaceUpdateConfig>): void {
  if (isInitialized) {
    console.warn('[MarketplaceUpdate] Already initialized');
    return;
  }

  if (customConfig) {
    config = { ...config, ...customConfig };
  }

  console.info(`[MarketplaceUpdate] Initializing with config: enabled=${config.enabled}, defaultInterval=${config.defaultCheckInterval}min, autoApply=${config.autoApplyUpdates}`);

  if (config.enabled) {
    // Schedule update checks for all marketplaces with auto-update enabled
    scheduleAllUpdateChecks();
  }

  isInitialized = true;
  console.info('[MarketplaceUpdate] Initialization complete');
}

/**
 * Shutdown the marketplace update service
 */
export function shutdownMarketplaceUpdateService(): void {
  console.info('[MarketplaceUpdate] Shutting down...');

  // Clear all scheduled jobs
  for (const [name, job] of updateJobs) {
    if (job.timeoutId) {
      clearTimeout(job.timeoutId);
    }
  }
  updateJobs.clear();
  updateListeners.clear();

  isInitialized = false;
  console.info('[MarketplaceUpdate] Shutdown complete');
}

// ============================================================================
// Scheduling
// ============================================================================

/**
 * Schedule update checks for all marketplaces with auto-update enabled
 */
async function scheduleAllUpdateChecks(): Promise<void> {
  const marketplaceNames = pluginPaths.listMarketplaces();

  for (const name of marketplaceNames) {
    const metadata = await loadMarketplaceMetadata(name);
    
    if (metadata?.autoUpdate?.enabled) {
      const intervalMinutes = metadata.autoUpdate.checkInterval || config.defaultCheckInterval;
      scheduleUpdateCheck(name, intervalMinutes);
    }
  }
}

/**
 * Schedule an update check for a specific marketplace
 */
export function scheduleUpdateCheck(marketplaceName: string, intervalMinutes: number): void {
  // Cancel existing job if any
  cancelUpdateCheck(marketplaceName);

  const intervalMs = intervalMinutes * 60 * 1000;
  
  const job: UpdateCheckJob = {
    marketplaceName,
    intervalMs,
    timeoutId: null,
    lastCheck: null,
    lastResult: null,
  };

  // Schedule the first check
  job.timeoutId = setTimeout(() => runUpdateCheck(marketplaceName), intervalMs);
  
  updateJobs.set(marketplaceName, job);
  console.info(`[MarketplaceUpdate] Scheduled update check for '${marketplaceName}' every ${intervalMinutes} minutes`);
}

/**
 * Cancel scheduled update check for a marketplace
 */
export function cancelUpdateCheck(marketplaceName: string): void {
  const job = updateJobs.get(marketplaceName);
  if (job) {
    if (job.timeoutId) {
      clearTimeout(job.timeoutId);
    }
    updateJobs.delete(marketplaceName);
    console.info(`[MarketplaceUpdate] Cancelled update check for '${marketplaceName}'`);
  }
}

// ============================================================================
// Update Checking
// ============================================================================

/**
 * Run update check for a specific marketplace
 */
async function runUpdateCheck(marketplaceName: string): Promise<void> {
  const job = updateJobs.get(marketplaceName);
  if (!job) {
    console.warn(`[MarketplaceUpdate] No job found for '${marketplaceName}'`);
    return;
  }

  console.info(`[MarketplaceUpdate] Checking for updates: ${marketplaceName}`);

  try {
    const result = await pluginInstaller.checkForUpdates(marketplaceName);
    job.lastCheck = new Date();
    job.lastResult = result;

    // Notify listeners
    for (const listener of updateListeners) {
      try {
        listener(result);
      } catch (error) {
        console.error('[MarketplaceUpdate] Error in update listener:', error);
      }
    }

    if (result.hasUpdate) {
      console.info(`[MarketplaceUpdate] Update available for '${marketplaceName}': ${result.localVersion} -> ${result.remoteVersion}`);
      
      // Auto-apply update if configured
      if (config.autoApplyUpdates) {
        console.info(`[MarketplaceUpdate] Auto-applying update for '${marketplaceName}'`);
        try {
          const syncResult = await pluginInstaller.syncMarketplace(marketplaceName);
          if (syncResult.success) {
            console.info(`[MarketplaceUpdate] Successfully updated '${marketplaceName}'`);
          } else {
            console.error(`[MarketplaceUpdate] Failed to update '${marketplaceName}': ${syncResult.error}`);
          }
        } catch (error) {
          console.error(`[MarketplaceUpdate] Error applying update to '${marketplaceName}':`, error);
        }
      }
    } else {
      console.debug(`[MarketplaceUpdate] No update available for '${marketplaceName}'`);
    }
  } catch (error) {
    console.error(`[MarketplaceUpdate] Error checking updates for '${marketplaceName}':`, error);
    job.lastResult = {
      marketplaceId: marketplaceName,
      marketplaceName,
      hasUpdate: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      checkedAt: new Date().toISOString(),
    };
  }

  // Schedule next check
  job.timeoutId = setTimeout(() => runUpdateCheck(marketplaceName), job.intervalMs);
}

/**
 * Check all marketplaces for updates immediately
 */
export async function checkAllUpdatesNow(): Promise<MarketplaceUpdateCheckBatchResult> {
  const marketplaceNames = pluginPaths.listMarketplaces();
  const results: MarketplaceUpdateCheckResult[] = [];
  let updatesAvailable = 0;

  for (const name of marketplaceNames) {
    try {
      const result = await pluginInstaller.checkForUpdates(name);
      results.push(result);
      if (result.hasUpdate) {
        updatesAvailable++;
      }
      
      // Update job state if exists
      const job = updateJobs.get(name);
      if (job) {
        job.lastCheck = new Date();
        job.lastResult = result;
      }
    } catch (error) {
      results.push({
        marketplaceId: name,
        marketplaceName: name,
        hasUpdate: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        checkedAt: new Date().toISOString(),
      });
    }
  }

  return {
    results,
    updatesAvailable,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Check a specific marketplace for updates immediately
 */
export async function checkUpdateNow(marketplaceName: string): Promise<MarketplaceUpdateCheckResult> {
  const result = await pluginInstaller.checkForUpdates(marketplaceName);
  
  // Update job state if exists
  const job = updateJobs.get(marketplaceName);
  if (job) {
    job.lastCheck = new Date();
    job.lastResult = result;
  }

  // Notify listeners
  for (const listener of updateListeners) {
    try {
      listener(result);
    } catch (error) {
      console.error('[MarketplaceUpdate] Error in update listener:', error);
    }
  }

  return result;
}

// ============================================================================
// Listeners
// ============================================================================

/**
 * Add a listener for update check results
 */
export function addUpdateListener(listener: (result: MarketplaceUpdateCheckResult) => void): void {
  updateListeners.add(listener);
}

/**
 * Remove an update listener
 */
export function removeUpdateListener(listener: (result: MarketplaceUpdateCheckResult) => void): void {
  updateListeners.delete(listener);
}

// ============================================================================
// Status
// ============================================================================

/**
 * Get service status
 */
export function getMarketplaceUpdateServiceStatus(): {
  isInitialized: boolean;
  config: MarketplaceUpdateConfig;
  scheduledChecks: Array<{
    marketplaceName: string;
    intervalMinutes: number;
    lastCheck: string | null;
    lastResult: MarketplaceUpdateCheckResult | null;
  }>;
} {
  const scheduledChecks = Array.from(updateJobs.entries()).map(([name, job]) => ({
    marketplaceName: name,
    intervalMinutes: job.intervalMs / 60000,
    lastCheck: job.lastCheck?.toISOString() || null,
    lastResult: job.lastResult,
  }));

  return {
    isInitialized,
    config,
    scheduledChecks,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Load marketplace metadata for auto-update configuration
 */
async function loadMarketplaceMetadata(marketplaceName: string): Promise<any> {
  const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
  const metadataPath = path.join(marketplacePath, '.claude-plugin', '.agentstudio-metadata.json');

  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metadataPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update marketplace auto-update configuration
 */
export async function updateMarketplaceAutoUpdateConfig(
  marketplaceName: string,
  autoUpdate: { enabled: boolean; checkInterval?: number }
): Promise<void> {
  const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
  const metadataPath = path.join(marketplacePath, '.claude-plugin', '.agentstudio-metadata.json');

  let metadata: any = {};
  if (fs.existsSync(metadataPath)) {
    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      metadata = JSON.parse(content);
    } catch {
      // Start fresh
    }
  }

  metadata.autoUpdate = {
    enabled: autoUpdate.enabled,
    checkInterval: autoUpdate.checkInterval || config.defaultCheckInterval,
    ...metadata.autoUpdate,
  };
  metadata.updatedAt = new Date().toISOString();

  // Ensure directory exists
  const metadataDir = path.dirname(metadataPath);
  if (!fs.existsSync(metadataDir)) {
    fs.mkdirSync(metadataDir, { recursive: true });
  }

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  // Update scheduled job
  if (autoUpdate.enabled) {
    scheduleUpdateCheck(marketplaceName, autoUpdate.checkInterval || config.defaultCheckInterval);
  } else {
    cancelUpdateCheck(marketplaceName);
  }
}
