/**
 * MCP Configuration Reader
 *
 * Reads MCP (Model Context Protocol) server configurations from both
 * AgentStudio's own config and the engine-native config files.
 */

import * as fs from 'fs';
import { MCP_SERVER_CONFIG_FILE } from '../config/paths.js';
import { getEnginePaths } from '../config/engineConfig.js';

/**
 * Read MCP (Model Context Protocol) configuration from AgentStudio config
 */
export function readMcpConfig(): { mcpServers: Record<string, any> } {
  if (fs.existsSync(MCP_SERVER_CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8'));
    } catch (error) {
      console.error('Failed to parse MCP configuration:', error);
      return { mcpServers: {} };
    }
  }
  return { mcpServers: {} };
}

/**
 * Read engine-native MCP configuration (e.g. ~/.cursor/mcp.json or ~/.claude/mcp.json).
 * These entries do NOT have an `active` status; they are always enabled.
 */
export function readEngineMcpConfig(): Record<string, any> {
  try {
    const enginePaths = getEnginePaths();
    const engineMcpPath = enginePaths.mcpConfigPath;

    // Skip if engine path is the same as AgentStudio config (avoid duplicates)
    if (engineMcpPath === MCP_SERVER_CONFIG_FILE) {
      return {};
    }

    if (fs.existsSync(engineMcpPath)) {
      const config = JSON.parse(fs.readFileSync(engineMcpPath, 'utf-8'));
      return config.mcpServers || {};
    }
  } catch (error) {
    console.error('Failed to read engine MCP configuration:', error);
  }
  return {};
}
