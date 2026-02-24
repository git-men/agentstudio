/**
 * Rule Management Tools
 *
 * MCP tools for managing rules in AgentStudio.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { isCursorEngine } from '../../../config/engineConfig.js';
import { getSdkDirName } from '../../../config/sdkConfig.js';

// Get file extension based on engine
const getRuleExtension = (): string => {
  return isCursorEngine() ? '.mdc' : '.md';
};

// Get global rules directory
const getGlobalRulesDir = (): string => {
  if (isCursorEngine()) {
    return path.join(os.homedir(), '.cursor', 'rules');
  }
  return path.join(os.homedir(), '.claude', 'rules');
};

// Get project rules directory
const getProjectRulesDir = (): string => {
  const sdkDirName = isCursorEngine() ? '.cursor' : getSdkDirName();
  return path.join(process.cwd(), '..', sdkDirName, 'rules');
};

// Ensure directory exists
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists
  }
}

// Scan rules in a directory
async function scanRules(
  dirPath: string,
  scope: 'global' | 'project'
): Promise<Array<{ id: string; name: string; filename: string; path: string; scope: string; description?: string; alwaysApply?: boolean; globs?: string }>> {
  const rules: Array<{ id: string; name: string; filename: string; path: string; scope: string; description?: string; alwaysApply?: boolean; globs?: string }> = [];
  const extension = getRuleExtension();

  try {
    await ensureDir(dirPath);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
        const filePath = path.join(dirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = matter(content);
        const name = entry.name.replace(/\.(md|mdc)$/, '');

        rules.push({
          id: `${scope}:${name}`,
          name,
          filename: entry.name,
          path: filePath,
          scope,
          description: parsed.data.description,
          alwaysApply: parsed.data.alwaysApply,
          globs: parsed.data.globs,
        });
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return rules;
}

/**
 * List all rules
 */
export const listRulesTool: ToolDefinition = {
  tool: {
    name: 'list_rules',
    description: 'List all rules in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Filter by scope: "global", "project", or "all" (default: all)',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const scope = (params.scope as string) || 'all';

      let rules: Array<{ id: string; name: string; filename: string; path: string; scope: string; description?: string; alwaysApply?: boolean; globs?: string }> = [];

      if (scope === 'all' || scope === 'global') {
        const globalRules = await scanRules(getGlobalRulesDir(), 'global');
        rules = [...rules, ...globalRules];
      }
      if (scope === 'all' || scope === 'project') {
        const projectRules = await scanRules(getProjectRulesDir(), 'project');
        rules = [...rules, ...projectRules];
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                rules: rules.map((r) => ({
                  id: r.id,
                  name: r.name,
                  scope: r.scope,
                  description: r.description,
                  alwaysApply: r.alwaysApply,
                  globs: r.globs,
                })),
                total: rules.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing rules: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['rules:read'],
};

/**
 * Get rule details
 */
export const getRuleTool: ToolDefinition = {
  tool: {
    name: 'get_rule',
    description: 'Get detailed information about a specific rule',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: {
          type: 'string',
          description: 'Rule ID in format "scope:name" (e.g., "global:typescript-standards")',
        },
      },
      required: ['ruleId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const ruleId = params.ruleId as string;

      if (!ruleId || !ruleId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Rule ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = ruleId.split(':');
      const dir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir();
      const extension = getRuleExtension();
      const filePath = path.join(dir, `${name}${extension}`);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = matter(content);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: ruleId,
                  name,
                  scope,
                  frontmatter: parsed.data,
                  content: parsed.content.trim(),
                  rawContent: content,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: 'text', text: `Rule not found: ${ruleId}` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['rules:read'],
};

/**
 * Create a new rule
 */
export const createRuleTool: ToolDefinition = {
  tool: {
    name: 'create_rule',
    description: 'Create a new rule file',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Rule name (used as filename without extension)',
        },
        scope: {
          type: 'string',
          description: 'Scope: "global" or "project" (default: project)',
        },
        description: {
          type: 'string',
          description: 'Rule description (for frontmatter)',
        },
        alwaysApply: {
          type: 'boolean',
          description: 'Whether this rule should always apply (default: false)',
        },
        globs: {
          type: 'string',
          description: 'File glob pattern for when the rule should apply',
        },
        content: {
          type: 'string',
          description: 'Rule body content (markdown)',
        },
      },
      required: ['name', 'content'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const scope = (params.scope as string) || 'project';
      const content = params.content as string;

      if (!name || !content) {
        return {
          content: [{ type: 'text', text: 'name and content are required' }],
          isError: true,
        };
      }

      const dir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir();
      const extension = getRuleExtension();
      const filePath = path.join(dir, `${name}${extension}`);

      // Ensure directory exists
      await ensureDir(dir);

      // Check if already exists
      try {
        await fs.access(filePath);
        return {
          content: [{ type: 'text', text: `Rule already exists: ${name}` }],
          isError: true,
        };
      } catch {
        // File doesn't exist, continue
      }

      // Build frontmatter
      const frontmatter: Record<string, unknown> = {};
      if (params.description) frontmatter.description = params.description;
      if (params.alwaysApply !== undefined) frontmatter.alwaysApply = params.alwaysApply;
      if (params.globs) frontmatter.globs = params.globs;

      // Format content with frontmatter
      let fileContent = content;
      if (Object.keys(frontmatter).length > 0) {
        let fm = '---\n';
        for (const [key, value] of Object.entries(frontmatter)) {
          if (value === undefined || value === null) continue;
          if (typeof value === 'boolean') {
            fm += `${key}: ${value}\n`;
          } else {
            fm += `${key}: ${value}\n`;
          }
        }
        fm += '---\n\n';
        fileContent = fm + content;
      }

      await fs.writeFile(filePath, fileContent, 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ruleId: `${scope}:${name}`,
                name,
                scope,
                path: filePath,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['rules:write'],
};

/**
 * Update an existing rule
 */
export const updateRuleTool: ToolDefinition = {
  tool: {
    name: 'update_rule',
    description: 'Update an existing rule',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: {
          type: 'string',
          description: 'Rule ID in format "scope:name"',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        alwaysApply: {
          type: 'boolean',
          description: 'Whether this rule should always apply',
        },
        globs: {
          type: 'string',
          description: 'New file glob pattern',
        },
        content: {
          type: 'string',
          description: 'New rule body content',
        },
      },
      required: ['ruleId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const ruleId = params.ruleId as string;

      if (!ruleId || !ruleId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Rule ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = ruleId.split(':');
      const dir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir();
      const extension = getRuleExtension();
      const filePath = path.join(dir, `${name}${extension}`);

      // Read existing content
      let existingContent: string;
      try {
        existingContent = await fs.readFile(filePath, 'utf8');
      } catch {
        return {
          content: [{ type: 'text', text: `Rule not found: ${ruleId}` }],
          isError: true,
        };
      }

      const parsed = matter(existingContent);

      // Update frontmatter
      if (params.description !== undefined) parsed.data.description = params.description;
      if (params.alwaysApply !== undefined) parsed.data.alwaysApply = params.alwaysApply;
      if (params.globs !== undefined) parsed.data.globs = params.globs;

      // Update body
      const body = (params.content as string) || parsed.content.trim();

      // Rebuild file content
      let fileContent = body;
      if (Object.keys(parsed.data).length > 0) {
        let fm = '---\n';
        for (const [key, value] of Object.entries(parsed.data)) {
          if (value === undefined || value === null) continue;
          if (typeof value === 'boolean') {
            fm += `${key}: ${value}\n`;
          } else {
            fm += `${key}: ${value}\n`;
          }
        }
        fm += '---\n\n';
        fileContent = fm + body;
      }

      await fs.writeFile(filePath, fileContent, 'utf8');

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                ruleId,
                updatedAt: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['rules:write'],
};

/**
 * Delete a rule
 */
export const deleteRuleTool: ToolDefinition = {
  tool: {
    name: 'delete_rule',
    description: 'Delete a rule',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: {
          type: 'string',
          description: 'Rule ID in format "scope:name"',
        },
      },
      required: ['ruleId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const ruleId = params.ruleId as string;

      if (!ruleId || !ruleId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Rule ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = ruleId.split(':');
      const dir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir();
      const extension = getRuleExtension();
      const filePath = path.join(dir, `${name}${extension}`);

      try {
        await fs.unlink(filePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  ruleId,
                  message: 'Rule deleted successfully',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: 'text', text: `Rule not found: ${ruleId}` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting rule: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['rules:write'],
};

/**
 * All rule tools
 */
export const ruleTools: ToolDefinition[] = [
  listRulesTool,
  getRuleTool,
  createRuleTool,
  updateRuleTool,
  deleteRuleTool,
];
