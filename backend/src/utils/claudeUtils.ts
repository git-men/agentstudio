/**
 * Claude Utils - Shared utilities for Claude Code SDK integration
 * 
 * This module provides common functions for interacting with Claude Code SDK,
 * used by both the main agents API and Slack integration.
 */

import { Options } from '@anthropic-ai/claude-agent-sdk';
import { SystemPrompt, PresetSystemPrompt } from '../types/agents.js';
import * as fs from 'fs';
import * as path from 'path';

import { exec } from 'child_process';
import { promisify } from 'util';
import { getDefaultVersionId, getAllVersionsInternal, getVersionByIdInternal } from '../services/claudeVersionStorage.js';
import { integrateA2AMcpServer } from '../services/a2a/a2aIntegration.js';
import { integrateFrontendTools, type SessionRef } from '../services/frontendTools/index.js';
import { integrateA2UIMcpServer } from '../services/a2ui/a2uiIntegration.js';
import { resolveConfig } from './configResolver.js';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage.js';

const projectStorage = new ProjectMetadataStorage();

export type { SessionRef };
import { MCP_SERVER_CONFIG_FILE, AGENTSTUDIO_HOME, resolvePath } from '../config/paths.js';
import { getEnginePaths } from '../config/engineConfig.js';
import { getAdminCliEnvVars, getAdminCliBinDir } from '../services/mcpAdmin/autoBootstrap.js';

const execAsync = promisify(exec);

/**
 * Find the system-installed Node.js directory on Windows.
 * 
 * When running in a packaged app (clawstudio-backend.exe), process.execPath
 * points to the bun-compiled single-file executable, which cannot be used
 * as a Node.js runtime for spawning external JS files.
 * 
 * This function locates the actual Node.js installation directory so we can
 * add it to PATH before spawning the SDK.
 * 
 * @returns Directory containing node.exe, or null if not found
 */
function findWindowsNodeDir(): string | null {
  // Common Node.js installation paths on Windows
  const possibleDirs = [
    // Program Files (64-bit)
    'C:\\Program Files\\nodejs',
    // Program Files (x86) (32-bit)
    'C:\\Program Files (x86)\\nodejs',
    // User-specific installation via nvm-windows
    path.join(process.env.USERPROFILE || '', 'scoop\\apps\\nodejs\\current'),
    // nvm-windows default
    path.join(process.env.APPDATA || '', 'nvm\\current'),
  ];

  for (const dir of possibleDirs) {
    const nodeExe = path.join(dir, 'node.exe');
    if (fs.existsSync(nodeExe)) {
      return dir;
    }
  }

  // Try to find via `where node` command
  try {
    const result = require('child_process').execFileSync('where', ['node'], { encoding: 'utf8', timeout: 2000 });
    const lines = result.trim().split('\n');
    if (lines.length > 0) {
      const nodePath = lines[0].trim();
      if (fs.existsSync(nodePath)) {
        return path.dirname(nodePath);
      }
    }
  } catch {
    // `where` command failed, ignore
  }

  return null;
}

/**
 * On Windows, resolve an npm global executable path to its actual .js entry point.
 *
 * npm global installs create three files:
 *   - `claude-internal`     (POSIX shell script — cannot spawn on Windows)
 *   - `claude-internal.cmd` (batch wrapper — spawn returns EINVAL without shell:true)
 *   - `claude-internal.ps1` (PowerShell wrapper)
 *
 * The Claude Agent SDK uses child_process.spawn() without shell:true, so neither
 * the shell script nor .cmd can be executed. The SDK checks if the path ends with
 * a JS extension (.js/.mjs/.ts etc.) — if not, it treats it as a native binary
 * and tries to spawn it directly, which fails.
 *
 * This function parses the .cmd file to extract the actual .js entry path that
 * the SDK can spawn via `node <path.js>`.
 *
 * @param executablePath - Path like "C:\Users\x\AppData\Roaming\npm\claude-internal"
 * @returns The resolved .js path, or null if it cannot be determined
 */
function resolveWindowsNpmGlobalJsEntry(executablePath: string): string | null {
  try {
    const cmdPath = executablePath.endsWith('.cmd') ? executablePath : `${executablePath}.cmd`;
    if (!fs.existsSync(cmdPath)) return null;

    const content = fs.readFileSync(cmdPath, 'utf-8');

    // npm .cmd wrappers end with a line like:
    //   "%_prog%"  "%dp0%\node_modules\@tencent\claude-code-internal\dist\claude-code-internal.js" %*
    // We extract the .js path relative to %dp0% (the directory containing the .cmd file)
    const match = content.match(/%dp0%\\([^"]+\.js)/i) || content.match(/%dp0%\/([^"]+\.js)/i);
    if (!match) {
      console.warn(`⚠️  Could not parse .js entry from: ${cmdPath}`);
      return null;
    }

    const basedir = path.dirname(cmdPath);
    const jsRelPath = match[1].replace(/\//g, path.sep);
    const jsAbsPath = path.resolve(basedir, jsRelPath);

    if (fs.existsSync(jsAbsPath)) {
      console.log(`🎯 Resolved Windows npm global → JS entry: ${jsAbsPath}`);
      return jsAbsPath;
    }

    console.warn(`⚠️  Resolved JS path does not exist: ${jsAbsPath}`);
    return null;
  } catch (error) {
    console.error(`Failed to resolve Windows npm global JS entry for: ${executablePath}`, error);
    return null;
  }
}

/**
 * Get the path to the system-installed Claude executable
 * Only used when user explicitly wants to use system installation
 *
 * Note: When no executable path is specified, SDK will automatically
 * use its bundled CLI which is always compatible with the SDK version.
 * 
 * @param cliName - CLI executable name (e.g., 'claude' or 'claude-internal')
 */
export async function getSystemClaudeExecutablePath(cliName?: string): Promise<string | null> {
  const resolvedCliName = cliName || 'claude';
  try {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `where ${resolvedCliName}` : `which ${resolvedCliName}`;

    const { stdout: claudePath } = await execAsync(command);
    if (!claudePath) return null;

    const pathCandidates = claudePath
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (pathCandidates.length === 0) return null;

    const cleanPath = pathCandidates[0];

    // Skip local node_modules paths - we want global installation
    if (cleanPath.includes('node_modules/.bin') || cleanPath.includes('node_modules\\.bin')) {
      try {
        const allCommand = isWindows ? `where ${resolvedCliName}` : `which -a ${resolvedCliName}`;
        const { stdout: allClaudes } = await execAsync(allCommand);
        const claudes = allClaudes
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        // Find the first non-local installation
        for (const claudePathOption of claudes) {
          if (!claudePathOption.includes('node_modules/.bin') &&
              !claudePathOption.includes('node_modules\\.bin')) {
            if (isWindows) {
              const jsEntryPath = resolveWindowsNpmGlobalJsEntry(claudePathOption);
              if (jsEntryPath) {
                return jsEntryPath;
              }

              if (fs.existsSync(claudePathOption)) {
                return claudePathOption;
              }

              continue;
            }

            return claudePathOption;
          }
        }
      } catch (error) {
        // Fallback to the first path found
      }
    }

    // On Windows, npm global installs create:
    //   1. A POSIX shell script (e.g. "claude-internal") — cannot be spawned on Windows
    //   2. A .cmd wrapper (e.g. "claude-internal.cmd") — cannot be spawned by SDK (EINVAL)
    // The SDK's spawn expects either a native binary or a .js file.
    // We parse the .cmd to extract the actual .js entry point.
    if (isWindows) {
      for (const candidatePath of pathCandidates) {
        const jsEntryPath = resolveWindowsNpmGlobalJsEntry(candidatePath);
        if (jsEntryPath) {
          return jsEntryPath;
        }

        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }

      console.warn(`⚠️  Claude executable not found at any resolved path: ${pathCandidates.join(', ')}`);
      console.warn(`   SDK will use bundled CLI instead`);
      return null;
    }

    return cleanPath;
  } catch (error) {
    console.error(`Failed to get system ${resolvedCliName} executable path:`, error);
    return null;
  }
}

/**
 * @deprecated Use SDK's bundled CLI by not passing pathToClaudeCodeExecutable
 * This function is kept for backward compatibility when user explicitly configures a path
 */
export async function getClaudeExecutablePath(): Promise<string | null> {
  return getSystemClaudeExecutablePath();
}

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
function readEngineMcpConfig(): Record<string, any> {
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

/**
 * Get default Claude version environment variables
 */
export async function getDefaultClaudeVersionEnv(): Promise<Record<string, string> | null> {
  try {
    const defaultVersionId = await getDefaultVersionId();
    if (defaultVersionId) {
      console.log(`🔍 Found default Claude version: ${defaultVersionId}`);

      const allVersions = await getAllVersionsInternal();
      const defaultVersion = allVersions.find(v => v.id === defaultVersionId);

      if (defaultVersion && defaultVersion.environmentVariables) {
        console.log(`🎯 Using default Claude version: ${defaultVersion.name} (${defaultVersion.alias})`);

        // Log all environment variables
        const envKeys = Object.keys(defaultVersion.environmentVariables);
        console.log(`📝 Environment variables from default version:`, envKeys);

        // Log proxy-related variables
        const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
        const configuredProxyVars = proxyVars.filter(key => defaultVersion.environmentVariables![key]);
        if (configuredProxyVars.length > 0) {
          console.log(`🌐 Proxy variables in default version:`, configuredProxyVars.reduce((acc, key) => {
            acc[key] = defaultVersion.environmentVariables![key];
            return acc;
          }, {} as Record<string, string>));
        }

        // Check if this version has API keys configured
        const hasApiKey = defaultVersion.environmentVariables.ANTHROPIC_API_KEY ||
          defaultVersion.environmentVariables.OPENAI_API_KEY ||
          defaultVersion.environmentVariables.ANTHROPIC_AUTH_TOKEN;

        if (hasApiKey) {
          console.log(`✅ Default Claude version has API key configured`);
          return defaultVersion.environmentVariables;
        } else {
          console.log(`⚠️ No API keys found in default version environment variables`);
        }
      }
    }

    console.log(`⚠️ No default Claude version with API keys found`);
    return null;
  } catch (error) {
    console.error('❌ Error getting default Claude version:', error);
    return null;
  }
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
      console.log(`🎯 Using provided default environment variables (SDK bundled CLI)`);
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
              console.log(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (resolved JS entry: ${executablePath})`);
            } else if (fs.existsSync(configuredPath)) {
              executablePath = configuredPath;
              console.log(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (custom path: ${executablePath})`);
            } else {
              console.warn(`⚠️  Configured Claude path not found: ${configuredPath}`);
              console.warn(`   SDK will use bundled CLI for better compatibility`);
            }
          } else if (fs.existsSync(configuredPath)) {
            executablePath = configuredPath;
            console.log(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (custom path: ${executablePath})`);
          } else {
            console.warn(`⚠️  Configured Claude path not found: ${configuredPath}`);
            console.warn(`   This often happens on Windows when npm's claude wrapper (.cmd) is detected`);
            console.warn(`   SDK will use bundled CLI for better compatibility`);
            // Leave executablePath as null to use SDK bundled CLI
          }
        } else {
          console.log(`🎯 Using Claude version: ${resolvedConfig.provider.alias} (SDK bundled CLI)`);
        }
        environmentVariables = resolvedConfig.provider.environmentVariables || {};

        // Log environment variables details
        const envVarKeys = Object.keys(environmentVariables);
        if (envVarKeys.length > 0) {
          console.log(`📝 Environment variables loaded from provider config:`, envVarKeys);
          // Log proxy-related variables specifically
          const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
          const loadedProxyVars = proxyVars.filter(key => environmentVariables[key]);
          if (loadedProxyVars.length > 0) {
            console.log(`🌐 Proxy variables detected:`, loadedProxyVars.reduce((acc, key) => {
              acc[key] = environmentVariables[key];
              return acc;
            }, {} as Record<string, string>));
          }
        }
      } else {
        console.log(`📦 Using SDK bundled CLI (no provider found)`);
      }
    }
  } catch (error) {
    console.error('Failed to resolve config:', error);
    console.log(`📦 Using SDK bundled CLI (fallback due to error)`);
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
        console.log(`🎯 Auto-detected ${internalCliName} CLI at: ${executablePath}`);
      } else {
        console.warn(`⚠️  ${internalCliName} CLI not found — SDK will use bundled claude CLI (engine mismatch possible)`);
      }
    }
  }

  if (executablePath) {
    console.log(`🎯 Custom Claude executable path: ${executablePath}`);
  } else {
    console.log(`📦 No custom path specified, SDK will use bundled CLI`);
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
      console.log(`🔧 [Windows] Found system Node.js at: ${windowsNodeDir}`);
    } else {
      console.warn(`⚠️ [Windows] Could not find system Node.js directory`);
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
      console.warn(`⚠️ Failed to load project environment variables for ${projectPath}:`, e);
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
  // This is critical for packaged apps where process.execPath is clawstudio-backend.exe
  if (process.platform === 'win32' && windowsNodeDir && !currentPath.includes(windowsNodeDir)) {
    currentPath = `${windowsNodeDir}${pathSep}${currentPath}`;
  }
  
  if (!currentPath.includes(adminBinDir)) {
    currentPath = `${adminBinDir}${pathSep}${currentPath}`;
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
      console.log(`🔑 API keys configured:`, configuredApiKeys);
    }
  } else {
    console.log(`🌍 Using process environment variables (no custom variables defined)`);
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
        console.error('Failed to parse MCP configuration:', error);
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
      console.error('Failed to load engine MCP configuration:', error);
    }

    if (Object.keys(mcpServers).length > 0) {
      queryOptions.mcpServers = mcpServers;
      console.log('🔧 MCP Servers configured:', Object.keys(mcpServers));
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

