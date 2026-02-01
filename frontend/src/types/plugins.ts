/**
 * Plugin System Frontend Types
 * Extended with COS/Archive support and AgentStudio agents
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

export interface PluginFile {
  path: string;
  relativePath: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  marketplace: string;
  marketplaceName: string;
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
  installPath: string;
  symlinkCreated: boolean;
}

export interface PluginMarketplace {
  id: string;
  name: string;
  displayName: string;
  type: MarketplaceType;
  source: string;
  description?: string;
  path: string;
  pluginCount: number;
  agentCount?: number; // Number of AgentStudio agents in marketplace
  lastSync?: string;
  owner?: {
    name: string;
    url?: string;
  };
  branch?: string;
  // Auto-update configuration
  autoUpdate?: {
    enabled: boolean;
    checkInterval: number; // Interval in minutes
    lastCheck?: string;
    lastVersion?: string;
  };
}

export interface AvailablePlugin {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  marketplace: string;
  marketplaceName: string;
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

export interface MarketplaceAddRequest {
  name: string;
  type: MarketplaceType;
  source: string;
  description?: string;
  branch?: string; // For git/github
  // COS-specific options
  cosConfig?: {
    secretId?: string;
    secretKey?: string;
    region?: string;
    bucket?: string;
    prefix?: string;
  };
  // Auto-update configuration
  autoUpdate?: {
    enabled: boolean;
    checkInterval?: number; // Interval in minutes (default: 60)
  };
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

export interface PluginInstallRequest {
  pluginName: string;
  marketplaceName: string;
  marketplaceId: string;
}

export interface PluginDetailResponse {
  plugin: InstalledPlugin;
  components: {
    commands: PluginComponent[];
    agents: PluginComponent[];
    skills: PluginComponent[];
    hooks: PluginComponent[];
    mcpServers: PluginComponent[];
  };
  files: PluginFile[];
  readme?: string;
  manifest: PluginManifest;
}

export interface FileContentResponse {
  content: string;
}

