/**
 * MCP Admin Auto-Bootstrap
 *
 * Automatically configures the agentstudio-admin MCP server on startup:
 * 1. Creates an admin API key if none exists
 * 2. Adds agentstudio-admin to the native MCP server config
 * 3. Creates CLI wrapper at ~/.agentstudio/bin/agentstudio
 * 4. Provides env injection helpers for agent sessions (API key + PATH)
 *
 * This ensures the agentstudio-admin MCP is available out-of-the-box
 * for agents (e.g., meta-agent) that need to manage AgentStudio
 * configuration programmatically.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateAdminApiKey, listAdminApiKeys } from './adminApiKeyService.js';
import { AGENTSTUDIO_HOME, MCP_SERVER_CONFIG_FILE } from '../../config/paths.js';
import { getMcpAdminServer } from './mcpAdminServer.js';
import { atomicWriteJsonSync } from '../../utils/fileUtils.js';

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

function readNativeConfig(): { config: NativeMcpConfig; fileExisted: boolean } {
  if (!fs.existsSync(MCP_SERVER_CONFIG_FILE)) {
    return { config: { mcpServers: {} }, fileExisted: false };
  }

  let content: string;
  try {
    content = fs.readFileSync(MCP_SERVER_CONFIG_FILE, 'utf-8');
  } catch (error) {
    console.error(`[MCP Admin Bootstrap] Failed to read ${MCP_SERVER_CONFIG_FILE}:`, error);
    return { config: { mcpServers: {} }, fileExisted: true };
  }

  try {
    const parsed = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.mcpServers !== null &&
      typeof parsed.mcpServers === 'object' &&
      !Array.isArray(parsed.mcpServers)
    ) {
      return { config: parsed as NativeMcpConfig, fileExisted: true };
    }
    console.warn(
      `[MCP Admin Bootstrap] Config file has unexpected structure (mcpServers type: ${
        parsed?.mcpServers === null ? 'null' : typeof parsed?.mcpServers
      }), treating as empty`
    );
    return { config: { mcpServers: {} }, fileExisted: true };
  } catch (error) {
    console.error(`[MCP Admin Bootstrap] Failed to parse ${MCP_SERVER_CONFIG_FILE}:`, error);
    return { config: { mcpServers: {} }, fileExisted: true };
  }
}

function backupNativeConfig(): void {
  try {
    if (fs.existsSync(MCP_SERVER_CONFIG_FILE)) {
      const backupPath = MCP_SERVER_CONFIG_FILE + '.bak';
      fs.copyFileSync(MCP_SERVER_CONFIG_FILE, backupPath);
    }
  } catch (error) {
    console.warn('[MCP Admin Bootstrap] Failed to create backup:', error);
  }
}

function writeNativeConfig(config: NativeMcpConfig): void {
  atomicWriteJsonSync(MCP_SERVER_CONFIG_FILE, config);
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

    // Cache credentials for env injection into agent sessions
    cacheAdminCredentials(adminKey, port);

    // Create CLI wrapper at ~/.agentstudio/bin/agentstudio
    bootstrapAdminCli(port);

    const expectedUrl = `http://localhost:${port}/api/mcp-admin`;
    const { config, fileExisted } = readNativeConfig();
    const existing = config.mcpServers[SERVER_NAME];

    const urlMatches = existing?.url === expectedUrl;
    const hasAuth = !!existing?.headers?.Authorization;
    const isValidated = existing?.status === 'active' && Array.isArray(existing?.tools) && existing.tools.length > 0;

    if (urlMatches && hasAuth && isValidated) {
      return;
    }

    const toolNames = getAdminToolNames();

    // Safety check: if file existed but config is empty (parse failed or bad structure),
    // only write if we can confirm this won't destroy existing data
    const existingServerCount = Object.keys(config.mcpServers).length;
    if (fileExisted && existingServerCount === 0) {
      console.warn(
        '[MCP Admin Bootstrap] Config file existed but parsed as empty — backing up before write to prevent data loss'
      );
      backupNativeConfig();
    }

    config.mcpServers[SERVER_NAME] = {
      type: 'http',
      url: expectedUrl,
      headers: {
        Authorization: `Bearer ${adminKey}`,
      },
      source: 'local',
      status: 'active',
      tools: toolNames,
      lastValidated: new Date().toISOString(),
    };

    writeNativeConfig(config);
    console.info(`[MCP Admin Bootstrap] Configured ${SERVER_NAME} → ${expectedUrl} (${toolNames.length} tools, preserved ${existingServerCount} existing)`);
  } catch (error) {
    console.error('[MCP Admin Bootstrap] Failed:', error);
  }
}

/**
 * Get tool names from the MCP Admin Server singleton.
 * Falls back to empty array if server isn't ready yet.
 */
function getAdminToolNames(): string[] {
  try {
    const server = getMcpAdminServer();
    const result = server.getTools(['admin:*']);
    return (result.tools || []).map((t: { name: string }) => t.name);
  } catch {
    return [];
  }
}

/**
 * Read system MCP servers from the native config.
 * Used by readMcpConfig() to merge system servers for read-only engines.
 */
export function getSystemMcpServers(): Record<string, McpServerEntry> {
  const { config } = readNativeConfig();
  const result: Record<string, McpServerEntry> = {};

  if (config.mcpServers[SERVER_NAME]) {
    result[SERVER_NAME] = config.mcpServers[SERVER_NAME];
  }

  return result;
}

// ─── Admin CLI Bootstrap ──────────────────────────────────────────────────────

const BIN_DIR = path.join(AGENTSTUDIO_HOME, 'bin');
const CLI_WRAPPER_PATH = path.join(BIN_DIR, 'agentstudio');

let cachedAdminApiKey: string | null = null;
let cachedServerPort: number | null = null;

/**
 * Create a CLI wrapper script at ~/.agentstudio/bin/agentstudio.
 * The wrapper embeds the current Node.js path and the backend's CLI entry point,
 * making `agentstudio admin ...` available in agent Bash sessions regardless of
 * how AgentStudio was installed (npm global, desktop app, dev mode, etc.).
 */
export function bootstrapAdminCli(port: number): void {
  try {
    const nodePath = process.execPath;
    // Resolve the compiled CLI entry: dist/bin/agentstudio.js relative to backend root
    const cliEntryPoint = path.resolve(__dirname, '../../bin/agentstudio.js');

    let wrapperContent: string;
    if (fs.existsSync(cliEntryPoint)) {
      // Production mode: run compiled JS with node
      wrapperContent = [
        '#!/bin/sh',
        `exec "${nodePath}" "${cliEntryPoint}" "$@"`,
        '',
      ].join('\n');
    } else {
      // Dev mode: use tsx (shell script) to run TypeScript source directly
      const tsSource = path.resolve(__dirname, '../../bin/agentstudio.ts');
      const tsxBin = path.resolve(__dirname, '../../../node_modules/.bin/tsx');
      if (fs.existsSync(tsxBin) && fs.existsSync(tsSource)) {
        wrapperContent = [
          '#!/bin/sh',
          `exec "${tsxBin}" "${tsSource}" "$@"`,
          '',
        ].join('\n');
      } else {
        console.warn('[Admin CLI Bootstrap] Cannot locate CLI entry point, skipping wrapper creation');
        return;
      }
    }

    fs.mkdirSync(BIN_DIR, { recursive: true });

    // Only rewrite if content changed
    if (fs.existsSync(CLI_WRAPPER_PATH)) {
      const existing = fs.readFileSync(CLI_WRAPPER_PATH, 'utf-8');
      if (existing === wrapperContent) {
        return;
      }
    }

    fs.writeFileSync(CLI_WRAPPER_PATH, wrapperContent, { mode: 0o755 });
    console.info(`[Admin CLI Bootstrap] Created CLI wrapper → ${CLI_WRAPPER_PATH}`);
  } catch (error) {
    console.warn('[Admin CLI Bootstrap] Failed to create CLI wrapper:', error);
  }
}

/**
 * Cache the admin API key and server port for later env injection.
 * Called during autoBootstrapMcpAdmin().
 */
function cacheAdminCredentials(apiKey: string, port: number): void {
  cachedAdminApiKey = apiKey;
  cachedServerPort = port;
}

/**
 * Get environment variables to inject into agent sessions for Admin CLI access.
 *
 * Returns:
 * - AGENTSTUDIO_ADMIN_API_KEY: the bootstrap admin key
 * - AGENTSTUDIO_SERVER: the local server URL
 * - PATH: prepended with ~/.agentstudio/bin so `agentstudio` CLI is available
 */
export function getAdminCliEnvVars(): Record<string, string> {
  const vars: Record<string, string> = {};

  if (cachedAdminApiKey) {
    vars['AGENTSTUDIO_ADMIN_API_KEY'] = cachedAdminApiKey;
  }

  if (cachedServerPort) {
    vars['AGENTSTUDIO_SERVER'] = `http://127.0.0.1:${cachedServerPort}`;
  }

  return vars;
}

/**
 * Get the bin directory path for PATH prepending.
 */
export function getAdminCliBinDir(): string {
  return BIN_DIR;
}
