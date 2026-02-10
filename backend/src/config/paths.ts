/**
 * Global Path Constants
 *
 * Centralized path definitions for the application.
 * All paths that reference ~/.agentstudio should use these constants.
 *
 * Directory structure:
 * ~/.agentstudio/
 * ├── config/                    # Application configuration
 * │   └── config.json
 * ├── agents/                    # Agent configuration files
 * ├── data/                      # Persistent data files
 * │   ├── slides/
 * │   ├── projects.json
 * │   ├── claude-versions.json
 * │   ├── mcp-server.json
 * │   ├── a2a-agent-mappings.json
 * │   ├── admin-api-keys.json
 * │   ├── tunnel-config.json
 * │   └── speech-to-text.json
 * ├── run/                       # Runtime files (PID, instance ID)
 * ├── scripts/                   # Service management scripts (Linux)
 * ├── slack-session-locks/       # Slack session locks
 * └── scheduled-tasks/           # Scheduled tasks
 *     ├── tasks.json
 *     └── history/
 */

import { homedir } from 'os';
import { join } from 'path';

/**
 * Base directory for AgentStudio configuration and data.
 * Priority: AGENTSTUDIO_HOME env var > default ~/.agentstudio
 *
 * Note: The --data-dir CLI option sets process.env.DATA_DIR at runtime,
 * which is also respected here as the highest priority.
 */
export const AGENTSTUDIO_HOME =
  process.env.DATA_DIR ||
  process.env.AGENTSTUDIO_HOME ||
  join(homedir(), '.agentstudio');

// Legacy directory names (for migration)
export const LEGACY_CLAUDE_AGENT_DIR = join(homedir(), '.claude-agent');
export const LEGACY_AGENT_STUDIO_DIR = join(homedir(), '.agent-studio');

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * Directory for application configuration.
 * Default: ~/.agentstudio/config
 */
export const CONFIG_DIR = join(AGENTSTUDIO_HOME, 'config');

/**
 * Main application config file (port, password, JWT, CORS, Slack, etc.)
 * Default: ~/.agentstudio/config/config.json
 */
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// ─── Agents ──────────────────────────────────────────────────────────────────

/**
 * Directory for agent configuration files.
 * Default: ~/.agentstudio/agents
 */
export const AGENTS_DIR = join(AGENTSTUDIO_HOME, 'agents');

// ─── Data ────────────────────────────────────────────────────────────────────

/**
 * Directory for persistent data files.
 * Default: ~/.agentstudio/data
 */
export const DATA_DIR = join(AGENTSTUDIO_HOME, 'data');

/**
 * Slides storage directory.
 * Default: ~/.agentstudio/data/slides
 */
export const SLIDES_DIR = join(DATA_DIR, 'slides');

/**
 * File path for projects metadata.
 * Default: ~/.agentstudio/data/projects.json
 */
export const PROJECTS_METADATA_FILE = join(DATA_DIR, 'projects.json');

/**
 * File path for Claude versions configuration.
 * Default: ~/.agentstudio/data/claude-versions.json
 */
export const CLAUDE_VERSIONS_FILE = join(DATA_DIR, 'claude-versions.json');

/**
 * File path for MCP server configuration.
 * Default: ~/.agentstudio/data/mcp-server.json
 */
export const MCP_SERVER_CONFIG_FILE = join(DATA_DIR, 'mcp-server.json');

/**
 * File path for A2A agent mappings (global registry).
 * Default: ~/.agentstudio/data/a2a-agent-mappings.json
 */
export const A2A_AGENT_MAPPINGS_FILE = join(DATA_DIR, 'a2a-agent-mappings.json');

/**
 * File path for admin API keys (MCP Admin Server).
 * Default: ~/.agentstudio/data/admin-api-keys.json
 */
export const ADMIN_API_KEYS_FILE = join(DATA_DIR, 'admin-api-keys.json');

/**
 * File path for tunnel configuration.
 * Default: ~/.agentstudio/data/tunnel-config.json
 */
export const TUNNEL_CONFIG_FILE = join(DATA_DIR, 'tunnel-config.json');

/**
 * Get port-specific tunnel config file path.
 */
export function getTunnelConfigFile(port: number): string {
  return join(DATA_DIR, `tunnel-config-${port}.json`);
}

/**
 * File path for speech-to-text configuration.
 * Default: ~/.agentstudio/data/speech-to-text.json
 */
export const SPEECH_TO_TEXT_CONFIG_FILE = join(DATA_DIR, 'speech-to-text.json');

// ─── Runtime ─────────────────────────────────────────────────────────────────

/**
 * Directory for runtime files (PID, instance ID).
 * Default: ~/.agentstudio/run
 */
export const RUN_DIR = join(AGENTSTUDIO_HOME, 'run');

/**
 * Telemetry instance ID file.
 * Default: ~/.agentstudio/run/instance_id
 */
export const INSTANCE_ID_FILE = join(RUN_DIR, 'instance_id');

/**
 * PID file for service management.
 * Default: ~/.agentstudio/run/agentstudio.pid
 */
export const PID_FILE = join(RUN_DIR, 'agentstudio.pid');

// ─── Scripts ─────────────────────────────────────────────────────────────────

/**
 * Directory for service management scripts (Linux fallback).
 * Default: ~/.agentstudio/scripts
 */
export const SCRIPTS_DIR = join(AGENTSTUDIO_HOME, 'scripts');

// ─── Slack ───────────────────────────────────────────────────────────────────

/**
 * Directory for Slack session locks.
 * Default: ~/.agentstudio/slack-session-locks
 */
export const SLACK_SESSION_LOCKS_DIR = join(AGENTSTUDIO_HOME, 'slack-session-locks');

// ─── Scheduled Tasks ─────────────────────────────────────────────────────────

/**
 * Directory for scheduled tasks configuration.
 * Default: ~/.agentstudio/scheduled-tasks
 */
export const SCHEDULED_TASKS_DIR = join(AGENTSTUDIO_HOME, 'scheduled-tasks');

/**
 * File path for scheduled tasks list.
 * Default: ~/.agentstudio/scheduled-tasks/tasks.json
 */
export const SCHEDULED_TASKS_FILE = join(SCHEDULED_TASKS_DIR, 'tasks.json');

/**
 * Directory for scheduled task execution history.
 * Default: ~/.agentstudio/scheduled-tasks/history
 */
export const SCHEDULED_TASKS_HISTORY_DIR = join(SCHEDULED_TASKS_DIR, 'history');

// ─── Project-level paths (per project working directory) ─────────────────────

/**
 * Get the .a2a directory path for a project
 * @param projectPath - Absolute path to the project working directory
 * @returns Path to the project's .a2a directory
 */
export function getProjectA2ADir(projectPath: string): string {
  return join(projectPath, '.a2a');
}

/**
 * Get the tasks directory path for a project
 * @param projectPath - Absolute path to the project working directory
 * @returns Path to the project's tasks directory
 */
export function getProjectTasksDir(projectPath: string): string {
  return join(projectPath, '.a2a', 'tasks');
}

/**
 * Get the A2A config file path for a project
 * @param projectPath - Absolute path to the project working directory
 * @returns Path to the project's A2A config file
 */
export function getProjectA2AConfigFile(projectPath: string): string {
  return join(projectPath, '.a2a', 'config.json');
}

/**
 * Get the API keys file path for a project
 * @param projectPath - Absolute path to the project working directory
 * @returns Path to the project's API keys file
 */
export function getProjectApiKeysFile(projectPath: string): string {
  return join(projectPath, '.a2a', 'api-keys.json');
}

// ─── Backward Compatibility Aliases ──────────────────────────────────────────
// These aliases are kept for backward compatibility with code that still
// imports CLAUDE_AGENT_DIR. They now point to the new unified location.

/** @deprecated Use AGENTSTUDIO_HOME instead */
export const CLAUDE_AGENT_DIR = AGENTSTUDIO_HOME;
