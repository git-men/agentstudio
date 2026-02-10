/**
 * Service-Level Engine Configuration
 * 
 * This module provides a unified engine configuration system that determines
 * which AI engine backend the service uses. The engine type is set at service
 * startup via environment variable or command line argument.
 * 
 * Supported engines:
 * - cursor-cli: Uses Cursor CLI, reads from ~/.cursor/
 * - claude-sdk: Uses Claude Agent SDK, reads from ~/.claude/
 * 
 * Usage:
 * - Environment variable: ENGINE=cursor-cli
 * - Command line argument: --engine=cursor-cli
 * - Default: claude-sdk
 */

import * as path from 'path';
import * as os from 'os';
import type {
  ServiceEngineType,
  ServiceEngineConfig,
  ServiceEngineCapabilities,
  EnginePathConfig,
} from '../types/engine.js';

// =============================================================================
// Engine Detection and Configuration
// =============================================================================

/**
 * Parse command line arguments for --engine flag
 */
function parseEngineFromArgs(): ServiceEngineType | null {
  const args = process.argv;
  for (const arg of args) {
    if (arg.startsWith('--engine=')) {
      return arg.split('=')[1] as ServiceEngineType;
    }
  }
  return null;
}

/**
 * Get engine type from environment or command line
 */
function detectEngineType(): ServiceEngineType {
  // Priority: command line > environment variable > default
  const fromArgs = parseEngineFromArgs();
  if (fromArgs) return fromArgs;
  
  const fromEnv = process.env.ENGINE;
  if (fromEnv) return fromEnv as ServiceEngineType;
  
  // Check legacy AGENT_SDK environment variable for backward compatibility
  const legacySdk = process.env.AGENT_SDK;
  if (legacySdk) {
    if (legacySdk === 'cursor' || legacySdk === 'cursor-cli') {
      return 'cursor-cli';
    }
    return 'claude-sdk';
  }
  
  return 'claude-sdk'; // Default
}

/**
 * Validate and normalize engine type
 * Supports case-insensitive matching and common aliases
 */
function validateEngineType(engine: string): ServiceEngineType {
  const validEngines: ServiceEngineType[] = ['cursor-cli', 'claude-sdk'];
  const normalized = engine.trim().toLowerCase();

  // 直接匹配
  if (validEngines.includes(normalized as ServiceEngineType)) {
    return normalized as ServiceEngineType;
  }

  // 常见别名映射
  const aliasMap: Record<string, ServiceEngineType> = {
    'cursor': 'cursor-cli',
    'cursor_cli': 'cursor-cli',
    'cursorcli': 'cursor-cli',
    'claude': 'claude-sdk',
    'claude_sdk': 'claude-sdk',
    'claudesdk': 'claude-sdk',
    'claude-code': 'claude-sdk',
  };

  const mapped = aliasMap[normalized];
  if (mapped) {
    console.log(`🔧 Engine alias "${engine}" resolved to "${mapped}"`);
    return mapped;
  }

  console.warn(`⚠️  Invalid ENGINE="${engine}", falling back to "claude-sdk"`);
  console.warn(`⚠️  Supported engines: ${validEngines.join(', ')}`);
  return 'claude-sdk';
}

// =============================================================================
// Engine Capabilities
// =============================================================================

/**
 * Claude SDK engine capabilities
 */
const CLAUDE_SDK_CAPABILITIES: ServiceEngineCapabilities = {
  mcp: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: true,
  },
  rules: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: true,
  },
  commands: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: true,
  },
  skills: {
    supported: true,
    scopes: ['user', 'project'],
    canRead: true,
    canWrite: true,
  },
  plugins: {
    supported: true,
    scopes: ['user', 'project'],
    canRead: true,
    canWrite: true,
  },
  hooks: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: true,
  },
  features: {
    provider: true,
    subagents: true,
    a2a: true,
    scheduledTasks: true,
    mcpAdmin: true,
    voice: true,
    vision: true,
    hooks: true,
  },
};

/**
 * Cursor CLI engine capabilities
 */
const CURSOR_CLI_CAPABILITIES: ServiceEngineCapabilities = {
  mcp: {
    supported: true,
    scopes: ['global'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  rules: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: false,
  },
  commands: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: false,
  },
  skills: {
    supported: true,
    scopes: ['user', 'project'],
    canRead: true,
    canWrite: false,
  },
  plugins: {
    supported: true,
    scopes: ['user'],
    canRead: true,
    canWrite: false,
  },
  hooks: {
    supported: false, // Cursor doesn't have hooks
    scopes: [],
    canRead: false,
    canWrite: false,
  },
  features: {
    provider: false, // Cursor doesn't have provider concept
    subagents: false,
    a2a: false,
    scheduledTasks: true, // Cursor can use scheduled tasks
    mcpAdmin: true, // MCP Admin is useful for Cursor too
    voice: true, // Voice input works with Cursor
    vision: true,
    hooks: false, // Cursor doesn't support hooks
  },
};

// =============================================================================
// Engine Path Configurations
// =============================================================================

/**
 * Get Claude SDK paths
 */
function getClaudeSdkPaths(): EnginePathConfig {
  const sdkDir = path.join(os.homedir(), '.claude');
  return {
    userConfigDir: sdkDir,
    mcpConfigPath: path.join(sdkDir, 'mcp.json'),
    mcpDir: path.join(sdkDir, 'mcp'),
    rulesDir: path.join(sdkDir, 'rules'),
    commandsDir: path.join(sdkDir, 'commands'),
    agentsDir: path.join(sdkDir, 'agents'),
    skillsDir: path.join(sdkDir, 'skills'),
    hooksDir: path.join(sdkDir, 'hooks'),
    pluginsDir: path.join(sdkDir, 'plugins'),
    projectsDataDir: path.join(sdkDir, 'projects'),
  };
}

/**
 * Get Cursor CLI paths
 */
function getCursorCliPaths(): EnginePathConfig {
  const cursorDir = path.join(os.homedir(), '.cursor');
  return {
    userConfigDir: cursorDir,
    mcpConfigPath: path.join(cursorDir, 'mcp.json'),
    mcpDir: path.join(cursorDir, 'mcp'),
    rulesDir: path.join(cursorDir, 'rules'),
    commandsDir: path.join(cursorDir, 'commands'),
    agentsDir: path.join(cursorDir, 'agents'),
    skillsDir: path.join(cursorDir, 'skills'),
    builtinSkillsDir: path.join(cursorDir, 'skills-cursor'),
    hooksDir: path.join(cursorDir, 'hooks'),
    pluginsDir: path.join(cursorDir, 'plugins'),
    projectsDataDir: path.join(cursorDir, 'projects'),
  };
}

// =============================================================================
// Engine Configuration Singleton
// =============================================================================

let _engineConfig: ServiceEngineConfig | null = null;

/**
 * Initialize engine configuration
 * Called once at service startup
 */
export function initializeEngine(): ServiceEngineConfig {
  if (_engineConfig) {
    return _engineConfig;
  }

  const engineType = validateEngineType(detectEngineType());
  
  if (engineType === 'cursor-cli') {
    _engineConfig = {
      engine: 'cursor-cli',
      name: 'Cursor CLI',
      capabilities: CURSOR_CLI_CAPABILITIES,
      paths: getCursorCliPaths(),
    };
  } else {
    _engineConfig = {
      engine: 'claude-sdk',
      name: 'Claude Agent SDK',
      capabilities: CLAUDE_SDK_CAPABILITIES,
      paths: getClaudeSdkPaths(),
    };
  }

  return _engineConfig;
}

/**
 * Get current engine configuration
 * Throws if engine not initialized
 */
export function getEngineConfig(): ServiceEngineConfig {
  if (!_engineConfig) {
    return initializeEngine();
  }
  return _engineConfig;
}

/**
 * Get engine type
 */
export function getEngineType(): ServiceEngineType {
  return getEngineConfig().engine;
}

/**
 * Check if current engine is Cursor CLI
 */
export function isCursorEngine(): boolean {
  return getEngineType() === 'cursor-cli';
}

/**
 * Check if current engine is Claude SDK
 */
export function isClaudeEngine(): boolean {
  return getEngineType() === 'claude-sdk';
}

/**
 * Check if a feature is supported by current engine
 */
export function isFeatureSupported(feature: keyof ServiceEngineCapabilities['features']): boolean {
  return getEngineConfig().capabilities.features[feature];
}

/**
 * Get engine paths
 */
export function getEnginePaths(): EnginePathConfig {
  return getEngineConfig().paths;
}

/**
 * Log engine configuration at startup
 */
export function logEngineConfig(): void {
  const config = getEngineConfig();
  console.log('🔧 Engine Configuration:');
  console.log(`   Engine: ${config.engine}`);
  console.log(`   Name: ${config.name}`);
  console.log(`   Config Directory: ${config.paths.userConfigDir}`);
  console.log(`   Projects Data: ${config.paths.projectsDataDir}`);
  console.log(`   Features:`);
  Object.entries(config.capabilities.features).forEach(([key, value]) => {
    console.log(`     - ${key}: ${value ? '✓' : '✗'}`);
  });
}

// =============================================================================
// Project Path Utilities
// =============================================================================

/**
 * Convert a project path to Cursor-style hash
 * e.g., /Users/kongjie/projects/foo -> Users-kongjie-projects-foo
 */
export function projectPathToHash(projectPath: string): string {
  // Remove leading slash and replace remaining slashes with dashes
  return projectPath.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Get project data directory path
 */
export function getProjectDataDir(projectPath: string): string {
  const hash = projectPathToHash(projectPath);
  return path.join(getEnginePaths().projectsDataDir, hash);
}

/**
 * Get project MCP tools directory
 */
export function getProjectMcpDir(projectPath: string): string {
  return path.join(getProjectDataDir(projectPath), 'mcps');
}

// =============================================================================
// Backward Compatibility with sdkConfig.ts
// =============================================================================

// Re-export functions for backward compatibility
export { getEngineType as SDK_ENGINE_TYPE };

/**
 * Get SDK directory name (backward compatible)
 * @deprecated Use getEnginePaths().userConfigDir instead
 */
export function getSdkDirName(): string {
  return isCursorEngine() ? '.cursor' : '.claude';
}

/**
 * Get SDK directory path (backward compatible)
 * @deprecated Use getEnginePaths().userConfigDir instead
 */
export function getSdkDir(): string {
  return getEnginePaths().userConfigDir;
}

/**
 * Get projects directory (backward compatible)
 * @deprecated Use getEnginePaths().projectsDataDir instead
 */
export function getProjectsDir(): string {
  return getEnginePaths().projectsDataDir;
}

/**
 * Get commands directory (backward compatible)
 * @deprecated Use getEnginePaths().commandsDir instead
 */
export function getCommandsDir(): string {
  return getEnginePaths().commandsDir;
}

/**
 * Get skills directory (backward compatible)
 * @deprecated Use getEnginePaths().skillsDir instead
 */
export function getSkillsDir(): string {
  return getEnginePaths().skillsDir;
}

/**
 * Get agents directory (backward compatible)
 * @deprecated Use getEnginePaths().agentsDir instead
 */
export function getAgentsDir(): string {
  return getEnginePaths().agentsDir;
}

/**
 * Get hooks directory (backward compatible)
 * @deprecated Use getEnginePaths().hooksDir instead
 */
export function getHooksDir(): string {
  return getEnginePaths().hooksDir;
}

/**
 * Get MCP directory (backward compatible)
 * @deprecated Use getEnginePaths().mcpDir instead
 */
export function getMcpDir(): string {
  return getEnginePaths().mcpDir;
}

/**
 * Get plugins directory (backward compatible)
 * @deprecated Use getEnginePaths().pluginsDir instead
 */
export function getPluginsDir(): string | undefined {
  return getEnginePaths().pluginsDir;
}
