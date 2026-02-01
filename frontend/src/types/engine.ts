/**
 * Service-Level Engine Configuration Types (Frontend)
 * 
 * Mirrors backend/src/types/engine.ts for frontend use.
 */

// =============================================================================
// Engine Types
// =============================================================================

/**
 * Service-level engine type
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
  supported: boolean;
  scopes: ConfigScope[];
  canRead: boolean;
  canWrite: boolean;
}

/**
 * Engine capabilities declaration
 */
export interface ServiceEngineCapabilities {
  mcp: ConfigCapability;
  rules: ConfigCapability;
  commands: ConfigCapability;
  skills: ConfigCapability;
  plugins: ConfigCapability;
  hooks: ConfigCapability;
  
  features: {
    provider: boolean;
    subagents: boolean;
    a2a: boolean;
    scheduledTasks: boolean;
    mcpAdmin: boolean;
    voice: boolean;
    vision: boolean;
    hooks: boolean;
  };
}

/**
 * Engine path configuration
 */
export interface EnginePathConfig {
  userConfigDir: string;
  mcpConfigPath: string;
  rulesDir: string;
  commandsDir: string;
  skillsDir: string;
  builtinSkillsDir?: string;
  pluginsDir?: string;
  projectsDataDir: string;
}

/**
 * Complete engine configuration
 */
export interface ServiceEngineConfig {
  engine: ServiceEngineType;
  name: string;
  version?: string;
  capabilities: ServiceEngineCapabilities;
  paths: EnginePathConfig;
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

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Feature key type for type-safe feature checks
 */
export type EngineFeatureKey = keyof ServiceEngineCapabilities['features'];

/**
 * Config capability key type
 */
export type ConfigCapabilityKey = 'mcp' | 'rules' | 'commands' | 'skills' | 'plugins' | 'hooks';
