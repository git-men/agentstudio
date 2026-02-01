/**
 * Service-Level Engine Configuration Types
 * 
 * This module defines the unified engine configuration system that determines
 * which AI engine backend the service uses. The engine type is set at service
 * startup and affects all subsequent operations.
 * 
 * Two engine types are supported:
 * - cursor-cli: Uses Cursor CLI, reads from ~/.cursor/
 * - claude-sdk: Uses Claude Agent SDK, reads from ~/.claude/
 */

// =============================================================================
// Engine Types
// =============================================================================

/**
 * Service-level engine type (set at startup)
 * 
 * This is different from the runtime EngineType in engines/types.ts which
 * represents the execution engine (claude/cursor) for individual chat sessions.
 */
export type ServiceEngineType = 'cursor-cli' | 'claude-sdk';

/**
 * Configuration scope levels
 */
export type ConfigScope = 'global' | 'user' | 'project';

/**
 * Configuration capability for a specific feature
 */
export interface ConfigCapability {
  /** Whether this feature is supported */
  supported: boolean;
  /** Supported scopes (global, user, project) */
  scopes: ConfigScope[];
  /** Whether reading is supported */
  canRead: boolean;
  /** Whether writing is supported */
  canWrite: boolean;
}

/**
 * Engine capabilities declaration
 * Used to dynamically adjust UI based on engine features
 */
export interface ServiceEngineCapabilities {
  // Configuration Management Capabilities
  mcp: ConfigCapability;
  rules: ConfigCapability;
  commands: ConfigCapability;
  skills: ConfigCapability;
  plugins: ConfigCapability;
  hooks: ConfigCapability;
  
  // Feature Capabilities
  features: {
    /** Multi-provider support (Claude has versions, Cursor doesn't) */
    provider: boolean;
    /** Subagent support */
    subagents: boolean;
    /** A2A protocol support */
    a2a: boolean;
    /** Scheduled tasks support */
    scheduledTasks: boolean;
    /** MCP admin tools */
    mcpAdmin: boolean;
    /** Voice input support */
    voice: boolean;
    /** Image/vision support */
    vision: boolean;
    /** Hooks support (Claude only) */
    hooks: boolean;
  };
}

/**
 * Engine path configuration
 */
export interface EnginePathConfig {
  /** User config directory (e.g., ~/.cursor or ~/.claude) */
  userConfigDir: string;
  /** MCP config file path */
  mcpConfigPath: string;
  /** Rules directory */
  rulesDir: string;
  /** Commands directory */
  commandsDir: string;
  /** Skills directories (user-created and built-in) */
  skillsDir: string;
  builtinSkillsDir?: string;
  /** Plugins directory */
  pluginsDir?: string;
  /** Projects data directory (e.g., ~/.cursor/projects) */
  projectsDataDir: string;
}

/**
 * Complete engine configuration
 */
export interface ServiceEngineConfig {
  /** Engine identifier */
  engine: ServiceEngineType;
  /** Human-readable engine name */
  name: string;
  /** Engine version (if available) */
  version?: string;
  /** Engine capabilities */
  capabilities: ServiceEngineCapabilities;
  /** Configuration paths */
  paths: EnginePathConfig;
}

// =============================================================================
// MCP Configuration Types (Engine-agnostic)
// =============================================================================

/**
 * MCP server configuration (common format)
 */
export interface McpServerConfig {
  /** Server identifier */
  name: string;
  /** Launch command */
  command?: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** HTTP URL (alternative to command) */
  url?: string;
  /** HTTP headers (for url mode) */
  headers?: Record<string, string>;
}

/**
 * MCP configuration file structure
 */
export interface McpConfig {
  mcpServers: Record<string, Omit<McpServerConfig, 'name'>>;
}

// =============================================================================
// Rules Configuration Types
// =============================================================================

/**
 * Rule frontmatter (applies to both .mdc and .md formats)
 */
export interface RuleFrontmatter {
  /** Rule description */
  description?: string;
  /** Whether to always apply this rule */
  alwaysApply?: boolean;
  /** Globs patterns for when to apply */
  globs?: string[];
}

/**
 * Rule definition
 */
export interface RuleConfig {
  /** Rule file name (without extension) */
  name: string;
  /** Full file path */
  path: string;
  /** Scope: global, user, or project */
  scope: ConfigScope;
  /** Frontmatter metadata */
  frontmatter: RuleFrontmatter;
  /** Rule content (markdown) */
  content: string;
}

// =============================================================================
// Commands Configuration Types
// =============================================================================

/**
 * Command definition
 */
export interface CommandConfig {
  /** Command name (filename without extension) */
  name: string;
  /** Full file path */
  path: string;
  /** Scope: global, user, or project */
  scope: ConfigScope;
  /** Command content (markdown template) */
  content: string;
}

// =============================================================================
// Skills Configuration Types
// =============================================================================

/**
 * Skill frontmatter
 */
export interface SkillFrontmatter {
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
}

/**
 * Skill definition
 */
export interface SkillConfig {
  /** Skill name (from frontmatter or directory name) */
  name: string;
  /** Skill directory path */
  path: string;
  /** Scope: global, user, or project */
  scope: ConfigScope;
  /** Whether this is a built-in skill */
  isBuiltin: boolean;
  /** Skill frontmatter */
  frontmatter: SkillFrontmatter;
  /** SKILL.md content */
  content: string;
  /** Supporting files in the skill directory */
  supportingFiles?: string[];
}

// =============================================================================
// Plugins Configuration Types (Claude SDK only)
// =============================================================================

/**
 * Plugin installation status
 */
export interface InstalledPlugin {
  /** Plugin identifier (name@marketplace) */
  id: string;
  /** Plugin name */
  name: string;
  /** Marketplace source */
  marketplace: string;
}

/**
 * Plugins configuration
 */
export interface PluginsConfig {
  version: number;
  /** User-level installed plugins */
  user: string[];
  /** Project-level installed plugins */
  projects: Record<string, string[]>;
  /** Team-level installed plugins */
  team: Record<string, string[]>;
  /** Local plugins */
  local: Record<string, string[]>;
}

/**
 * Marketplace configuration
 */
export interface MarketplaceConfig {
  [name: string]: {
    repo: string;
    branch: string;
    source?: string;
  };
}

// =============================================================================
// Cursor-specific Types
// =============================================================================

/**
 * Cursor CLI config structure
 */
export interface CursorCliConfig {
  permissions?: {
    allow: string[];
    deny: string[];
  };
  version?: number;
  editor?: {
    vimMode?: boolean;
  };
  model?: {
    modelId?: string;
    displayModelId?: string;
    displayName?: string;
    displayNameShort?: string;
    aliases?: string[];
    maxMode?: boolean;
  };
  hasChangedDefaultModel?: boolean;
  maxMode?: boolean;
  privacyCache?: {
    ghostMode?: boolean;
    privacyMode?: number;
    updatedAt?: number;
  };
  network?: {
    useHttp1ForAgent?: boolean;
  };
}

/**
 * Cursor project data structure
 */
export interface CursorProjectData {
  /** Project path hash */
  hash: string;
  /** Original project path */
  projectPath: string;
  /** MCP server tools */
  mcpTools: Record<string, CursorMcpServerTools>;
  /** Agent transcripts */
  transcripts: string[];
  /** Terminal outputs */
  terminals: string[];
  /** Assets (screenshots, etc.) */
  assets: string[];
}

/**
 * Cursor MCP server tools structure
 */
export interface CursorMcpServerTools {
  serverIdentifier: string;
  serverName: string;
  instructions?: string;
  status?: string;
  tools: CursorMcpTool[];
}

/**
 * Cursor MCP tool definition
 */
export interface CursorMcpTool {
  name: string;
  description: string;
  arguments: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Engine info API response
 */
export interface EngineInfoResponse {
  engine: ServiceEngineType;
  name: string;
  version?: string;
  capabilities: ServiceEngineCapabilities;
  paths: EnginePathConfig;
}

/**
 * Configuration list API response
 */
export interface ConfigListResponse<T> {
  items: T[];
  total: number;
  scope?: ConfigScope;
}
