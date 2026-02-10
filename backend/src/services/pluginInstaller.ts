import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { pluginPaths } from './pluginPaths';
import { pluginParser } from './pluginParser';
import { getPluginInstaller, cleanBeforeInstall, flushMCPConfig } from './pluginInstallStrategy';
import { pluginScanner } from './pluginScanner';
import { 
  MarketplaceAddRequest, 
  PluginInstallRequest, 
  PluginInstallResult, 
  MarketplaceSyncResult,
  MarketplaceManifest,
  MarketplaceUpdateCheckResult
} from '../types/plugins';

const execAsync = promisify(exec);

// Marketplace metadata file for tracking source type and config
interface MarketplaceMetadata {
  type: string;
  source: string;
  branch?: string;
  cosConfig?: {
    region?: string;
    bucket?: string;
    prefix?: string;
  };
  autoUpdate?: {
    enabled: boolean;
    checkInterval: number;
    lastCheck?: string;
    lastVersion?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

/**
 * Plugin Installer Service
 * Handles installation of marketplaces and plugins from various sources
 */
class PluginInstaller {
  /**
   * Add a new marketplace
   */
  async addMarketplace(request: MarketplaceAddRequest): Promise<MarketplaceSyncResult> {
    const { name, type, source, branch = 'main', cosConfig, autoUpdate } = request;

    // Generate directory name from marketplace name
    const marketplaceName = this.sanitizeName(name);
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);

    // Check if marketplace already exists
    if (fs.existsSync(marketplacePath)) {
      return {
        success: false,
        error: `Marketplace '${marketplaceName}' already exists`,
        syncedAt: new Date().toISOString(),
      };
    }

    try {
      if (type === 'git' || type === 'github') {
        await this.cloneMarketplace(source, marketplacePath, branch, type === 'github');
      } else if (type === 'local') {
        await this.copyLocalMarketplace(source, marketplacePath);
      } else if (type === 'cos') {
        await this.downloadFromCOS(source, marketplacePath, cosConfig);
      } else if (type === 'archive') {
        await this.downloadAndExtractArchive(source, marketplacePath);
      }

      // Save marketplace metadata for sync operations
      await this.saveMarketplaceMetadata(marketplacePath, {
        type,
        source,
        branch: type === 'git' || type === 'github' ? branch : undefined,
        cosConfig: type === 'cos' ? cosConfig : undefined,
        autoUpdate: autoUpdate ? {
          enabled: autoUpdate.enabled,
          checkInterval: autoUpdate.checkInterval || 60, // Default: 1 hour
        } : undefined,
        createdAt: new Date().toISOString(),
      });

      // Count plugins and agents
      const pluginNames = pluginPaths.listPlugins(marketplaceName);
      const agentCount = await this.countMarketplaceAgents(marketplacePath);

      return {
        success: true,
        pluginCount: pluginNames.length,
        agentCount,
        syncedAt: new Date().toISOString(),
      };
    } catch (error) {
      // Cleanup on error
      if (fs.existsSync(marketplacePath)) {
        await this.removeDirectory(marketplacePath);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add marketplace',
        syncedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Sync (update) an existing marketplace
   */
  async syncMarketplace(marketplaceName: string): Promise<MarketplaceSyncResult> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);

    if (!fs.existsSync(marketplacePath)) {
      return {
        success: false,
        error: `Marketplace '${marketplaceName}' not found`,
        syncedAt: new Date().toISOString(),
      };
    }

    try {
      // Load marketplace metadata to determine sync strategy
      const metadata = await this.loadMarketplaceMetadata(marketplacePath);
      
      if (metadata) {
        // Use metadata to determine sync method
        switch (metadata.type) {
          case 'git':
          case 'github':
            await this.syncGitMarketplace(marketplacePath);
            break;
          case 'cos':
            await this.syncCOSMarketplace(marketplacePath, metadata);
            break;
          case 'archive':
            await this.syncArchiveMarketplace(marketplacePath, metadata);
            break;
          case 'local':
            // Local marketplaces cannot be synced remotely
            return {
              success: false,
              error: 'Local marketplace cannot be synced. Use the original source path.',
              syncedAt: new Date().toISOString(),
            };
          default:
            return {
              success: false,
              error: `Unknown marketplace type: ${metadata.type}`,
              syncedAt: new Date().toISOString(),
            };
        }
      } else {
        // Fallback: check if it's a git repository
        const gitDir = path.join(marketplacePath, '.git');
        if (fs.existsSync(gitDir)) {
          await this.syncGitMarketplace(marketplacePath);
        } else {
          return {
            success: false,
            error: 'Marketplace has no metadata and is not a git repository. Cannot sync.',
            syncedAt: new Date().toISOString(),
          };
        }
      }

      // Update metadata timestamp
      if (metadata) {
        metadata.updatedAt = new Date().toISOString();
        await this.saveMarketplaceMetadata(marketplacePath, metadata);
      }

      // Count plugins and agents
      const pluginNames = pluginPaths.listPlugins(marketplaceName);
      const agentCount = await this.countMarketplaceAgents(marketplacePath);

      return {
        success: true,
        pluginCount: pluginNames.length,
        agentCount,
        syncedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync marketplace',
        syncedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Sync a git-based marketplace
   */
  private async syncGitMarketplace(marketplacePath: string): Promise<void> {
    const gitDir = path.join(marketplacePath, '.git');
    if (!fs.existsSync(gitDir)) {
      throw new Error('Not a git repository');
    }
    await execAsync('git pull', { cwd: marketplacePath });
    console.log(`Synced git marketplace at ${marketplacePath}`);
  }

  /**
   * Sync a COS-based marketplace
   */
  private async syncCOSMarketplace(marketplacePath: string, metadata: MarketplaceMetadata): Promise<void> {
    // Create a temp directory for the new content
    const tempDir = path.join(os.tmpdir(), `marketplace-sync-${Date.now()}`);
    
    try {
      await this.downloadFromCOS(metadata.source, tempDir, metadata.cosConfig);
      
      // Backup and replace
      const backupDir = `${marketplacePath}.backup`;
      if (fs.existsSync(backupDir)) {
        await this.removeDirectory(backupDir);
      }
      
      // Move current to backup
      fs.renameSync(marketplacePath, backupDir);
      
      // Move new content to marketplace path
      fs.renameSync(tempDir, marketplacePath);
      
      // Restore metadata
      await this.saveMarketplaceMetadata(marketplacePath, metadata);
      
      // Remove backup
      await this.removeDirectory(backupDir);
      
      console.log(`Synced COS marketplace at ${marketplacePath}`);
    } catch (error) {
      // Cleanup temp directory
      if (fs.existsSync(tempDir)) {
        await this.removeDirectory(tempDir);
      }
      throw error;
    }
  }

  /**
   * Sync an archive-based marketplace
   */
  private async syncArchiveMarketplace(marketplacePath: string, metadata: MarketplaceMetadata): Promise<void> {
    // Create a temp directory for the new content
    const tempDir = path.join(os.tmpdir(), `marketplace-sync-${Date.now()}`);
    
    try {
      await this.downloadAndExtractArchive(metadata.source, tempDir);
      
      // Backup and replace
      const backupDir = `${marketplacePath}.backup`;
      if (fs.existsSync(backupDir)) {
        await this.removeDirectory(backupDir);
      }
      
      // Move current to backup
      fs.renameSync(marketplacePath, backupDir);
      
      // Move new content to marketplace path
      fs.renameSync(tempDir, marketplacePath);
      
      // Restore metadata
      await this.saveMarketplaceMetadata(marketplacePath, metadata);
      
      // Remove backup
      await this.removeDirectory(backupDir);
      
      console.log(`Synced archive marketplace at ${marketplacePath}`);
    } catch (error) {
      // Cleanup temp directory
      if (fs.existsSync(tempDir)) {
        await this.removeDirectory(tempDir);
      }
      throw error;
    }
  }

  /**
   * Remove a marketplace
   */
  async removeMarketplace(marketplaceName: string): Promise<boolean> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);

    if (!fs.existsSync(marketplacePath)) {
      return false;
    }

    try {
      // First, uninstall all plugins in this marketplace
      const pluginNames = pluginPaths.listPlugins(marketplaceName);
      for (const pluginName of pluginNames) {
        await this.uninstallPlugin(pluginName, marketplaceName);
      }

      // Remove marketplace directory
      await this.removeDirectory(marketplacePath);
      return true;
    } catch (error) {
      console.error('Failed to remove marketplace:', error);
      return false;
    }
  }

  /**
   * Install a plugin (create symlinks)
   */
  async installPlugin(request: PluginInstallRequest): Promise<PluginInstallResult> {
    const { pluginName, marketplaceName } = request;

    // Check if plugin exists
    if (!pluginPaths.pluginExists(marketplaceName, pluginName)) {
      return {
        success: false,
        error: `Plugin '${pluginName}' not found in marketplace '${marketplaceName}'`,
      };
    }

    try {
      const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);

      // Parse plugin
      const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);

      // Check if plugin is valid
      const validation = await pluginParser.validatePlugin(pluginPath, pluginName);
      if (!validation.valid) {
        return {
          success: false,
          error: `Plugin validation failed: ${validation.errors.join(', ')}`,
        };
      }

      // Install plugin components (symlinks for claude-sdk, file copy for cursor-cli)
      await getPluginInstaller().createSymlinks(parsedPlugin);

      // Get installed plugin info
      const installedPlugin = await pluginScanner.scanPlugin(marketplaceName, pluginName);

      if (!installedPlugin) {
        return {
          success: false,
          error: 'Failed to verify plugin installation',
        };
      }

      return {
        success: true,
        plugin: installedPlugin,
        message: 'Plugin installed successfully. Restart or refresh to use the new plugin.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install plugin',
      };
    }
  }

  /**
   * Uninstall a plugin (remove symlinks)
   */
  async uninstallPlugin(pluginName: string, marketplaceName: string): Promise<boolean> {
    try {
      const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);

      if (!fs.existsSync(pluginPath)) {
        return false;
      }

      // Parse plugin to get components
      const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);

      // Remove installed plugin components
      await getPluginInstaller().removeSymlinks(parsedPlugin);

      return true;
    } catch (error) {
      console.error('Failed to uninstall plugin:', error);
      return false;
    }
  }

  /**
   * Enable a plugin (create symlinks)
   */
  async enablePlugin(pluginName: string, marketplaceName: string): Promise<boolean> {
    const request: PluginInstallRequest = {
      pluginName,
      marketplaceName,
      marketplaceId: marketplaceName,
    };

    const result = await this.installPlugin(request);
    return result.success;
  }

  /**
   * Disable a plugin (remove symlinks)
   */
  async disablePlugin(pluginName: string, marketplaceName: string): Promise<boolean> {
    return await this.uninstallPlugin(pluginName, marketplaceName);
  }

  /**
   * Clone marketplace from git repository
   */
  private async cloneMarketplace(
    source: string,
    targetPath: string,
    branch: string,
    isGitHub: boolean
  ): Promise<void> {
    let gitUrl = source;

    // Convert GitHub shorthand (owner/repo) to full URL
    if (isGitHub && !source.startsWith('http') && !source.startsWith('git@')) {
      gitUrl = `https://github.com/${source}.git`;
    }

    try {
      const command = `git clone --branch ${branch} --depth 1 ${gitUrl} "${targetPath}"`;
      await execAsync(command);
      console.log(`Cloned marketplace from ${gitUrl}`);
    } catch (error) {
      throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Copy local marketplace directory
   */
  private async copyLocalMarketplace(sourcePath: string, targetPath: string): Promise<void> {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }

    if (!fs.statSync(sourcePath).isDirectory()) {
      throw new Error(`Source path is not a directory: ${sourcePath}`);
    }

    try {
      await this.copyDirectory(sourcePath, targetPath);
      console.log(`Copied local marketplace from ${sourcePath}`);
    } catch (error) {
      throw new Error(`Failed to copy directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(source: string, target: string): Promise<void> {
    // Create target directory
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      // Skip .git, node_modules, and hidden files (except .claude-plugin)
      if (entry.name === '.git' || entry.name === 'node_modules' || 
          (entry.name.startsWith('.') && entry.name !== '.claude-plugin' && entry.name !== '.mcp.json')) {
        continue;
      }

      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, targetPath);
      } else {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  /**
   * Remove directory recursively
   */
  private async removeDirectory(dirPath: string): Promise<void> {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  /**
   * Sanitize name for directory usage
   */
  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  }

  /**
   * Download marketplace from COS (Tencent Cloud Object Storage)
   * Supports both direct URL and COS protocol URLs
   */
  private async downloadFromCOS(
    source: string,
    targetPath: string,
    cosConfig?: {
      region?: string;
      bucket?: string;
      prefix?: string;
    }
  ): Promise<void> {
    // For now, we support public COS URLs that can be downloaded via HTTP
    // Format: https://{bucket}.cos.{region}.myqcloud.com/{prefix}/marketplace.tar.gz
    // Or a direct archive URL
    
    let archiveUrl = source;
    
    // If source doesn't end with an archive extension, assume it's a directory URL
    // and try to fetch marketplace.tar.gz or marketplace.zip from it
    if (!source.endsWith('.tar.gz') && !source.endsWith('.zip') && !source.endsWith('.tgz')) {
      // Try to fetch manifest first to determine archive URL
      const manifestUrl = source.endsWith('/') 
        ? `${source}.claude-plugin/marketplace.json`
        : `${source}/.claude-plugin/marketplace.json`;
      
      try {
        const response = await fetch(manifestUrl);
        if (response.ok) {
          // Manifest exists, try to download archive
          archiveUrl = source.endsWith('/') 
            ? `${source}marketplace.tar.gz`
            : `${source}/marketplace.tar.gz`;
        }
      } catch {
        // Manifest not accessible, assume archive URL
        archiveUrl = source.endsWith('/') 
          ? `${source}marketplace.tar.gz`
          : `${source}/marketplace.tar.gz`;
      }
    }

    console.log(`Downloading COS marketplace from ${archiveUrl}`);
    await this.downloadAndExtractArchive(archiveUrl, targetPath);
  }

  /**
   * Download and extract archive from URL
   * Supports .tar.gz, .tgz, and .zip formats
   */
  private async downloadAndExtractArchive(url: string, targetPath: string): Promise<void> {
    const tempDir = path.join(os.tmpdir(), `marketplace-download-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const isZip = url.endsWith('.zip');
    const archivePath = path.join(tempDir, isZip ? 'archive.zip' : 'archive.tar.gz');

    try {
      // Download archive
      console.log(`Downloading archive from ${url}`);
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to download archive: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      // Save to file
      const fileStream = createWriteStream(archivePath);
      // @ts-ignore - Node.js Readable works with pipeline
      await pipeline(response.body, fileStream);

      console.log(`Downloaded archive to ${archivePath}`);

      // Create target directory
      fs.mkdirSync(targetPath, { recursive: true });

      // Extract archive
      if (isZip) {
        // Use unzip command
        await execAsync(`unzip -o "${archivePath}" -d "${targetPath}"`);
      } else {
        // Use tar command
        await execAsync(`tar -xzf "${archivePath}" -C "${targetPath}" --strip-components=1`);
      }

      console.log(`Extracted archive to ${targetPath}`);

      // Check if extraction created a single subdirectory and flatten if needed
      const entries = fs.readdirSync(targetPath);
      if (entries.length === 1) {
        const singleEntry = path.join(targetPath, entries[0]);
        if (fs.statSync(singleEntry).isDirectory()) {
          // Move contents up one level
          const subEntries = fs.readdirSync(singleEntry);
          for (const subEntry of subEntries) {
            const srcPath = path.join(singleEntry, subEntry);
            const destPath = path.join(targetPath, subEntry);
            fs.renameSync(srcPath, destPath);
          }
          // Remove empty directory
          fs.rmdirSync(singleEntry);
        }
      }
    } finally {
      // Cleanup temp directory
      await this.removeDirectory(tempDir);
    }
  }

  /**
   * Save marketplace metadata for tracking source and configuration
   */
  private async saveMarketplaceMetadata(marketplacePath: string, metadata: MarketplaceMetadata): Promise<void> {
    const metadataDir = path.join(marketplacePath, '.claude-plugin');
    const metadataPath = path.join(metadataDir, '.agentstudio-metadata.json');

    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load marketplace metadata
   */
  private async loadMarketplaceMetadata(marketplacePath: string): Promise<MarketplaceMetadata | null> {
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
   * Count agents defined in marketplace manifest
   */
  private async countMarketplaceAgents(marketplacePath: string): Promise<number> {
    const manifestPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');
    
    if (!fs.existsSync(manifestPath)) {
      return 0;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest: MarketplaceManifest = JSON.parse(content);
      return manifest.agents?.length || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Check for updates in a marketplace
   */
  async checkForUpdates(marketplaceName: string): Promise<MarketplaceUpdateCheckResult> {
    const marketplacePath = pluginPaths.getMarketplacePath(marketplaceName);
    const checkedAt = new Date().toISOString();

    if (!fs.existsSync(marketplacePath)) {
      return {
        marketplaceId: marketplaceName,
        marketplaceName,
        hasUpdate: false,
        error: `Marketplace '${marketplaceName}' not found`,
        checkedAt,
      };
    }

    try {
      const metadata = await this.loadMarketplaceMetadata(marketplacePath);
      const localManifest = await this.loadMarketplaceManifest(marketplacePath);
      const localVersion = localManifest?.version;

      if (!metadata) {
        // Check if it's a git repository
        const gitDir = path.join(marketplacePath, '.git');
        if (fs.existsSync(gitDir)) {
          // Check for git updates
          const hasUpdate = await this.checkGitUpdates(marketplacePath);
          return {
            marketplaceId: marketplaceName,
            marketplaceName,
            hasUpdate,
            localVersion,
            checkedAt,
          };
        }
        
        return {
          marketplaceId: marketplaceName,
          marketplaceName,
          hasUpdate: false,
          error: 'No metadata found and not a git repository',
          checkedAt,
        };
      }

      // Check for updates based on type
      let hasUpdate = false;
      let remoteVersion: string | undefined;

      switch (metadata.type) {
        case 'git':
        case 'github':
          hasUpdate = await this.checkGitUpdates(marketplacePath);
          break;
        case 'cos':
        case 'archive':
          const remoteManifest = await this.fetchRemoteManifest(metadata.source);
          if (remoteManifest) {
            remoteVersion = remoteManifest.version;
            hasUpdate = remoteVersion !== localVersion;
          }
          break;
      }

      // Update metadata with check timestamp
      if (metadata.autoUpdate) {
        metadata.autoUpdate.lastCheck = checkedAt;
        if (remoteVersion) {
          metadata.autoUpdate.lastVersion = remoteVersion;
        }
        await this.saveMarketplaceMetadata(marketplacePath, metadata);
      }

      return {
        marketplaceId: marketplaceName,
        marketplaceName,
        hasUpdate,
        localVersion,
        remoteVersion,
        checkedAt,
      };
    } catch (error) {
      return {
        marketplaceId: marketplaceName,
        marketplaceName,
        hasUpdate: false,
        error: error instanceof Error ? error.message : 'Failed to check for updates',
        checkedAt,
      };
    }
  }

  /**
   * Check if a git repository has remote updates
   */
  private async checkGitUpdates(marketplacePath: string): Promise<boolean> {
    try {
      // Fetch latest from remote
      await execAsync('git fetch', { cwd: marketplacePath });
      
      // Check if local is behind remote
      const { stdout } = await execAsync('git status -uno', { cwd: marketplacePath });
      return stdout.includes('behind');
    } catch {
      return false;
    }
  }

  /**
   * Load marketplace manifest from local path
   */
  private async loadMarketplaceManifest(marketplacePath: string): Promise<MarketplaceManifest | null> {
    const manifestPath = path.join(marketplacePath, '.claude-plugin', 'marketplace.json');
    
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Fetch remote marketplace manifest for version checking
   */
  private async fetchRemoteManifest(source: string): Promise<MarketplaceManifest | null> {
    try {
      // Determine manifest URL
      let manifestUrl = source;
      
      if (!source.endsWith('marketplace.json')) {
        manifestUrl = source.endsWith('/') 
          ? `${source}.claude-plugin/marketplace.json`
          : `${source}/.claude-plugin/marketplace.json`;
      }

      const response = await fetch(manifestUrl);
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Get all marketplaces with auto-update enabled
   */
  async getAutoUpdateMarketplaces(): Promise<string[]> {
    const marketplaceNames = pluginPaths.listMarketplaces();
    const autoUpdateMarketplaces: string[] = [];

    for (const name of marketplaceNames) {
      const marketplacePath = pluginPaths.getMarketplacePath(name);
      const metadata = await this.loadMarketplaceMetadata(marketplacePath);
      
      if (metadata?.autoUpdate?.enabled) {
        autoUpdateMarketplaces.push(name);
      }
    }

    return autoUpdateMarketplaces;
  }
}

export const pluginInstaller = new PluginInstaller();

