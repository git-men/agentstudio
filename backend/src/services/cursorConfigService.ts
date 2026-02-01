/**
 * Cursor Configuration Service
 * 
 * Provides read access to Cursor CLI configuration files:
 * - MCP servers: ~/.cursor/mcp.json
 * - Rules: ~/.cursor/rules/*.mdc
 * - Commands: ~/.cursor/commands/*.md
 * - Skills: ~/.cursor/skills/ and ~/.cursor/skills-cursor/
 * - Plugins: ~/.cursor/plugins/
 * - Project data: ~/.cursor/projects/<hash>/
 * 
 * This service is read-only for Cursor configurations.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import matter from 'gray-matter';
import { getEnginePaths, projectPathToHash, getProjectDataDir } from '../config/engineConfig.js';
import type {
  McpConfig,
  McpServerConfig,
  RuleConfig,
  RuleFrontmatter,
  CommandConfig,
  SkillConfig,
  SkillFrontmatter,
  PluginsConfig,
  MarketplaceConfig,
  CursorProjectData,
  CursorMcpServerTools,
  CursorMcpTool,
  ConfigScope,
} from '../types/engine.js';

// =============================================================================
// MCP Configuration
// =============================================================================

/**
 * Read MCP configuration from ~/.cursor/mcp.json
 */
export async function readMcpConfig(): Promise<McpConfig | null> {
  const paths = getEnginePaths();
  const mcpPath = paths.mcpConfigPath;
  
  try {
    if (!existsSync(mcpPath)) {
      return null;
    }
    
    const content = await fs.readFile(mcpPath, 'utf-8');
    return JSON.parse(content) as McpConfig;
  } catch (error) {
    console.error('Error reading MCP config:', error);
    return null;
  }
}

/**
 * Get list of MCP servers
 */
export async function getMcpServers(): Promise<McpServerConfig[]> {
  const config = await readMcpConfig();
  if (!config?.mcpServers) {
    return [];
  }
  
  return Object.entries(config.mcpServers).map(([name, server]) => ({
    name,
    ...server,
  }));
}

// =============================================================================
// Rules Configuration
// =============================================================================

/**
 * Parse rule frontmatter from .mdc file content
 */
function parseRuleFrontmatter(content: string): { frontmatter: RuleFrontmatter; body: string } {
  try {
    const parsed = matter(content);
    return {
      frontmatter: {
        description: parsed.data.description,
        alwaysApply: parsed.data.alwaysApply,
        globs: parsed.data.globs,
      },
      body: parsed.content,
    };
  } catch {
    return {
      frontmatter: {},
      body: content,
    };
  }
}

/**
 * Read all rules from a directory
 */
async function readRulesFromDir(
  dirPath: string,
  scope: ConfigScope
): Promise<RuleConfig[]> {
  const rules: RuleConfig[] = [];
  
  try {
    if (!existsSync(dirPath)) {
      return rules;
    }
    
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith('.mdc') && !file.endsWith('.md')) {
        continue;
      }
      
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseRuleFrontmatter(content);
      const name = file.replace(/\.(mdc|md)$/, '');
      
      rules.push({
        name,
        path: filePath,
        scope,
        frontmatter,
        content: body,
      });
    }
  } catch (error) {
    console.error(`Error reading rules from ${dirPath}:`, error);
  }
  
  return rules;
}

/**
 * Get all rules (global scope only for Cursor)
 */
export async function getRules(): Promise<RuleConfig[]> {
  const paths = getEnginePaths();
  return readRulesFromDir(paths.rulesDir, 'global');
}

/**
 * Get rules for a specific project (reads from .cursor/rules in project)
 */
export async function getProjectRules(projectPath: string): Promise<RuleConfig[]> {
  const projectRulesDir = path.join(projectPath, '.cursor', 'rules');
  return readRulesFromDir(projectRulesDir, 'project');
}

// =============================================================================
// Commands Configuration
// =============================================================================

/**
 * Read all commands from a directory
 */
async function readCommandsFromDir(
  dirPath: string,
  scope: ConfigScope
): Promise<CommandConfig[]> {
  const commands: CommandConfig[] = [];
  
  try {
    if (!existsSync(dirPath)) {
      return commands;
    }
    
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (!file.endsWith('.md')) {
        continue;
      }
      
      const filePath = path.join(dirPath, file);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const name = file.replace(/\.md$/, '');
      
      commands.push({
        name,
        path: filePath,
        scope,
        content,
      });
    }
  } catch (error) {
    console.error(`Error reading commands from ${dirPath}:`, error);
  }
  
  return commands;
}

/**
 * Get all commands (global scope)
 */
export async function getCommands(): Promise<CommandConfig[]> {
  const paths = getEnginePaths();
  return readCommandsFromDir(paths.commandsDir, 'global');
}

/**
 * Get commands for a specific project
 */
export async function getProjectCommands(projectPath: string): Promise<CommandConfig[]> {
  const projectCommandsDir = path.join(projectPath, '.cursor', 'commands');
  return readCommandsFromDir(projectCommandsDir, 'project');
}

// =============================================================================
// Skills Configuration
// =============================================================================

/**
 * Parse skill SKILL.md frontmatter
 */
function parseSkillFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  try {
    const parsed = matter(content);
    return {
      frontmatter: {
        name: parsed.data.name || '',
        description: parsed.data.description || '',
      },
      body: parsed.content,
    };
  } catch {
    return {
      frontmatter: { name: '', description: '' },
      body: content,
    };
  }
}

/**
 * Read skills from a directory
 */
async function readSkillsFromDir(
  dirPath: string,
  scope: ConfigScope,
  isBuiltin: boolean = false
): Promise<SkillConfig[]> {
  const skills: SkillConfig[] = [];
  
  try {
    if (!existsSync(dirPath)) {
      return skills;
    }
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      
      const skillDir = path.join(dirPath, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      
      if (!existsSync(skillMdPath)) {
        continue;
      }
      
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const { frontmatter, body } = parseSkillFrontmatter(content);
      
      // Get supporting files
      const allFiles = await fs.readdir(skillDir);
      const supportingFiles = allFiles.filter(f => f !== 'SKILL.md');
      
      skills.push({
        name: frontmatter.name || entry.name,
        path: skillDir,
        scope,
        isBuiltin,
        frontmatter,
        content: body,
        supportingFiles: supportingFiles.length > 0 ? supportingFiles : undefined,
      });
    }
  } catch (error) {
    console.error(`Error reading skills from ${dirPath}:`, error);
  }
  
  return skills;
}

/**
 * Get all skills (user-created and built-in)
 */
export async function getSkills(): Promise<SkillConfig[]> {
  const paths = getEnginePaths();
  const skills: SkillConfig[] = [];
  
  // User-created skills
  const userSkills = await readSkillsFromDir(paths.skillsDir, 'user', false);
  skills.push(...userSkills);
  
  // Built-in skills (skills-cursor directory)
  if (paths.builtinSkillsDir) {
    const builtinSkills = await readSkillsFromDir(paths.builtinSkillsDir, 'user', true);
    skills.push(...builtinSkills);
  }
  
  return skills;
}

/**
 * Get project-level skills
 */
export async function getProjectSkills(projectPath: string): Promise<SkillConfig[]> {
  const projectSkillsDir = path.join(projectPath, '.cursor', 'skills');
  return readSkillsFromDir(projectSkillsDir, 'project', false);
}

// =============================================================================
// Plugins Configuration
// =============================================================================

/**
 * Read plugins configuration
 */
export async function getPluginsConfig(): Promise<PluginsConfig | null> {
  const paths = getEnginePaths();
  if (!paths.pluginsDir) {
    return null;
  }
  
  const installedPath = path.join(paths.pluginsDir, 'installed.json');
  
  try {
    if (!existsSync(installedPath)) {
      return null;
    }
    
    const content = await fs.readFile(installedPath, 'utf-8');
    return JSON.parse(content) as PluginsConfig;
  } catch (error) {
    console.error('Error reading plugins config:', error);
    return null;
  }
}

/**
 * Read marketplaces configuration
 */
export async function getMarketplacesConfig(): Promise<MarketplaceConfig | null> {
  const paths = getEnginePaths();
  if (!paths.pluginsDir) {
    return null;
  }
  
  const marketplacesPath = path.join(paths.pluginsDir, 'marketplaces.json');
  
  try {
    if (!existsSync(marketplacesPath)) {
      return null;
    }
    
    const content = await fs.readFile(marketplacesPath, 'utf-8');
    return JSON.parse(content) as MarketplaceConfig;
  } catch (error) {
    console.error('Error reading marketplaces config:', error);
    return null;
  }
}

// =============================================================================
// Project Data
// =============================================================================

/**
 * Get project MCP tools from ~/.cursor/projects/<hash>/mcps/
 */
export async function getProjectMcpTools(projectPath: string): Promise<CursorMcpServerTools[]> {
  const projectDataDir = getProjectDataDir(projectPath);
  const mcpsDir = path.join(projectDataDir, 'mcps');
  const servers: CursorMcpServerTools[] = [];
  
  try {
    if (!existsSync(mcpsDir)) {
      return servers;
    }
    
    const serverDirs = await fs.readdir(mcpsDir, { withFileTypes: true });
    
    for (const serverDir of serverDirs) {
      if (!serverDir.isDirectory()) {
        continue;
      }
      
      const serverPath = path.join(mcpsDir, serverDir.name);
      const metadataPath = path.join(serverPath, 'SERVER_METADATA.json');
      const toolsDir = path.join(serverPath, 'tools');
      
      let serverIdentifier = serverDir.name;
      let serverName = serverDir.name;
      let instructions: string | undefined;
      let status: string | undefined;
      
      // Read server metadata
      if (existsSync(metadataPath)) {
        try {
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);
          serverIdentifier = metadata.serverIdentifier || serverDir.name;
          serverName = metadata.serverName || serverDir.name;
        } catch {
          // Ignore metadata read errors
        }
      }
      
      // Read instructions
      const instructionsPath = path.join(serverPath, 'INSTRUCTIONS.md');
      if (existsSync(instructionsPath)) {
        try {
          instructions = await fs.readFile(instructionsPath, 'utf-8');
        } catch {
          // Ignore read errors
        }
      }
      
      // Read status
      const statusPath = path.join(serverPath, 'STATUS.md');
      if (existsSync(statusPath)) {
        try {
          status = await fs.readFile(statusPath, 'utf-8');
        } catch {
          // Ignore read errors
        }
      }
      
      // Read tools
      const tools: CursorMcpTool[] = [];
      if (existsSync(toolsDir)) {
        const toolFiles = await fs.readdir(toolsDir);
        for (const toolFile of toolFiles) {
          if (!toolFile.endsWith('.json')) {
            continue;
          }
          
          try {
            const toolContent = await fs.readFile(path.join(toolsDir, toolFile), 'utf-8');
            const tool = JSON.parse(toolContent) as CursorMcpTool;
            tools.push(tool);
          } catch {
            // Ignore tool read errors
          }
        }
      }
      
      servers.push({
        serverIdentifier,
        serverName,
        instructions,
        status,
        tools,
      });
    }
  } catch (error) {
    console.error(`Error reading project MCP tools for ${projectPath}:`, error);
  }
  
  return servers;
}

/**
 * Get project data summary
 */
export async function getProjectDataSummary(projectPath: string): Promise<CursorProjectData | null> {
  const hash = projectPathToHash(projectPath);
  const projectDataDir = getProjectDataDir(projectPath);
  
  if (!existsSync(projectDataDir)) {
    return null;
  }
  
  const transcriptsDir = path.join(projectDataDir, 'agent-transcripts');
  const terminalsDir = path.join(projectDataDir, 'terminals');
  const assetsDir = path.join(projectDataDir, 'assets');
  
  const transcripts: string[] = [];
  const terminals: string[] = [];
  const assets: string[] = [];
  
  try {
    if (existsSync(transcriptsDir)) {
      const files = await fs.readdir(transcriptsDir);
      transcripts.push(...files.filter(f => f.endsWith('.txt')));
    }
    
    if (existsSync(terminalsDir)) {
      const files = await fs.readdir(terminalsDir);
      terminals.push(...files.filter(f => f.endsWith('.txt')));
    }
    
    if (existsSync(assetsDir)) {
      const files = await fs.readdir(assetsDir);
      assets.push(...files);
    }
  } catch (error) {
    console.error(`Error reading project data for ${projectPath}:`, error);
  }
  
  const mcpTools = await getProjectMcpTools(projectPath);
  const mcpToolsRecord: Record<string, CursorMcpServerTools> = {};
  for (const server of mcpTools) {
    mcpToolsRecord[server.serverIdentifier] = server;
  }
  
  return {
    hash,
    projectPath,
    mcpTools: mcpToolsRecord,
    transcripts,
    terminals,
    assets,
  };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get all configuration for display
 */
export async function getAllCursorConfig(projectPath?: string): Promise<{
  mcp: McpServerConfig[];
  rules: RuleConfig[];
  commands: CommandConfig[];
  skills: SkillConfig[];
  plugins: PluginsConfig | null;
  marketplaces: MarketplaceConfig | null;
  projectData: CursorProjectData | null;
}> {
  const [mcp, globalRules, globalCommands, skills, plugins, marketplaces] = await Promise.all([
    getMcpServers(),
    getRules(),
    getCommands(),
    getSkills(),
    getPluginsConfig(),
    getMarketplacesConfig(),
  ]);
  
  let rules = globalRules;
  let commands = globalCommands;
  let projectData: CursorProjectData | null = null;
  
  if (projectPath) {
    const [projectRules, projectCommands, projectSkills, projData] = await Promise.all([
      getProjectRules(projectPath),
      getProjectCommands(projectPath),
      getProjectSkills(projectPath),
      getProjectDataSummary(projectPath),
    ]);
    
    rules = [...globalRules, ...projectRules];
    commands = [...globalCommands, ...projectCommands];
    skills.push(...projectSkills);
    projectData = projData;
  }
  
  return {
    mcp,
    rules,
    commands,
    skills,
    plugins,
    marketplaces,
    projectData,
  };
}
