/**
 * MCP Config Manager
 *
 * Manages MCP configuration for different engines:
 * - Cursor CLI: `.cursor/mcp.json` (JSON format)
 * - Codex SDK: `~/.codex/config.toml` (TOML format)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

const MCP_SERVER_NAME = 'frontend-tools';

interface McpJsonConfig {
  mcpServers?: Record<string, unknown>;
}

/**
 * Write the frontend-tools MCP server entry to `.cursor/mcp.json`.
 * Merges with existing config (dedup by server name).
 */
export async function writeMcpConfig(
  workspace: string,
  backendBaseUrl: string,
  sessionId: string,
): Promise<void> {
  const configDir = path.join(workspace, '.cursor');
  const configPath = path.join(configDir, 'mcp.json');

  let config: McpJsonConfig = {};

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(raw);
    }
  } catch {
    config = {};
  }

  if (!config.mcpServers) config.mcpServers = {};

  const url = `${backendBaseUrl}/api/mcp-bridge/frontend-tools/${sessionId}`;

  config.mcpServers[MCP_SERVER_NAME] = {
    type: 'http',
    url,
  };

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`[McpConfig] Wrote ${configPath} → ${MCP_SERVER_NAME}: ${url}`);
}

/**
 * Write an HTTP MCP server entry to `~/.codex/config.toml` for Codex SDK.
 * Uses a session-specific server name to support concurrent sessions.
 */
export async function writeCodexMcpToml(
  backendBaseUrl: string,
  sessionId: string,
): Promise<void> {
  const codexDir = path.join(os.homedir(), '.codex');
  const configPath = path.join(codexDir, 'config.toml');
  const serverName = `frontend-tools-${sessionId}`;
  const url = `${backendBaseUrl}/api/mcp-bridge/frontend-tools/${sessionId}`;

  let config: Record<string, unknown> = {};

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      config = parseToml(raw) as Record<string, unknown>;
    }
  } catch {
    config = {};
  }

  if (!config.mcp_servers || typeof config.mcp_servers !== 'object') {
    config.mcp_servers = {};
  }

  const mcpServers = config.mcp_servers as Record<string, unknown>;
  mcpServers[serverName] = {
    type: 'http',
    url,
  };

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  fs.writeFileSync(configPath, stringifyToml(config), 'utf-8');
  console.log(`[McpConfig] Wrote TOML ${configPath} → ${serverName}: ${url}`);
}

/**
 * Remove a session-specific entry from `~/.codex/config.toml`.
 */
export async function removeCodexMcpTomlEntry(
  sessionId: string,
): Promise<void> {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const serverName = `frontend-tools-${sessionId}`;

  try {
    if (!fs.existsSync(configPath)) return;

    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = parseToml(raw) as Record<string, unknown>;

    if (!config.mcp_servers || typeof config.mcp_servers !== 'object') return;

    const mcpServers = config.mcp_servers as Record<string, unknown>;
    if (!(serverName in mcpServers)) return;

    delete mcpServers[serverName];
    fs.writeFileSync(configPath, stringifyToml(config), 'utf-8');
    console.log(`[McpConfig] Removed TOML entry ${serverName} from ${configPath}`);
  } catch (error) {
    console.warn(`[McpConfig] Failed to remove TOML entry ${serverName}:`, error);
  }
}
