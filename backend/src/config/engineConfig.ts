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
 * - codebuddy-sdk: Uses CodeBuddy Agent SDK, reads from ~/.codebuddy/
 * - codex-cli: Uses Codex CLI, reads from ~/.codex/
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
  const validEngines: ServiceEngineType[] = ['cursor-cli', 'claude-sdk', 'codebuddy-sdk', 'codex-cli', 'codex-sdk'];
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
    'codebuddy': 'codebuddy-sdk',
    'codebuddy_sdk': 'codebuddy-sdk',
    'codebuddysdk': 'codebuddy-sdk',
    'codex': 'codex-cli',
    'codex_cli': 'codex-cli',
    'codexcli': 'codex-cli',
    'codex_sdk': 'codex-sdk',
    'codexsdk': 'codex-sdk',
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

/**
 * CodeBuddy SDK engine capabilities
 */
const CODEBUDDY_SDK_CAPABILITIES: ServiceEngineCapabilities = {
  mcp: {
    supported: true,
    scopes: ['global'],
    canRead: true,
    canWrite: false, // Read-only: SDK manages its own mcp.json
  },
  rules: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  commands: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  skills: {
    supported: true,
    scopes: ['user', 'project'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  plugins: {
    supported: true,
    scopes: ['user'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  hooks: {
    supported: true,
    scopes: ['global', 'project'],
    canRead: true,
    canWrite: false, // Read-only for now
  },
  features: {
    provider: false, // CodeBuddy has no provider concept
    subagents: true, // SDK supports agents option + SubagentStart/Stop hooks
    a2a: true, // A2A via SDK MCP server integration
    scheduledTasks: true, // UI feature, works with any engine
    mcpAdmin: true, // MCP config viewing
    voice: true, // Voice input works with CodeBuddy
    vision: true, // CodeBuddy supports vision
    hooks: true, // CodeBuddy has ~/.codebuddy/hooks/
  },
};

/**
 * Codex CLI engine capabilities
 */
const CODEX_SDK_CAPABILITIES: ServiceEngineCapabilities = {
  mcp: {
    supported: true,
    scopes: ['global'],
    canRead: true,
    canWrite: false,
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
    supported: false,
    scopes: [],
    canRead: false,
    canWrite: false,
  },
  features: {
    provider: false,
    subagents: false,
    a2a: false,
    scheduledTasks: true,
    mcpAdmin: true,
    voice: true,
    vision: true,
    hooks: false,
  },
};

const CODEX_CLI_CAPABILITIES: ServiceEngineCapabilities = {
  mcp: {
    supported: true,
    scopes: ['global'],
    canRead: true,
    canWrite: false, // Managed by Codex CLI itself
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
    supported: false,
    scopes: [],
    canRead: false,
    canWrite: false,
  },
  hooks: {
    supported: false,
    scopes: [],
    canRead: false,
    canWrite: false,
  },
  features: {
    provider: false,
    subagents: false,
    a2a: false,
    scheduledTasks: true,
    mcpAdmin: true,
    voice: true,
    vision: true,
    hooks: false,
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

/**
 * Get CodeBuddy SDK paths
 */
function getCodebuddySdkPaths(): EnginePathConfig {
  const codebuddyDir = path.join(os.homedir(), '.codebuddy');
  return {
    userConfigDir: codebuddyDir,
    mcpConfigPath: path.join(codebuddyDir, 'mcp.json'),
    mcpDir: path.join(codebuddyDir, 'mcp'),
    rulesDir: path.join(codebuddyDir, 'rules'),
    commandsDir: path.join(codebuddyDir, 'commands'),
    agentsDir: path.join(codebuddyDir, 'agents'),
    skillsDir: path.join(codebuddyDir, 'skills'),
    hooksDir: path.join(codebuddyDir, 'hooks'),
    pluginsDir: path.join(codebuddyDir, 'plugins'),
    projectsDataDir: path.join(codebuddyDir, 'projects'),
  };
}

/**
 * Get Codex CLI paths
 */
function getCodexCliPaths(): EnginePathConfig {
  const codexDir = path.join(os.homedir(), '.codex');
  return {
    userConfigDir: codexDir,
    mcpConfigPath: path.join(codexDir, 'config.toml'),
    mcpDir: path.join(codexDir, 'mcp'),
    rulesDir: path.join(codexDir, 'rules'),
    commandsDir: path.join(codexDir, 'commands'),
    agentsDir: path.join(codexDir, 'agents'),
    skillsDir: path.join(codexDir, 'skills'),
    hooksDir: path.join(codexDir, 'hooks'),
    pluginsDir: path.join(codexDir, 'plugins'),
    projectsDataDir: path.join(codexDir, 'sessions'),
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
  } else if (engineType === 'codebuddy-sdk') {
    _engineConfig = {
      engine: 'codebuddy-sdk',
      name: 'CodeBuddy Agent SDK',
      capabilities: CODEBUDDY_SDK_CAPABILITIES,
      paths: getCodebuddySdkPaths(),
    };
  } else if (engineType === 'codex-sdk') {
    _engineConfig = {
      engine: 'codex-sdk',
      name: 'Codex SDK',
      capabilities: CODEX_SDK_CAPABILITIES,
      paths: getCodexCliPaths(),
    };
  } else if (engineType === 'codex-cli') {
    _engineConfig = {
      engine: 'codex-cli',
      name: 'Codex CLI',
      capabilities: CODEX_CLI_CAPABILITIES,
      paths: getCodexCliPaths(),
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
 * Check if current engine is CodeBuddy SDK
 */
export function isCodebuddyEngine(): boolean {
  return getEngineType() === 'codebuddy-sdk';
}

/**
 * Check if current engine is Codex CLI
 */
export function isCodexEngine(): boolean {
  return getEngineType() === 'codex-cli';
}

/**
 * Check if current engine is Codex SDK
 */
export function isCodexSdkEngine(): boolean {
  return getEngineType() === 'codex-sdk';
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
  if (isCursorEngine()) return '.cursor';
  if (isCodebuddyEngine()) return '.codebuddy';
  if (isCodexEngine() || isCodexSdkEngine()) return '.codex';
  return '.claude';
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
