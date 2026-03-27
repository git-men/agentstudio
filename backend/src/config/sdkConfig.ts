/**
 * @deprecated This module is deprecated. Use engineConfig.ts instead.
 * 
 * Claude Internal is now a first-class engine type ('claude-internal-sdk') in engineConfig.ts.
 * All functions from this module have been migrated to engineConfig.ts.
 * This file is kept for backward compatibility and will be removed in a future release.
 * 
 * Migration guide:
 * - SDK_ENGINE → getEngineType() from engineConfig.ts
 * - getSdkDir() → getEnginePaths().userConfigDir from engineConfig.ts
 * - getProjectsDir() → getEnginePaths().projectsDataDir from engineConfig.ts
 * - getAllProjectsDirs() → getAllProjectsDirs() from engineConfig.ts
 * - getSdkConfigPath() → getSdkConfigPath() from engineConfig.ts
 * - getSdkDirName() → getSdkDirName() from engineConfig.ts
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { AGENTSTUDIO_HOME } from './paths.js';

// Get SDK engine from environment or default to claude-code
export const SDK_ENGINE = process.env.AGENT_SDK || 'claude-code';

// Valid SDK engine types
export type SdkEngine = 'claude-code' | 'claude-internal' | 'code-buddy';

// Validate SDK engine (currently only claude-code and claude-internal are supported)
const VALID_ENGINES: SdkEngine[] = ['claude-code', 'claude-internal'];
if (!VALID_ENGINES.includes(SDK_ENGINE as SdkEngine)) {
  console.warn(`⚠️  Invalid AGENT_SDK="${SDK_ENGINE}", falling back to "claude-code"`);
  console.warn(`⚠️  Supported engines: ${VALID_ENGINES.join(', ')}`);
  process.env.AGENT_SDK = 'claude-code';
}

// SDK directory name mapping
const SDK_DIR_MAP: Record<SdkEngine, string> = {
  'claude-code': '.claude',
  'claude-internal': '.claude-internal',
  'code-buddy': '.codebuddy' // Not yet supported
};

/**
 * Get the base SDK directory name (e.g., '.claude', '.claude-internal')
 */
export function getSdkDirName(): string {
  return SDK_DIR_MAP[SDK_ENGINE as SdkEngine];
}

/**
 * Get the full path to the SDK directory (e.g., ~/.claude, ~/.claude-internal)
 */
export function getSdkDir(): string {
  return path.join(os.homedir(), getSdkDirName());
}

/**
 * Get the projects directory path (e.g., ~/.claude/projects)
 */
export function getProjectsDir(): string {
  return path.join(getSdkDir(), 'projects');
}

/**
 * Get all projects directories to search for Claude session files.
 *
 * Sessions may be created by different Claude versions (claude-code, claude-internal),
 * each writing to its own config directory. We search both to find sessions regardless
 * of which version created them.
 *
 * On macOS, also includes ~/.agentstudio/claude-sdk-config/projects for the EMFILE workaround.
 *
 * Returns directories in priority order (existing directories only):
 * - macOS custom dir (~/.agentstudio/claude-sdk-config/projects)
 * - Current engine dir (e.g., ~/.claude/projects)
 * - claude-internal dir (~/.claude-internal/projects)
 */
export function getAllProjectsDirs(): string[] {
  const home = os.homedir();
  const seen = new Set<string>();
  const dirs: string[] = [];

  const addIfExists = (dir: string) => {
    if (!seen.has(dir)) {
      seen.add(dir);
      if (fs.existsSync(dir)) {
        dirs.push(dir);
      }
    }
  };

  // 1. macOS custom dir (EMFILE workaround, where new sessions may go)
  if (process.platform === 'darwin') {
    addIfExists(path.join(AGENTSTUDIO_HOME, 'claude-sdk-config', 'projects'));
  }

  // 2. Current engine's directory (highest priority)
  addIfExists(getProjectsDir());

  // 3. claude-internal directory (sessions created with claude-internal provider)
  addIfExists(path.join(home, SDK_DIR_MAP['claude-internal'], 'projects'));

  // 4. claude-code directory (in case current engine is claude-internal)
  addIfExists(path.join(home, SDK_DIR_MAP['claude-code'], 'projects'));

  return dirs;
}

/**
 * Get the SDK config file path
 * - claude-code: ~/.claude.json (in home directory)
 * - claude-internal: ~/.claude-internal/.claude.json (inside SDK directory)
 */
export function getSdkConfigPath(): string {
  if (SDK_ENGINE === 'claude-code') {
    // Claude Code stores config at ~/.claude.json
    return path.join(os.homedir(), '.claude.json');
  } else {
    // Claude Internal stores config inside its directory: ~/.claude-internal/.claude.json
    return path.join(getSdkDir(), '.claude.json');
  }
}

/**
 * Get the plugins directory (e.g., ~/.claude/plugins)
 */
export function getPluginsDir(): string {
  return path.join(getSdkDir(), 'plugins');
}

/**
 * Get the commands directory (e.g., ~/.claude/commands)
 */
export function getCommandsDir(): string {
  return path.join(getSdkDir(), 'commands');
}

/**
 * Get the agents directory (e.g., ~/.claude/agents)
 */
export function getAgentsDir(): string {
  return path.join(getSdkDir(), 'agents');
}

/**
 * Get the skills directory (e.g., ~/.claude/skills)
 */
export function getSkillsDir(): string {
  return path.join(getSdkDir(), 'skills');
}

/**
 * Get the hooks directory (e.g., ~/.claude/hooks)
 */
export function getHooksDir(): string {
  return path.join(getSdkDir(), 'hooks');
}

/**
 * Get the MCP directory (e.g., ~/.claude/mcp)
 */
export function getMcpDir(): string {
  return path.join(getSdkDir(), 'mcp');
}

/**
 * Log SDK configuration at startup
 */
export function logSdkConfig(): void {
  console.log('🔧 Agent SDK Configuration:');
  console.log(`   Engine: ${SDK_ENGINE}`);
  console.log(`   Directory: ${getSdkDir()}`);
  console.log(`   Projects: ${getProjectsDir()}`);
  console.log(`   Config: ${getSdkConfigPath()}`);
}
