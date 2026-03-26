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
 * Get the path to the system-installed Claude executable
 * Only used when user explicitly wants to use system installation
 *
 * Note: When no executable path is specified, SDK will automatically
 * use its bundled CLI which is always compatible with the SDK version.
 * 
 * @param sdkEngine - SDK engine to use (claude-code or claude-internal)
 */
export async function getSystemClaudeExecutablePath(sdkEngine?: string): Promise<string | null> {
  try {
    const isWindows = process.platform === 'win32';
    
    // Determine which CLI to search for based on SDK engine
    const cliName = sdkEngine === 'claude-internal' ? 'claude-internal' : 'claude';
    const command = isWindows ? `where ${cliName}` : `which ${cliName}`;

    const { stdout: claudePath } = await execAsync(command);
    if (!claudePath) return null;

    const cleanPath = claudePath.trim();

    // Skip local node_modules paths - we want global installation
    if (cleanPath.includes('node_modules/.bin') || cleanPath.includes('node_modules\\.bin')) {
      try {
        const allCommand = isWindows ? `where ${cliName}` : `which -a ${cliName}`;
        const { stdout: allClaudes } = await execAsync(allCommand);
        const claudes = allClaudes.trim().split('\n');

        // Find the first non-local installation
        for (const claudePathOption of claudes) {
          if (!claudePathOption.includes('node_modules/.bin') &&
              !claudePathOption.includes('node_modules\\.bin')) {
            return claudePathOption.trim();
          }
        }
      } catch (error) {
        // Fallback to the first path found
      }
    }

    // On Windows, handle .cmd files
    if (isWindows) {
      let pathToCheck = cleanPath;
      
      // If path doesn't end with .cmd, try adding it
      if (!pathToCheck.endsWith('.cmd')) {
        const cmdPath = `${pathToCheck}.cmd`;
        if (fs.existsSync(cmdPath)) {
          pathToCheck = cmdPath;
          console.log(`📦 Found Windows .cmd wrapper at: ${cmdPath}`);
          console.log(`   Using SDK bundled CLI for better compatibility`);
          return null; // Let SDK use bundled CLI
        }
      }
      
      // Verify the path exists
      if (!fs.existsSync(pathToCheck)) {
        console.warn(`⚠️  Claude executable not found at: ${pathToCheck}`);
        console.warn(`   SDK will use bundled CLI instead`);
        return null;
      }

      // If the path points to a .cmd file, let SDK use its bundled version
      if (pathToCheck.endsWith('.cmd')) {
        console.log(`📦 Found Windows .cmd wrapper at: ${pathToCheck}`);
        console.log(`   Using SDK bundled CLI for better compatibility`);
        return null;
      }
    }

    return cleanPath;
  } catch (error) {
    console.error(`Failed to get system ${sdkEngine || 'claude'} executable path:`, error);
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
  const allowedTools = agent.allowedTools
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

          // Validate the path exists before using it
          if (fs.existsSync(configuredPath)) {
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
  const currentPath = queryOptions.env['PATH'] || '';
  if (!currentPath.includes(adminBinDir)) {
    queryOptions.env['PATH'] = `${adminBinDir}:${currentPath}`;
  }

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

