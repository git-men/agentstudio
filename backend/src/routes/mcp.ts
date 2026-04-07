import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { parse as parseToml } from '@iarna/toml';
import { MCP_SERVER_CONFIG_FILE } from '../config/paths.js';
import { logger } from '../utils/logger.js';

const log = logger.child('mcp');
import { isCursorEngine, isCodebuddyEngine, isCodexEngine, getEnginePaths, getEngineType, getSdkConfigPath } from '../config/engineConfig.js';
import { getSystemMcpServers } from '../services/mcpAdmin/autoBootstrap.js';
import { PRESET_MCP_SERVERS, PRESET_CATEGORIES } from '../data/preset-mcp-servers.js';
import { getKnotMcpServers } from '../services/knotMcpService.js';
import { atomicWriteFileSync } from '../utils/fileUtils.js';

const router: express.Router = express.Router();
const execAsync = promisify(exec);

const SAFE_COMMAND_PATTERN = /^[a-zA-Z0-9_\-./~@:]+$/;

export function validateMcpCommand(command: string): boolean {
  if (!SAFE_COMMAND_PATTERN.test(command)) return false;
  if (command.includes('..')) return false;
  return true;
}

export function validateMcpArgs(args: string[]): boolean {
  for (const arg of args) {
    if (typeof arg !== 'string') return false;
    if (/[`$|;&<>]/.test(arg)) return false;
  }
  return true;
}

// MCP configuration interface
interface McpServerConfig {
  name: string;
  type: 'stdio' | 'http';
  // For stdio type
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For http type
  url?: string;
  headers?: Record<string, string>;
  // Common fields (autoApprove is not implemented yet)
  autoApprove?: string[];
  status?: 'active' | 'error' | 'validating';
  error?: string;
  tools?: string[];
  lastValidated?: string;
  // Plugin source tracking
  source: 'local' | 'plugin'; // 来源：本地创建或插件安装
  installPath?: string; // 插件 MCP 的真实安装路径
  // Allow any additional fields
  [key: string]: any;
}

export interface McpConfigFile {
  mcpServers: Record<string, Omit<McpServerConfig, 'name'>>;
}

export const isMcpReadOnlyEngine = (): boolean => {
  return isCursorEngine() || isCodebuddyEngine() || isCodexEngine();
};

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, string> = {};
  for (const [key, mapValue] of Object.entries(value)) {
    result[key] = String(mapValue);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function parseCodexTomlMcpConfig(content: string): McpConfigFile {
  try {
    const parsed = parseToml(content) as Record<string, unknown>;
    const mcpServersRaw = parsed.mcp_servers;
    if (!mcpServersRaw || typeof mcpServersRaw !== 'object') {
      return { mcpServers: {} };
    }

    const mcpServers: Record<string, Omit<McpServerConfig, 'name'>> = {};

    for (const [name, serverRaw] of Object.entries(mcpServersRaw)) {
      if (!serverRaw || typeof serverRaw !== 'object') {
        continue;
      }

      const server = serverRaw as Record<string, unknown>;
      const explicitType = server.type === 'http' || server.type === 'stdio' ? server.type : undefined;
      const transportType = server.transport === 'http' || server.transport === 'stdio' ? server.transport : undefined;
      const inferredType: 'http' | 'stdio' = explicitType || transportType || (typeof server.url === 'string' ? 'http' : 'stdio');

      const normalized: Omit<McpServerConfig, 'name'> = {
        type: inferredType,
        source: 'local',
      };

      if (typeof server.command === 'string') {
        normalized.command = server.command;
      }
      if (Array.isArray(server.args)) {
        normalized.args = server.args.map(String);
      }
      if (typeof server.url === 'string') {
        normalized.url = server.url;
      }

      const env = normalizeStringMap(server.env);
      if (env) normalized.env = env;
      const headers = normalizeStringMap(server.headers);
      if (headers) normalized.headers = headers;

      if (Array.isArray(server.autoApprove)) {
        normalized.autoApprove = server.autoApprove.map(String);
      } else if (Array.isArray(server.auto_approve)) {
        normalized.autoApprove = server.auto_approve.map(String);
      }

      if (server.status === 'active' || server.status === 'error' || server.status === 'validating') {
        normalized.status = server.status;
      }
      if (typeof server.error === 'string') {
        normalized.error = server.error;
      }
      if (Array.isArray(server.tools)) {
        normalized.tools = server.tools.map(String);
      }
      if (typeof server.lastValidated === 'string') {
        normalized.lastValidated = server.lastValidated;
      } else if (typeof server.last_validated === 'string') {
        normalized.lastValidated = server.last_validated;
      }

      mcpServers[name] = normalized;
    }

    return { mcpServers };
  } catch (error) {
    log.error('Failed to parse Codex MCP config from TOML:', error);
    return { mcpServers: {} };
  }
}

// Helper function to get MCP config file path (engine-aware)
const getMcpConfigPath = (): string => {
  if (isCursorEngine() || isCodebuddyEngine() || isCodexEngine()) {
    return getEnginePaths().mcpConfigPath;
  }
  return MCP_SERVER_CONFIG_FILE;
};

// Helper function to ensure config directory exists
const ensureConfigDirectory = (configPath: string): void => {
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
};

// Helper function to read MCP config (exported for use by other modules)
export const readMcpConfig = (): McpConfigFile => {
  const configPath = getMcpConfigPath();
  
  let config: McpConfigFile = { mcpServers: {} };

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');

      if (isCodexEngine()) {
        config = parseCodexTomlMcpConfig(content);
      } else {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).mcpServers === 'object') {
          config = parsed as McpConfigFile;
        }
      }
    } catch (error) {
      log.error('Failed to read MCP config:', error);
    }
  }

  // For read-only engines (Cursor, Codebuddy, Codex), merge system MCP servers
  // from the native config so that built-in servers like agentstudio-admin
  // are always available regardless of the engine's own config.
  if (isMcpReadOnlyEngine()) {
    const systemServers = getSystemMcpServers();
    for (const [name, serverConfig] of Object.entries(systemServers)) {
      if (!config.mcpServers[name]) {
        config.mcpServers[name] = serverConfig;
      }
    }
  }

  return config;
};

// Helper function to write MCP config (exported for use by other modules)
export const writeMcpConfig = (config: McpConfigFile): void => {
  const configPath = getMcpConfigPath();

  if (isMcpReadOnlyEngine()) {
    throw new Error(`MCP configuration is read-only for engine: ${getEngineType()}`);
  }

  try {
    atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    log.error('Failed to write MCP config:', error);
    throw error;
  }
};

// Get all MCP configurations
/**
 * @swagger
 * /api/mcp:
 *   get:
 *     tags: [MCP]
 *     summary: 获取 MCP 服务列表
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
router.get('/', (req, res) => {
  try {
    const config = readMcpConfig();
    const servers: McpServerConfig[] = Object.entries(config.mcpServers).map(([name, serverConfig]) => ({
      name,
      ...serverConfig,
      // Add default source for Cursor configs
      source: serverConfig.source || 'local',
    } as McpServerConfig));

    // Include readOnly flag for Cursor engine
    res.json({ 
      servers,
      readOnly: isMcpReadOnlyEngine(),
      engine: getEngineType(),
    });
  } catch (error) {
    log.error('Failed to get MCP configs:', error);
    res.status(500).json({ error: 'Failed to retrieve MCP configurations' });
  }
});

// Add or update MCP configuration
/**
 * @swagger
 * /api/mcp:
 *   post:
 *     tags: [MCP]
 *     summary: 新增或保存 MCP 配置
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       403:
 *         description: 只读
 *       500:
 *         description: 服务器错误
 */
router.post('/', (req, res) => {
  try {
    // Check if in read-only mode (Cursor engine)
    if (isMcpReadOnlyEngine()) {
      return res.status(403).json({ 
        error: 'Read-only mode',
        message: 'MCP configuration is read-only for the current engine',
      });
    }

    const { name, type, ...restConfig } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Missing required fields: name, type' });
    }

    // Validate based on type
    if (type === 'stdio') {
      if (!restConfig.command || !Array.isArray(restConfig.args)) {
        return res.status(400).json({ error: 'For stdio type: command and args are required' });
      }
      if (!validateMcpCommand(restConfig.command)) {
        return res.status(400).json({ error: 'Invalid command: contains disallowed characters' });
      }
      if (!validateMcpArgs(restConfig.args)) {
        return res.status(400).json({ error: 'Invalid args: contains disallowed characters' });
      }
    } else if (type === 'http') {
      if (!restConfig.url) {
        return res.status(400).json({ error: 'For http type: url is required' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid type. Must be "stdio" or "http"' });
    }

    const config = readMcpConfig();

    // Create server config without name field, preserving all parameters
    const serverConfig: Omit<McpServerConfig, 'name'> = {
      type,
      ...restConfig,
      source: restConfig.source || 'local', // Default to 'local' for newly created configs
    };

    config.mcpServers[name] = serverConfig;
    writeMcpConfig(config);

    const responseServer: McpServerConfig = { name, ...serverConfig } as McpServerConfig;
    res.json({ server: responseServer, message: 'MCP configuration saved successfully' });
  } catch (error) {
    log.error('Failed to save MCP config:', error);
    res.status(500).json({ error: 'Failed to save MCP configuration' });
  }
});

// Update MCP configuration
/**
 * @swagger
 * /api/mcp/{name}:
 *   put:
 *     tags: [MCP]
 *     summary: 更新 MCP 配置
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       403:
 *         description: 只读
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.put('/:name', (req, res) => {
  try {
    if (isMcpReadOnlyEngine()) {
      return res.status(403).json({
        error: 'Read-only mode',
        message: 'MCP configuration is read-only for the current engine',
      });
    }

    const { name } = req.params;
    const { type, ...restConfig } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'Missing required field: type' });
    }

    // Validate based on type
    if (type === 'stdio') {
      if (!restConfig.command || !Array.isArray(restConfig.args)) {
        return res.status(400).json({ error: 'For stdio type: command and args are required' });
      }
      if (!validateMcpCommand(restConfig.command)) {
        return res.status(400).json({ error: 'Invalid command: contains disallowed characters' });
      }
      if (!validateMcpArgs(restConfig.args)) {
        return res.status(400).json({ error: 'Invalid args: contains disallowed characters' });
      }
    } else if (type === 'http') {
      if (!restConfig.url) {
        return res.status(400).json({ error: 'For http type: url is required' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid type. Must be "stdio" or "http"' });
    }

    const config = readMcpConfig();

    if (!config.mcpServers[name]) {
      return res.status(404).json({ error: 'MCP configuration not found' });
    }

    // Update server config, preserving all parameters
    const serverConfig: Omit<McpServerConfig, 'name'> = {
      type,
      ...restConfig
    };

    config.mcpServers[name] = serverConfig;
    writeMcpConfig(config);

    const responseServer: McpServerConfig = { name, ...serverConfig } as McpServerConfig;
    res.json({ server: responseServer, message: 'MCP configuration updated successfully' });
  } catch (error) {
    log.error('Failed to update MCP config:', error);
    res.status(500).json({ error: 'Failed to update MCP configuration' });
  }
});

// Delete MCP configuration
/**
 * @swagger
 * /api/mcp/{name}:
 *   delete:
 *     tags: [MCP]
 *     summary: 删除 MCP 配置
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       403:
 *         description: 只读
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.delete('/:name', (req, res) => {
  try {
    // Check if in read-only mode (Cursor engine)
    if (isMcpReadOnlyEngine()) {
      return res.status(403).json({ 
        error: 'Read-only mode',
        message: 'MCP configuration is read-only for the current engine',
      });
    }

    const { name } = req.params;
    const config = readMcpConfig();
    
    if (!config.mcpServers[name]) {
      return res.status(404).json({ error: 'MCP configuration not found' });
    }
    
    delete config.mcpServers[name];
    writeMcpConfig(config);
    
    res.json({ success: true, message: 'MCP configuration deleted successfully' });
  } catch (error) {
    log.error('Failed to delete MCP config:', error);
    res.status(500).json({ error: 'Failed to delete MCP configuration' });
  }
});

// Validate MCP server by testing connection and getting tools
/**
 * @swagger
 * /api/mcp/{name}/validate:
 *   post:
 *     tags: [MCP]
 *     summary: 校验 MCP 服务连通性
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 参数错误
 *       404:
 *         description: 未找到
 *       500:
 *         description: 服务器错误
 */
router.post('/:name/validate', async (req, res) => {
  try {
    const { name } = req.params;
    const config = readMcpConfig();
    const persistValidationState = !isMcpReadOnlyEngine();

    if (!config.mcpServers[name]) {
      return res.status(404).json({ error: 'MCP configuration not found' });
    }

    const serverConfig = config.mcpServers[name];

    // Auto-detect type if not specified
    if (!serverConfig.type) {
      if (serverConfig.url) {
        serverConfig.type = 'http';
      } else if (serverConfig.command) {
        serverConfig.type = 'stdio';
      } else {
        return res.status(400).json({ error: 'Cannot determine MCP server type. Please specify type, url, or command.' });
      }

      if (persistValidationState) {
        // Update config with detected type
        config.mcpServers[name] = serverConfig;
        writeMcpConfig(config);
        log.info(`Auto-detected type for ${name}: ${serverConfig.type}`);
      } else {
        log.info(`Auto-detected type for ${name} (not persisted due to read-only engine): ${serverConfig.type}`);
      }
    }

    if (serverConfig.type === 'http') {
      // Validate HTTP MCP server
      await validateHttpMcpServer(name, serverConfig, config, res, persistValidationState);
    } else if (serverConfig.type === 'stdio') {
      // Validate stdio MCP server
      await validateStdioMcpServer(name, serverConfig, config, res, persistValidationState);
    } else {
      res.status(400).json({ error: 'Invalid MCP server type. Must be "stdio" or "http".' });
    }
  } catch (error) {
    log.error('Failed to validate MCP server:', error);
    res.status(500).json({
      error: 'Failed to validate MCP server',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});



// Get MCP configurations from Agent SDK config file
/**
 * @swagger
 * /api/mcp/claude-code:
 *   get:
 *     tags: [MCP]
 *     summary: 从 SDK 配置读取 MCP 列表
 *     responses:
 *       200:
 *         description: 成功
 *       500:
 *         description: 服务器错误
 */
router.get('/claude-code', async (req, res) => {
  try {
    // Read SDK config file (e.g., ~/.claude.json or ~/.claude-internal.json)
    const claudeJsonPath = getSdkConfigPath();

    if (!fs.existsSync(claudeJsonPath)) {
      return res.json({ servers: [] });
    }

    const claudeJsonContent = fs.readFileSync(claudeJsonPath, 'utf-8');
    const claudeJson = JSON.parse(claudeJsonContent);

    // Extract MCP servers from all projects
    const servers: any[] = [];
    const seenServers = new Set<string>(); // To avoid duplicates

    if (claudeJson.projects) {
      for (const [projectPath, projectConfig] of Object.entries<any>(claudeJson.projects)) {
        if (projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
          for (const [serverName, serverConfig] of Object.entries<any>(projectConfig.mcpServers)) {
            // Skip if we've already added this server
            if (seenServers.has(serverName)) {
              continue;
            }
            seenServers.add(serverName);

            // Normalize the server configuration
            const server: any = {
              name: serverName,
              type: serverConfig.type || 'stdio',
              ...serverConfig
            };

            // Auto-detect type if not specified
            if (!server.type) {
              if (server.url) {
                server.type = 'http';
              } else if (server.command) {
                server.type = 'stdio';
              }
            }

            servers.push(server);
          }
        }
      }
    }

    log.info(`Found ${servers.length} MCP server(s) from Claude Code configuration`);
    res.json({ servers });
  } catch (error) {
    log.error('Failed to read Claude Code MCP configurations:', error);
    res.status(500).json({
      error: 'Failed to read Claude Code MCP configurations',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// GET /mcp/presets - Get preset MCP server catalog
/**
 * @swagger
 * /api/mcp/presets:
 *   get:
 *     tags: [MCP]
 *     summary: 获取 MCP 预设目录
 *     responses:
 *       200:
 *         description: 成功
 */
router.get('/presets', (_req, res) => {
  try {
    const config = readMcpConfig();
    const installedNames = new Set(Object.keys(config.mcpServers));

    const builtinPresets = PRESET_MCP_SERVERS.map(preset => ({
      ...preset,
      installed: installedNames.has(preset.serverName),
    }));

    const knotPresets = getKnotMcpServers().map(preset => ({
      ...preset,
      installed: installedNames.has(preset.serverName),
    }));

    res.json({
      presets: [...builtinPresets, ...knotPresets],
      categories: PRESET_CATEGORIES,
    });
  } catch (error) {
    log.error('Failed to load MCP presets:', error);
    res.json({
      presets: PRESET_MCP_SERVERS.map(p => ({ ...p, installed: false })),
      categories: PRESET_CATEGORIES,
    });
  }
});

export default router;

// Validate HTTP MCP server
async function validateHttpMcpServer(
  name: string,
  serverConfig: any,
  config: any,
  res: any,
  persistValidationState: boolean
) {
  let responseSent = false;

  // Helper function to send response only once
  const sendResponse = (statusCode: number, data: any) => {
    if (responseSent) {
      log.info('Response already sent, skipping duplicate response');
      return;
    }
    responseSent = true;
    if (statusCode === 200) {
      res.json(data);
    } else {
      res.status(statusCode).json(data);
    }
  };

  try {
    log.info('Validating HTTP MCP server:', serverConfig.url);

    // Test HTTP connection to MCP server
    // Merge user-configured headers with default headers
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      // User-configured headers override defaults
      ...(serverConfig.headers || {})
    };

    const response = await fetch(serverConfig.url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          clientInfo: {
            name: 'claude-code-studio',
            version: '1.0.0'
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    log.info('HTTP MCP initialize response:', { contentType, textLength: responseText.length });

    // Detect response format based on Content-Type and content
    let initResult: any = null;
    const isSSE = contentType.includes('text/event-stream') || responseText.includes('data:');

    if (isSSE) {
      // Parse SSE format response
      log.info('Parsing SSE format response');
      const lines = responseText.split('\n');

      for (const line of lines) {
        const trimmedLine = line.trim();
        // Look for data: lines which contain the actual JSON-RPC response
        if (trimmedLine.startsWith('data:')) {
          try {
            // Remove 'data:' prefix and parse JSON
            const jsonStr = trimmedLine.substring(5).trim();
            initResult = JSON.parse(jsonStr);
            log.info('Parsed SSE data:', initResult);
            break;
          } catch (e) {
            log.warn(`Failed to parse SSE data line: ${trimmedLine}`, e);
          }
        }
      }

      if (!initResult) {
        log.error('Failed to find valid data line in SSE response');
        throw new Error('Failed to parse HTTP MCP SSE response');
      }
    } else {
      // Parse plain JSON response
      log.info('Parsing plain JSON response');
      try {
        initResult = JSON.parse(responseText);
        log.info('Parsed JSON response:', initResult);
      } catch (e) {
        log.error('Failed to parse JSON response:', e);
        throw new Error('Failed to parse HTTP MCP JSON response');
      }
    }

    log.info('HTTP MCP initialize parsed result:', initResult);

    // Get tools from HTTP MCP server using proper session management
    let tools: string[] = [];
    log.info('Getting tools from HTTP MCP server...');

    try {
      tools = await getHttpMcpTools(serverConfig.url, serverConfig.headers);
      log.info('Successfully retrieved tools from HTTP MCP:', tools);
    } catch (error) {
      log.warn('Failed to get tools from HTTP MCP server:', error);
      // Don't fail validation just because tools retrieval failed
    }

    // Update server config with successful validation
    const currentTime = new Date().toISOString();
    if (config.mcpServers[name]) {
      config.mcpServers[name] = {
        ...config.mcpServers[name],
        status: 'active',
        tools,
        lastValidated: currentTime,
        error: undefined
      };
      if (persistValidationState) {
        writeMcpConfig(config);
      }
    }

    sendResponse(200, {
      success: true,
      tools,
      message: `HTTP MCP server validated successfully. Found ${tools.length} tools.`
    });

  } catch (error) {
    log.error('HTTP MCP server validation failed:', error);

    // Update server config with error status
    const currentTime = new Date().toISOString();
    if (config.mcpServers[name]) {
      config.mcpServers[name] = {
        ...config.mcpServers[name],
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        tools: undefined,
        lastValidated: currentTime
      };
      if (persistValidationState) {
        writeMcpConfig(config);
      }
    }

    sendResponse(400, {
      error: 'HTTP MCP server validation failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Validate stdio MCP server
async function validateStdioMcpServer(
  name: string,
  serverConfig: any,
  config: any,
  res: any,
  persistValidationState: boolean
) {
  if (!serverConfig.command || !serverConfig.args) {
    return res.status(400).json({ error: 'Missing command or args for stdio MCP server' });
  }

  // Start MCP server process to test connection
  log.info(`Starting stdio MCP server: ${serverConfig.command}`, serverConfig.args);
  log.info('Environment variables:', serverConfig.env);

  const spawnOptions: any = {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 60000  // Fixed 60-second timeout for validation
  };

  // Merge environment variables if provided
  if (serverConfig.env && Object.keys(serverConfig.env).length > 0) {
    spawnOptions.env = {
      ...process.env,
      ...serverConfig.env
    };
  }

  const child = spawn(serverConfig.command, serverConfig.args, spawnOptions);

  let stdout = '';
  let stderr = '';
  let tools: string[] = [];
  let responseSent = false; // Track if response has been sent

  // Helper function to send response only once
  const sendResponse = (statusCode: number, data: any) => {
    if (responseSent) {
      log.info('Response already sent, skipping duplicate response');
      return;
    }
    responseSent = true;
    if (statusCode === 200) {
      res.json(data);
    } else {
      res.status(statusCode).json(data);
    }
  };

  child.stderr?.on('data', (data) => {
    const errorStr = data.toString();
    log.info('MCP stderr:', errorStr);
    stderr += errorStr;
  });

  let initializeDone = false;

  // Send initialize request to MCP server
  const initializeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {}
      },
      clientInfo: {
        name: 'claude-code-studio',
        version: '1.0.0'
      }
    }
  };

  child.stdin?.write(JSON.stringify(initializeRequest) + '\n');

  let buffer = '';

  // Listen for stdout and parse responses in real-time
  child.stdout?.on('data', (data) => {
    const dataStr = data.toString();
    stdout += dataStr;
    buffer += dataStr;

    // Try to parse complete JSON messages
    const lines = buffer.split('\n');
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line);
        log.info('MCP response:', response);

        // Check if initialization was successful
        if (response.id === 1 && response.result && !initializeDone) {
          log.info('Initialize successful, sending initialized notification');
          initializeDone = true;

          // Send initialized notification
          const initializedNotification = {
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          };
          child.stdin?.write(JSON.stringify(initializedNotification) + '\n');

          // Send tools/list request
          setTimeout(() => {
            log.info('Sending tools/list request');
            const toolsRequest = {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/list',
              params: {}
            };
            child.stdin?.write(JSON.stringify(toolsRequest) + '\n');
          }, 500);
        }

        // Handle tools/list response
        if (response.id === 2 && response.result) {
          log.info('Tools/list response received:', response.result);
          if (response.result.tools) {
            tools = response.result.tools.map((tool: any) => tool.name);
            log.info('Found tools:', tools);
          }
          // Close stdin after getting tools response (even if empty)
          setTimeout(() => child.stdin?.end(), 100);
        }
      } catch (parseError) {
        // This might be a partial JSON, continue buffering
        log.info('Parse error for line:', line.substring(0, 100) + '...');
      }
    }

    // Also try to parse the buffer as a complete JSON in case it's all one response
    if (buffer.trim()) {
      try {
        const response = JSON.parse(buffer);
        log.info('MCP buffered response:', response);

        // Handle tools/list response from buffer
        if (response.id === 2 && response.result) {
          log.info('Tools/list response received from buffer:', response.result);
          if (response.result.tools) {
            tools = response.result.tools.map((tool: any) => tool.name);
            log.info('Found tools from buffer:', tools);
          }
          // Clear buffer and close stdin
          buffer = '';
          setTimeout(() => child.stdin?.end(), 100);
        }
      } catch (parseError) {
        // Buffer is not complete JSON yet, continue
      }
    }
  });

  const timeoutId = setTimeout(() => {
    child.kill('SIGTERM');
  }, 60000);  // Fixed 60-second timeout for validation

  child.on('close', (code) => {
    clearTimeout(timeoutId);

    try {
      const config = readMcpConfig();
      const currentTime = new Date().toISOString();

      if (code === 0 || tools.length > 0) {
        // Update server config with successful validation
        if (config.mcpServers[name]) {
          config.mcpServers[name] = {
            ...config.mcpServers[name],
            status: 'active',
            tools,
            lastValidated: currentTime,
            error: undefined
          };
          if (persistValidationState) {
            writeMcpConfig(config);
          }
        }

        sendResponse(200, {
          success: true,
          tools,
          message: `MCP server validated successfully. Found ${tools.length} tools.`
        });
      } else {
        // Update server config with error status
        const errorMessage = `MCP server validation failed with exit code ${code}`;
        if (config.mcpServers[name]) {
          config.mcpServers[name] = {
            ...config.mcpServers[name],
            status: 'error',
            error: errorMessage,
            tools: undefined,
            lastValidated: currentTime
          };
          if (persistValidationState) {
            writeMcpConfig(config);
          }
        }

        sendResponse(400, {
          error: errorMessage,
          details: stderr || 'No error details available'
        });
      }
    } catch (configError) {
      log.error('Failed to update config with validation result:', configError);

      // Still return the validation result even if config update fails
      if (code === 0 || tools.length > 0) {
        sendResponse(200, {
          success: true,
          tools,
          message: `MCP server validated successfully. Found ${tools.length} tools.`
        });
      } else {
        sendResponse(400, {
          error: `MCP server validation failed with exit code ${code}`,
          details: stderr || 'No error details available'
        });
      }
    }
  });

  child.on('error', (error) => {
    clearTimeout(timeoutId);

    try {
      const config = readMcpConfig();
      if (config.mcpServers[name]) {
        config.mcpServers[name] = {
          ...config.mcpServers[name],
          status: 'error',
          error: `Failed to start MCP server: ${error.message}`,
          tools: undefined,
          lastValidated: new Date().toISOString()
        };
        if (persistValidationState) {
          writeMcpConfig(config);
        }
      }
    } catch (configError) {
      log.error('Failed to update config with error status:', configError);
    }

    sendResponse(500, {
      error: 'Failed to start MCP server',
      details: error.message
    });
  });
}

/**
 * Get tools from HTTP MCP server using proper session management
 * HTTP MCP requires maintaining session state between initialize and tools/list calls
 * Supports both SSE and plain JSON response formats
 */
async function getHttpMcpTools(url: string, userHeaders?: Record<string, string>): Promise<string[]> {
  log.info('Starting HTTP MCP tools discovery for:', url);

  // Merge user-configured headers with default headers
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    // User-configured headers override defaults
    ...(userHeaders || {})
  };

  // Step 1: Initialize the session
  const initResponse = await fetch(url, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'agentstudio-validator',
          version: '1.0.0'
        }
      }
    })
  });

  if (!initResponse.ok) {
    throw new Error(`HTTP MCP initialize failed: ${initResponse.status} ${initResponse.statusText}`);
  }

  const initResponseText = await initResponse.text();
  const initContentType = initResponse.headers.get('content-type') || '';
  log.info('HTTP MCP initialize response:', { contentType: initContentType, textLength: initResponseText.length });

  // Detect response format
  const isSSE = initContentType.includes('text/event-stream') || initResponseText.includes('data:');

  // Parse initialize response
  let initResult: any = null;

  if (isSSE) {
    // Parse SSE format
    log.info('Parsing SSE format initialize response');
    const initLines = initResponseText.split('\n');
    for (const line of initLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data:')) {
        try {
          const jsonStr = trimmedLine.substring(5).trim();
          initResult = JSON.parse(jsonStr);
          log.info('Parsed init SSE data:', initResult);
          break;
        } catch (e) {
          log.warn(`Failed to parse init SSE data line: ${trimmedLine}`, e);
        }
      }
    }
  } else {
    // Parse plain JSON format
    log.info('Parsing plain JSON initialize response');
    try {
      initResult = JSON.parse(initResponseText);
      log.info('Parsed init JSON:', initResult);
    } catch (e) {
      log.error('Failed to parse init JSON:', e);
      throw new Error('Failed to parse initialize response');
    }
  }

  if (!initResult || !initResult.result) {
    log.error('Invalid or missing initialize response');
    throw new Error('Invalid initialize response from HTTP MCP server');
  }

  // Extract session ID from response headers
  const sessionId = initResponse.headers.get('mcp-session-id');
  log.info('HTTP MCP session ID:', sessionId);

  // Step 2: Get tools list using the session ID
  // Wait a bit to ensure the session is properly established
  await new Promise(resolve => setTimeout(resolve, 100));

  // Prepare headers for tools/list request
  const toolsHeaders: Record<string, string> = {
    ...baseHeaders  // Reuse base headers which include user-configured headers
  };

  // Add session ID if available
  if (sessionId) {
    toolsHeaders['mcp-session-id'] = sessionId;
  }

  // Copy any session cookies from the init response
  if (initResponse.headers.get('set-cookie')) {
    toolsHeaders['Cookie'] = initResponse.headers.get('set-cookie')!;
  }

  const toolsResponse = await fetch(url, {
    method: 'POST',
    headers: toolsHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    })
  });

  if (!toolsResponse.ok) {
    throw new Error(`HTTP MCP tools/list failed: ${toolsResponse.status} ${toolsResponse.statusText}`);
  }

  const toolsResponseText = await toolsResponse.text();
  const toolsContentType = toolsResponse.headers.get('content-type') || '';
  log.info('HTTP MCP tools/list response:', { contentType: toolsContentType, textLength: toolsResponseText.length });

  // Parse tools response
  let toolsResult: any = null;
  const toolsIsSSE = toolsContentType.includes('text/event-stream') || toolsResponseText.includes('data:');

  if (toolsIsSSE) {
    // Parse SSE format
    log.info('Parsing SSE format tools/list response');
    const toolsLines = toolsResponseText.split('\n');
    for (const line of toolsLines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('data:')) {
        try {
          const jsonStr = trimmedLine.substring(5).trim();
          toolsResult = JSON.parse(jsonStr);
          log.info('Parsed tools SSE data:', toolsResult);
          break;
        } catch (e) {
          log.warn(`Failed to parse tools SSE data line: ${trimmedLine}`, e);
        }
      }
    }
  } else {
    // Parse plain JSON format
    log.info('Parsing plain JSON tools/list response');
    try {
      toolsResult = JSON.parse(toolsResponseText);
      log.info('Parsed tools JSON:', toolsResult);
    } catch (e) {
      log.error('Failed to parse tools JSON:', e);
      throw new Error('Failed to parse tools/list response');
    }
  }

  if (!toolsResult) {
    log.error('Invalid or missing tools/list response');
    throw new Error('Invalid tools/list response from HTTP MCP server');
  }

  if (toolsResult.error) {
    throw new Error(`HTTP MCP tools/list error: ${toolsResult.error.message}`);
  }

  if (!toolsResult.result || !toolsResult.result.tools) {
    log.info('HTTP MCP server returned no tools');
    return [];
  }

  const tools = toolsResult.result.tools.map((tool: any) => tool.name);
  log.info('Extracted tools from HTTP MCP:', tools);
  return tools;
}
