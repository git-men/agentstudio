/**
 * MCP Admin Auto-Bootstrap
 *
 * Automatically configures the agentstudio-admin MCP server on startup:
 * 1. Creates an admin API key if none exists
 * 2. Adds agentstudio-admin to the native MCP server config
 *
 * This ensures the agentstudio-admin MCP is available out-of-the-box
 * for agents (e.g., meta-agent) that need to manage AgentStudio
 * configuration programmatically.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateAdminApiKey, listAdminApiKeys } from './adminApiKeyService.js';
import { MCP_SERVER_CONFIG_FILE } from '../../config/paths.js';

const SYSTEM_KEY_DESCRIPTION = 'System Auto-Bootstrap (agentstudio-admin)';
const SERVER_NAME = 'agentstudio-admin';

interface McpServerEntry {
  type: string;
  url?: string;
  headers?: Record<string, string>;
  source?: string;
  [key: string]: any;
}

interface NativeMcpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

function readNativeConfig(): NativeMcpConfig {
  try {
    if (fs.existsSync(MCP_SERVER_CONFIG_FILE)) {
      const content = fs.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.mcpServers === 'object') {
        return parsed as NativeMcpConfig;
      }
    }
  } catch {
    // Corrupted or missing file — start fresh
  }
  return { mcpServers: {} };
}

function writeNativeConfig(config: NativeMcpConfig): void {
  const dir = path.dirname(MCP_SERVER_CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(MCP_SERVER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Ensure at least one active admin API key exists.
 * Returns the plaintext key (either newly created or decrypted from existing).
 */
async function ensureAdminApiKey(): Promise<string | null> {
  const keys = await listAdminApiKeys();
  const activeKeys = keys.filter(k => !k.revokedAt && k.enabled !== false);

  if (activeKeys.length > 0) {
    const decrypted = activeKeys[0].decryptedKey;
    if (decrypted) {
      return decrypted;
    }
    console.warn('[MCP Admin Bootstrap] Active key exists but could not be decrypted');
    return null;
  }

  const { key } = await generateAdminApiKey(SYSTEM_KEY_DESCRIPTION, ['admin:*']);
  console.info('[MCP Admin Bootstrap] Created initial admin API key');
  return key;
}

/**
 * Auto-bootstrap agentstudio-admin MCP server configuration.
 *
 * - Ensures an admin API key exists (creates one if needed)
 * - Writes agentstudio-admin to ~/.agentstudio/data/mcp-server.json
 * - Updates URL/key if port changed or key was regenerated
 *
 * @param port - The port AgentStudio is running on
 */
export async function autoBootstrapMcpAdmin(port: number): Promise<void> {
  try {
    const adminKey = await ensureAdminApiKey();
    if (!adminKey) {
      console.warn('[MCP Admin Bootstrap] Skipped — no usable admin API key');
      return;
    }

    const expectedUrl = `http://localhost:${port}/api/mcp-admin`;
    const config = readNativeConfig();
    const existing = config.mcpServers[SERVER_NAME];

    const urlMatches = existing?.url === expectedUrl;
    const hasAuth = !!existing?.headers?.Authorization;

    if (urlMatches && hasAuth) {
      return;
    }

    config.mcpServers[SERVER_NAME] = {
      type: 'http',
      url: expectedUrl,
      headers: {
        Authorization: `Bearer ${adminKey}`,
      },
      source: 'local',
    };

    writeNativeConfig(config);
    console.info(`[MCP Admin Bootstrap] Configured ${SERVER_NAME} → ${expectedUrl}`);
  } catch (error) {
    console.error('[MCP Admin Bootstrap] Failed:', error);
  }
}

/**
 * Read system MCP servers from the native config.
 * Used by readMcpConfig() to merge system servers for read-only engines.
 */
export function getSystemMcpServers(): Record<string, McpServerEntry> {
  const config = readNativeConfig();
  const result: Record<string, McpServerEntry> = {};

  if (config.mcpServers[SERVER_NAME]) {
    result[SERVER_NAME] = config.mcpServers[SERVER_NAME];
  }

  return result;
}
