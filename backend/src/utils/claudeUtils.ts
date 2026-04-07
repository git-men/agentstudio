/**
 * Claude Utils - Shared utilities for Claude Code SDK integration
 *
 * This module provides common functions for interacting with Claude Code SDK,
 * used by both the main agents API and Slack integration.
 */

import { Options } from '@anthropic-ai/claude-agent-sdk';
import { SystemPrompt } from '../types/agents.js';
import * as fs from 'fs';
import * as path from 'path';

import { integrateA2AMcpServer } from '../services/a2a/a2aIntegration.js';
import { integrateFrontendTools, type SessionRef } from '../services/frontendTools/index.js';
import { integrateA2UIMcpServer } from '../services/a2ui/a2uiIntegration.js';
import { resolveConfig } from './configResolver.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';
import { logger } from './logger.js';

const log = logger.child('claudeUtils');

const projectStorage = new ProjectMetadataStorage();

export type { SessionRef };
import { resolvePath } from '../config/paths.js';
import { getAdminCliEnvVars, getAdminCliBinDir } from '../services/mcpAdmin/autoBootstrap.js';

import { findWindowsNodeDir, resolveWindowsNpmGlobalJsEntry, getSystemClaudeExecutablePath, getClaudeExecutablePath } from './claudeCliExecutable.js';
import { readMcpConfig, readEngineMcpConfig } from './mcpConfigReader.js';

export { getSystemClaudeExecutablePath, getClaudeExecutablePath } from './claudeCliExecutable.js';
export { readMcpConfig } from './mcpConfigReader.js';
export { getDefaultClaudeVersionEnv } from './claudeDefaultVersionEnv.js';
/**
 * Build a list of well-known Node.js global binary directories.
 * Mirrors the Rust node_manager_bin_dirs() so CLI lookups work even when
 * the process inherits a minimal PATH (common for macOS GUI apps / Tauri).
 */
function getWellKnownNodeBinDirs(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  const push = (p: string) => dirs.push(p);

  // fnm
  push(path.join(home, '.local/share/fnm/aliases/default/bin'));
  try {
    const fnmVersions = path.join(home, '.local/share/fnm/node-versions');
    if (fs.existsSync(fnmVersions)) {
      for (const entry of fs.readdirSync(fnmVersions)) {
        push(path.join(fnmVersions, entry, 'installation/bin'));
      }
    }
  } catch { /* ignore */ }

  // nvm
  try {
    const nvmVersions = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(nvmVersions)) {
      for (const entry of fs.readdirSync(nvmVersions)) {
        push(path.join(nvmVersions, entry, 'bin'));
      }
    }
  } catch { /* ignore */ }
  push(path.join(home, '.nvm/current/bin'));

  // volta
  push(path.join(home, '.volta/bin'));

  // n (tj/n)
  push(path.join(home, 'n/bin'));

  // asdf
  push(path.join(home, '.asdf/shims'));
  try {
    const asdfNode = path.join(home, '.asdf/installs/nodejs');
    if (fs.existsSync(asdfNode)) {
      for (const entry of fs.readdirSync(asdfNode)) {
        push(path.join(asdfNode, entry, 'bin'));
      }
    }
  } catch { /* ignore */ }

  // mise (formerly rtx)
  push(path.join(home, '.local/share/mise/shims'));
  try {
    const miseNode = path.join(home, '.local/share/mise/installs/node');
    if (fs.existsSync(miseNode)) {
      for (const entry of fs.readdirSync(miseNode)) {
        push(path.join(miseNode, entry, 'bin'));
      }
    }
  } catch { /* ignore */ }

  // pnpm global bin
  push(path.join(home, '.local/share/pnpm'));
  push(path.join(home, 'Library/pnpm'));

  // bun global bin
  push(path.join(home, '.bun/bin'));

  // proto
  push(path.join(home, '.proto/bin'));
  push(path.join(home, '.proto/shims'));

  // npm custom prefix
  push(path.join(home, '.npm-global/bin'));
  push(path.join(home, '.npm/bin'));

  // System-wide
  if (process.platform !== 'win32') {
    push('/usr/local/bin');
    push('/opt/homebrew/bin');
  } else {
    const appdata = process.env.APPDATA;
    if (appdata) push(path.join(appdata, 'npm'));
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) push(path.join(localAppData, 'pnpm'));
    push(path.join(home, 'scoop/shims'));
    push(path.join(home, '.bun/bin'));
  }

  return dirs;
}

/**
 * Scan well-known directories for a CLI binary (fallback when which/where fails).
 */
function findCliInWellKnownDirs(cliName: string): string | null {
  const isWindows = process.platform === 'win32';
  for (const dir of getWellKnownNodeBinDirs()) {
    const candidate = path.join(dir, cliName);
    if (fs.existsSync(candidate)) {
      if (isWindows) {
        const jsEntry = resolveWindowsNpmGlobalJsEntry(candidate);
        if (jsEntry) return jsEntry;
      }
      return candidate;
    }
    if (isWindows) {
      const cmdCandidate = candidate + '.cmd';
      if (fs.existsSync(cmdCandidate)) {
        const jsEntry = resolveWindowsNpmGlobalJsEntry(cmdCandidate);
        if (jsEntry) return jsEntry;
        return cmdCandidate;
      }
    }
  }
  return null;
}

/**
 * Build query options for Claude Code SDK
 * This is the enhanced version from agents.ts with full MCP support
 *
 * @param agent - Agent configuration
 * @param projectPath - Optional project path override
 * @param mcpTools - Optional MCP tools to enable
 * @param permissionMode - Optional permission mode override
 * @param model - Optional model override
 * @param claudeVersion - Optional Claude version ID
 * @param defaultEnv - Optional default environment variables (used by Slack integration)
 * @param userEnv - Optional user-provided environment variables (from chat interface)
 * @param sessionIdForAskUser - Optional session ID for AskUserQuestion MCP tool（用于路由用户通知）
 * @param agentIdForAskUser - Optional agent ID for AskUserQuestion MCP tool
 * @param a2aStreamEnabled - Optional flag to enable streaming for A2A external agent calls (default: false)
 * @returns Query options and optional sessionRef for dynamic session ID updates
 */
export interface BuildQueryOptionsResult {
  queryOptions: Options;
  frontendToolSessionRef: SessionRef | null;
}

export async function buildQueryOptions(
  agent: any,
  projectPath?: string,
  mcpTools?: string[],
  permissionMode?: string,
  model?: string,
  claudeVersion?: string,
  defaultEnv?: Record<string, string>,
  userEnv?: Record<string, string>,
  sessionIdForAskUser?: string,
  agentIdForAskUser?: string,
  a2aStreamEnabled?: boolean,
  frontendTools?: import('../services/frontendTools/types.js').FrontendToolDefinition[],
): Promise<BuildQueryOptionsResult> {
  // Determine working directory
  let cwd = process.cwd();
  if (projectPath) {
    cwd = resolvePath(projectPath);
  } else if (agent.workingDirectory) {
    cwd = path.resolve(process.cwd(), resolvePath(agent.workingDirectory));
  }

  // Determine permission mode: request > agent config > default
  let finalPermissionMode = 'default';
  if (permissionMode) {
    finalPermissionMode = permissionMode;
  } else if (agent.permissionMode) {
    finalPermissionMode = agent.permissionMode;
  }

  // claude-internal rejects --dangerously-skip-permissions when running as
  // root/sudo. Auto-downgrade to acceptEdits so agents with bypassPermissions
  // still work in root-based containers (e.g. AnyDev).
  if (finalPermissionMode === 'bypassPermissions' && process.getuid?.() === 0) {
    log.warn('⚠️  bypassPermissions is not allowed when running as root — downgrading to acceptEdits');
    finalPermissionMode = 'acceptEdits';
  }

  // Build allowed tools list from agent configuration
  const allowedTools = (agent.allowedTools ?? [])
    .filter((tool: any) => tool.enabled)
    .map((tool: any) => tool.name);

  // Add MCP tools if provided
  if (mcpTools && mcpTools.length > 0) {
    allowedTools.push(...mcpTools);
  }

  // Expand server-level MCP entries (mcp__serverName) into individual tool entries
  // The SDK requires exact tool names (mcp__serverName__toolName) in allowedTools
  {
    const mcpConfigContent = readMcpConfig();
    const toAdd: string[] = [];
    for (const tool of allowedTools) {
      const parts = tool.split('__');
      if (parts.length === 2 && parts[0] === 'mcp') {
        const serverConfig = mcpConfigContent.mcpServers?.[parts[1]];
        if (serverConfig?.tools?.length) {
          for (const toolName of serverConfig.tools) {
            const fullId = `mcp__${parts[1]}__${toolName}`;
            if (!allowedTools.includes(fullId) && !toAdd.includes(fullId)) {
              toAdd.push(fullId);
            }
          }
        }
      }
    }
    if (toAdd.length > 0) {
      allowedTools.push(...toAdd);
    }
  }

  // Use unified config resolver for provider and model
  // Priority for provider: channel input > agent config > project config > system default
  // Priority for model: channel input > project config > provider's first model > system default
  let executablePath: string | null = null;
  let environmentVariables: Record<string, string> = {};
  let finalModel = 'sonnet';

  try {
    // Special case: if defaultEnv is provided (e.g., Slack integration), use it directly
    if (defaultEnv) {
      log.info(`🎯 Using provided default environment variables (SDK bundled CLI)`);
      environmentVariables = defaultEnv;
      finalModel = model || 'sonnet';
    } else {
      // Use the unified config resolver
      const resolvedConfig = await resolveConfig({
        channelProviderId: claudeVersion,
        channelModel: model,
        agent: { claudeVersionId: agent.claudeVersionId },
        projectPath,
      });

      finalModel = resolvedConfig.model;

      // Extract provider details
      if (resolvedConfig.provider) {
        // Only use executablePath if explicitly configured in the version
        if (resolvedConfig.provider.executablePath) {
          const configuredPath = resolvedConfig.provider.executablePath.trim();

          // On Windows, npm global installs create:
          //   1. A POSIX shell script (e.g. "claude-internal") — cannot be spawned on Windows
          //   2. A .cmd wrapper (e.g. "claude-internal.cmd") — cannot be spawned by SDK (EINVAL)
          // The SDK's spawn expects either a native binary or a .js file.
          // We parse the .cmd to extract the actual .js entry point.
          const isWindows = process.platform === 'win32';
          if (isWindows && !configuredPath.endsWith('.exe') && !configuredPath.endsWith('.js')) {
            // Handles both bare names (claude-internal) and .cmd paths (claude-internal.cmd)
            const jsEntryPath = resolveWindowsNpmGlobalJsEntry(configuredPath);
            if (jsEntryPath) {
              executablePath = jsEntryPath;
              log.info(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (resolved JS entry: ${executablePath})`);
            } else if (fs.existsSync(configuredPath)) {
              executablePath = configuredPath;
              log.info(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (custom path: ${executablePath})`);
            } else {
              log.warn(`⚠️  Configured Claude path not found: ${configuredPath}`);
              log.warn(`   SDK will use bundled CLI for better compatibility`);
            }
          } else if (fs.existsSync(configuredPath)) {
            executablePath = configuredPath;
            log.info(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (custom path: ${executablePath})`);
          } else {
            log.warn(`⚠️  Configured Claude path not found: ${configuredPath}`);
            log.warn(`   This often happens on Windows when npm's claude wrapper (.cmd) is detected`);
            log.warn(`   SDK will use bundled CLI for better compatibility`);
            // Leave executablePath as null to use SDK bundled CLI
          }
        } else {
          log.info(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (SDK bundled CLI)`);
        }
        environmentVariables = resolvedConfig.provider.environmentVariables || {};

        // Log environment variables details
        const envVarKeys = Object.keys(environmentVariables);
        if (envVarKeys.length > 0) {
          log.info(`📝 Environment variables loaded from provider config:`, envVarKeys);
          // Log proxy-related variables specifically
          const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
          const loadedProxyVars = proxyVars.filter(key => environmentVariables[key]);
          if (loadedProxyVars.length > 0) {
            log.info(`🌐 Proxy variables detected:`, loadedProxyVars.join(', '));
          }
        }
      } else {
        log.info(`📦 Using SDK bundled CLI (no provider found)`);
      }
    }
  } catch (error) {
    log.error('Failed to resolve config:', error);
    log.info(`📦 Using SDK bundled CLI (fallback due to error)`);
  }

  // When engine is claude-internal-sdk and no explicit path was resolved from
  // the provider config, try to locate the claude-internal CLI on the system.
  // This prevents the SDK from falling back to its bundled `claude` CLI.
  if (!executablePath) {
    const { isClaudeInternalEngine, getClaudeCliName } = await import('../config/engineConfig.js');
    if (isClaudeInternalEngine()) {
      const internalCliName = getClaudeCliName();
      const internalPath = await getSystemClaudeExecutablePath(internalCliName).catch(() => null);
      if (internalPath) {
        executablePath = internalPath;
        log.info(`🎯 Auto-detected ${internalCliName} CLI at: ${executablePath}`);
      } else {
        log.warn(`⚠️  ${internalCliName} CLI not found — SDK will use bundled claude CLI (engine mismatch possible)`);
      }
    }
  }

  if (executablePath) {
    log.info(`🎯 Custom Claude executable path: ${executablePath}`);
  } else {
    log.info(`📦 No custom path specified, SDK will use bundled CLI`);
  }

  // Determine final system prompt
  const finalSystemPrompt: SystemPrompt = agent.systemPrompt;

  const queryOptions: Options = {
    systemPrompt: finalSystemPrompt,
    allowedTools,
    disallowedTools: ['AskUserQuestion'],
    maxTurns: agent.maxTurns,
    cwd,
    permissionMode: finalPermissionMode as any,
    model: finalModel,
    settingSources: ["user", "project"],
  };

  // On Windows, the SDK spawns "node" to run cli.js but child_process.spawn()
  // without shell:true may fail to find "node" if PATH is not correctly inherited.
  // We need to ensure node.exe can be found.
  let windowsNodeDir: string | null = null;
  if (process.platform === 'win32') {
    // CRITICAL: In packaged app, process.execPath is clawstudio-backend.exe (a bun-compiled
    // single-file executable). Using it as executable would run the embedded backend code
    // instead of just the CLI, causing port conflicts and hanging issues.
    // We must use the system-installed Node.js instead.
    windowsNodeDir = findWindowsNodeDir();
    // Always set executable to 'node' (SDK only accepts 'node' | 'bun' | 'deno')
    // The actual node.exe location is handled via PATH below
    queryOptions.executable = 'node';
    if (windowsNodeDir) {
      log.info(`🔧 [Windows] Found system Node.js at: ${windowsNodeDir}`);
    } else {
      log.warn(`⚠️ [Windows] Could not find system Node.js directory`);
    }
  }

  // Only add pathToClaudeCodeExecutable if we have a valid path
  if (executablePath) {
    queryOptions.pathToClaudeCodeExecutable = executablePath;
  }

  // Load project-specific environment variables if we're in a project context
  let projectEnv: Record<string, string> = {};
  if (projectPath) {
    try {
      const dirName = path.basename(projectPath);
      const projectMeta = projectStorage.getProjectMetadata(dirName);
      if (projectMeta && projectMeta.env) {
        projectEnv = projectMeta.env;
      }
    } catch (e) {
      log.warn(`⚠️ Failed to load project environment variables for ${projectPath}:`, e);
    }
  }

  // Always merge environment variables with process.env
  // This ensures critical variables like PATH, etc. are available
  // Priority: userEnv > projectEnv > environmentVariables (from version/default) > process.env
  queryOptions.env = { ...process.env, ...environmentVariables, ...projectEnv, ...userEnv };

  // Prevent claude-internal's @tencent/update-notifier from spawning detached
  // check.js processes on every invocation — these accumulate as orphans and
  // cause severe CPU/network load (fork-bomb behavior observed in Desktop).
  queryOptions.env['NO_UPDATE_NOTIFIER'] = '1';

  // Inject Admin CLI environment variables (API key + server URL)
  // so agents can use `agentstudio admin call ...` without manual configuration
  const adminCliEnv = getAdminCliEnvVars();
  for (const [key, value] of Object.entries(adminCliEnv)) {
    if (!queryOptions.env[key]) {
      queryOptions.env[key] = value;
    }
  }

  // Prepend ~/.agentstudio/bin to PATH so the `agentstudio` CLI wrapper is available
  const adminBinDir = getAdminCliBinDir();
  let currentPath = queryOptions.env['PATH'] || '';
  const pathSep = process.platform === 'win32' ? ';' : ':';

  // On Windows, ensure Node.js directory is first in PATH
  if (process.platform === 'win32' && windowsNodeDir && !currentPath.includes(windowsNodeDir)) {
    currentPath = `${windowsNodeDir}${pathSep}${currentPath}`;
  }

  if (!currentPath.includes(adminBinDir)) {
    currentPath = `${adminBinDir}${pathSep}${currentPath}`;
  }

  // Augment PATH with well-known Node dirs so SDK child processes can also
  // find node, npm, and CLI binaries in GUI-launched (minimal PATH) scenarios
  for (const dir of getWellKnownNodeBinDirs()) {
    if (fs.existsSync(dir) && !currentPath.includes(dir)) {
      currentPath = `${currentPath}${pathSep}${dir}`;
    }
  }

  queryOptions.env['PATH'] = currentPath;

  // Normalize proxy variables: if uppercase is set, also set lowercase (and vice versa)
  // This ensures proxy settings work regardless of which form the client library checks first
  const proxyNormalizations = [
    ['HTTP_PROXY', 'http_proxy'],
    ['HTTPS_PROXY', 'https_proxy'],
    ['NO_PROXY', 'no_proxy'],
    ['ALL_PROXY', 'all_proxy']
  ];

  for (const [upper, lower] of proxyNormalizations) {
    if (environmentVariables[upper] && !environmentVariables[lower]) {
      // If uppercase is configured but lowercase isn't, set lowercase to match
      queryOptions.env[lower] = environmentVariables[upper];
    } else if (environmentVariables[lower] && !environmentVariables[upper]) {
      // If lowercase is configured but uppercase isn't, set uppercase to match
      queryOptions.env[upper] = environmentVariables[lower];
    }
  }

  if (Object.keys(environmentVariables).length > 0) {
    // Log final proxy configuration that will be used
    const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
    const finalProxyVars = proxyVars.filter(key => queryOptions.env?.[key]);

    // Log API keys presence (but not values)
    const apiKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
    const configuredApiKeys = apiKeys.filter(key => queryOptions.env?.[key]);
    if (configuredApiKeys.length > 0) {
      log.info(`🔑 API keys configured:`, configuredApiKeys);
    }
  } else {
    log.info(`🌍 Using process environment variables (no custom variables defined)`);
  }

  // Add MCP configuration: merge frontend-selected tools + engine-native MCP servers
  {
    const mcpServers: Record<string, any> = {};

    // 1. Add frontend-selected MCP tools from AgentStudio config (~/.agentstudio/data/mcp-server.json)
    if (mcpTools && mcpTools.length > 0) {
      try {
        const mcpConfigContent = readMcpConfig();

        // Extract unique server names from mcpTools
        const serverNames = new Set<string>();
        for (const tool of mcpTools) {
          // Tool format: mcp__serverName__toolName or mcp__serverName
          const parts = tool.split('__');
          if (parts.length >= 2 && parts[0] === 'mcp') {
            serverNames.add(parts[1]);
          }
        }

        for (const serverName of serverNames) {
          const serverConfig = mcpConfigContent.mcpServers?.[serverName];
          if (serverConfig && serverConfig.status === 'active') {
            if (serverConfig.type === 'http') {
              mcpServers[serverName] = {
                type: 'http',
                url: serverConfig.url,
                headers: serverConfig.headers || {}
              };
            } else if (serverConfig.type === 'stdio') {
              mcpServers[serverName] = {
                type: 'stdio',
                command: serverConfig.command,
                args: serverConfig.args || [],
                env: serverConfig.env || {}
              };
            }
          }
        }
      } catch (error) {
        log.error('Failed to parse MCP configuration:', error);
      }
    }

    // 2. Auto-include ALL engine-native MCP servers (e.g. ~/.cursor/mcp.json, ~/.claude/mcp.json)
    //    These are always enabled without requiring active status or frontend selection
    try {
      const engineServers = readEngineMcpConfig();
      for (const [name, config] of Object.entries(engineServers)) {
        // Skip if already added from AgentStudio config (avoid duplicates)
        if (mcpServers[name]) continue;

        if (config.url) {
          mcpServers[name] = {
            type: 'http',
            url: config.url,
            headers: config.headers || {}
          };
        } else if (config.command) {
          mcpServers[name] = {
            type: 'stdio',
            command: config.command,
            args: config.args || [],
            env: config.env || {}
          };
        }
      }
    } catch (error) {
      log.error('Failed to load engine MCP configuration:', error);
    }

    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      log.info('🔧 MCP Servers configured:', Object.keys(mcpServers));
    }
  }

  // Integrate A2A SDK MCP server
  // We use the determined project path or current working directory
  const currentProjectId = projectPath || cwd;
  await integrateA2AMcpServer(queryOptions, currentProjectId, a2aStreamEnabled ?? false);

  // Integrate LAVS SDK MCP server
  // Pass projectPath for project-level data isolation
  if (agent.id) {
    // Use require() instead of dynamic import() for compatibility with Worker threads
    // running under tsx/cjs loader. Dynamic import() bypasses the CJS tsx loader and
    // uses ESM resolution which cannot resolve .js -> .ts file mappings.

    const { integrateLAVSMcpServer } = require('../lavs/lavs-integration') as typeof import('../lavs/lavs-integration.js');
    await integrateLAVSMcpServer(queryOptions, agent.id, projectPath);
  }

  // Integrate A2UI MCP server for rich UI rendering
  await integrateA2UIMcpServer(queryOptions);

  // Integrate frontend tool MCP servers (includes ask_user_question + client-provided tools)
  let frontendToolSessionRef: SessionRef | null = null;
  if (sessionIdForAskUser && agentIdForAskUser) {
    const integration = await integrateFrontendTools(queryOptions, sessionIdForAskUser, agentIdForAskUser, frontendTools);
    frontendToolSessionRef = integration.sessionRef;
  }

  return { queryOptions, frontendToolSessionRef };
}

