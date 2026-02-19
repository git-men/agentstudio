/**
 * MCP Config Manager
 *
 * Manages `.cursor/mcp.json` in the workspace directory for Cursor CLI
 * integration. Writes the frontend-tools HTTP MCP server endpoint with
 * deduplication — existing entries are preserved.
 */

import fs from 'fs';
import path from 'path';

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
