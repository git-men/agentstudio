/**
 * Plugin System Types
 * Based on Claude Code plugin specification
 * Extended with COS/Archive support and AgentStudio agents
 * Storage: ~/.claude/plugins/marketplaces/
 */

/**
 * Marketplace source types:
 * - git: Full git repository URL
 * - github: GitHub shorthand (owner/repo) or full URL
 * - local: Local directory path
 * - cos: Tencent Cloud COS URL (bucket/prefix)
 * - archive: Direct URL to a tar.gz/zip archive
 */
export type MarketplaceType = 'git' | 'github' | 'local' | 'cos' | 'archive';

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  repository?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
}

export interface PluginComponent {
  type: 'command' | 'agent' | 'skill' | 'hook' | 'mcp';
  name: string;
  path: string;
  relativePath: string;
  description?: string;
}

export interface ParsedPlugin {
  manifest: PluginManifest;
  components: {
    commands: PluginComponent[];
    agents: PluginComponent[];
    skills: PluginComponent[];
    hooks: PluginComponent[];
    mcpServers: PluginComponent[];
  };
  files: PluginFile[];
  path: string;
  marketplaceName: string;
  pluginName: string;
}

export interface PluginFile {
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface InstalledPlugin {
  id: string; // format: pluginName@marketplaceName
  name: string;
  version: string;
  marketplace: string; // marketplace display name
  marketplaceName: string; // marketplace directory name
  enabled: boolean;
  installedAt: string;
  updatedAt?: string;
  manifest: PluginManifest;
  components: {
    commands: string[];
    agents: string[];
    skills: string[];
    hooks: string[];
    mcpServers: string[];
  };
  installPath: string; // Full path to plugin directory
  symlinkCreated: boolean; // Whether symlinks are created
}

export interface PluginMarketplace {
  id: string;
  name: string; // Directory name
  displayName: string; // Human readable name
  type: MarketplaceType;
  source: string; // URL for git/github/cos/archive, path for local
  description?: string;
  path: string; // Full path to marketplace directory
  pluginCount: number;
  agentCount?: number; // Number of AgentStudio agents in marketplace
  lastSync?: string;
  owner?: {
    name: string;
    url?: string;
  };
  branch?: string; // For git repositories
  // Auto-update configuration
  autoUpdate?: {
    enabled: boolean;
    checkInterval: number; // Interval in minutes (default: 60)
    lastCheck?: string; // ISO timestamp of last update check
    lastVersion?: string; // Last known version from remote
  };
}

export interface MarketplaceManifest {
  name: string;
  version?: string; // Marketplace version for update checking
  owner: {
    name: string;
    url?: string;
  };
  description?: string;
  plugins: MarketplacePlugin[];
  // AgentStudio-specific: agent configurations
  agents?: MarketplaceAgent[];
}

/**
 * AgentStudio-specific agent definition in marketplace
 * These are imported as AgentConfig in AgentStudio
 */
export interface MarketplaceAgent {
  name: string;
  source: string; // Relative path to agent.json or inline config
  description?: string;
  version?: string;
  // Inline agent configuration (if source is not provided)
  config?: {
    systemPrompt: string | { type: 'preset'; preset: string; append?: string };
    permissionMode?: string;
    maxTurns?: number;
    allowedTools?: Array<{ name: string; enabled: boolean }>;
    ui?: {
      icon?: string;
      headerTitle?: string;
      headerDescription?: string;
      welcomeMessage?: string;
    };
    tags?: string[];
    hooks?: {
      onRunFinished?: {
        action: string;
        message?: string;
      };
    };
  };
}

export interface MarketplacePlugin {
  name: string;
  source: string;
  description?: string;
  version?: string;
}

export interface AvailablePlugin {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  marketplace: string; // marketplace display name
  marketplaceName: string; // marketplace directory name
  marketplaceId: string;
  source: string;
  installed: boolean;
  installedVersion?: string;
  enabled?: boolean;
  components: {
    commands: number;
    agents: number;
    skills: number;
    hooks: number;
    mcpServers: number;
  };
  readme?: string;
}

export interface PluginInstallRequest {
  pluginName: string;
  marketplaceId: string;
  marketplaceName: string;
}

export interface PluginInstallResult {
  success: boolean;
  plugin?: InstalledPlugin;
  error?: string;
  message?: string;
}

export interface MarketplaceAddRequest {
  name: string;
  type: MarketplaceType;
  source: string;
  description?: string;
  branch?: string; // For git/github
  // COS-specific options
  cosConfig?: {
    secretId?: string; // Optional: use env vars if not provided
    secretKey?: string;
    region?: string;
    bucket?: string;
    prefix?: string; // Path prefix within bucket
  };
  // Auto-update configuration
  autoUpdate?: {
    enabled: boolean;
    checkInterval?: number; // Interval in minutes (default: 60)
  };
}

export interface MarketplaceSyncResult {
  success: boolean;
  pluginCount?: number;
  agentCount?: number; // Number of AgentStudio agents
  error?: string;
  syncedAt: string;
  // Update check results
  hasUpdate?: boolean;
  remoteVersion?: string;
  localVersion?: string;
}

/**
 * Auto-update check result
 */
export interface MarketplaceUpdateCheckResult {
  marketplaceId: string;
  marketplaceName: string;
  hasUpdate: boolean;
  localVersion?: string;
  remoteVersion?: string;
  checkedAt: string;
  error?: string;
}

/**
 * Batch update check result
 */
export interface MarketplaceUpdateCheckBatchResult {
  results: MarketplaceUpdateCheckResult[];
  updatesAvailable: number;
  checkedAt: string;
}
