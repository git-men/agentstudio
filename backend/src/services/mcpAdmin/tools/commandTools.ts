/**
 * Command Management Tools
 *
 * MCP tools for managing slash commands in AgentStudio.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { getEnginePaths } from '../../../config/engineConfig.js';
import { getSdkDirName } from '../../../config/engineConfig.js';
import { isCursorEngine } from '../../../config/engineConfig.js';

// Get user-level commands directory
const getUserCommandsDir = (): string => {
  return getEnginePaths().commandsDir;
};

// Get project-level commands directory
const getProjectCommandsDir = (): string => {
  const sdkDirName = isCursorEngine() ? '.cursor' : getSdkDirName();
  return path.join(process.cwd(), '..', sdkDirName, 'commands');
};

// Ensure directory exists
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists
  }
}

// Scan commands in a directory
async function scanCommands(
  dirPath: string,
  scope: 'user' | 'project'
): Promise<Array<{ id: string; name: string; filename: string; path: string; scope: string; description?: string; argumentHint?: string }>> {
  const commands: Array<{ id: string; name: string; filename: string; path: string; scope: string; description?: string; argumentHint?: string }> = [];

  try {
    await ensureDir(dirPath);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(dirPath, entry.name);
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = matter(content);
        const name = entry.name.replace(/\.md$/, '');

        commands.push({
          id: `${scope}:${name}`,
          name,
          filename: entry.name,
          path: filePath,
          scope,
          description: parsed.data.description,
          argumentHint: parsed.data['argument-hint'],
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return commands;
}

/**
 * List all commands
 */
export const listCommandsTool: ToolDefinition = {
  tool: {
    name: 'list_commands',
    description: 'List all slash commands in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Filter by scope: "user", "project", or "all" (default: all)',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const scope = (params.scope as string) || 'all';

      let commands: Array<{ id: string; name: string; scope: string; description?: string; argumentHint?: string }> = [];

      if (scope === 'all' || scope === 'user') {
        const userCmds = await scanCommands(getUserCommandsDir(), 'user');
        commands = [...commands, ...userCmds];
      }
      if (scope === 'all' || scope === 'project') {
        const projectCmds = await scanCommands(getProjectCommandsDir(), 'project');
        commands = [...commands, ...projectCmds];
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                commands: commands.map((c) => ({
                  id: c.id,
                  name: c.name,
                  scope: c.scope,
                  description: c.description,
                  argumentHint: c.argumentHint,
                })),
                total: commands.length,
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
            text: `Error listing commands: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['commands:read'],
};

/**
 * Get command details
 */
export const getCommandTool: ToolDefinition = {
  tool: {
    name: 'get_command',
    description: 'Get detailed information about a specific command',
    inputSchema: {
      type: 'object',
      properties: {
        commandId: {
          type: 'string',
          description: 'Command ID in format "scope:name" (e.g., "user:review-code")',
        },
      },
      required: ['commandId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const commandId = params.commandId as string;

      if (!commandId || !commandId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Command ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = commandId.split(':');
      const dir = scope === 'user' ? getUserCommandsDir() : getProjectCommandsDir();
      const filePath = path.join(dir, `${name}.md`);

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = matter(content);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: commandId,
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
          content: [{ type: 'text', text: `Command not found: ${commandId}` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting command: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['commands:read'],
};

/**
 * Create a new command
 */
export const createCommandTool: ToolDefinition = {
  tool: {
    name: 'create_command',
    description: 'Create a new slash command',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Command name (used as filename and /command trigger)',
        },
        scope: {
          type: 'string',
          description: 'Scope: "user" or "project" (default: user)',
        },
        description: {
          type: 'string',
          description: 'Command description',
        },
        argumentHint: {
          type: 'string',
          description: 'Hint for command arguments (e.g., "<file_path>")',
        },
        allowedTools: {
          type: 'string',
          description: 'Comma-separated list of allowed tools',
        },
        content: {
          type: 'string',
          description: 'Command template content (markdown)',
        },
      },
      required: ['name', 'content'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const scope = (params.scope as string) || 'user';
      const content = params.content as string;

      if (!name || !content) {
        return {
          content: [{ type: 'text', text: 'name and content are required' }],
          isError: true,
        };
      }

      const dir = scope === 'user' ? getUserCommandsDir() : getProjectCommandsDir();
      const filePath = path.join(dir, `${name}.md`);

      await ensureDir(dir);

      // Check if already exists
      try {
        await fs.access(filePath);
        return {
          content: [{ type: 'text', text: `Command already exists: ${name}` }],
          isError: true,
        };
      } catch {
        // Doesn't exist, continue
      }

      // Build frontmatter
      const frontmatter: Record<string, unknown> = {};
      if (params.description) frontmatter.description = params.description;
      if (params.argumentHint) frontmatter['argument-hint'] = params.argumentHint;
      if (params.allowedTools) frontmatter['allowed-tools'] = params.allowedTools;

      // Format content
      let fileContent = content;
      if (Object.keys(frontmatter).length > 0) {
        let fm = '---\n';
        for (const [key, value] of Object.entries(frontmatter)) {
          if (value === undefined || value === null) continue;
          fm += `${key}: ${value}\n`;
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
                commandId: `${scope}:${name}`,
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
            text: `Error creating command: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['commands:write'],
};

/**
 * Update an existing command
 */
export const updateCommandTool: ToolDefinition = {
  tool: {
    name: 'update_command',
    description: 'Update an existing command',
    inputSchema: {
      type: 'object',
      properties: {
        commandId: {
          type: 'string',
          description: 'Command ID in format "scope:name"',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        argumentHint: {
          type: 'string',
          description: 'New argument hint',
        },
        content: {
          type: 'string',
          description: 'New command template content',
        },
      },
      required: ['commandId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const commandId = params.commandId as string;

      if (!commandId || !commandId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Command ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = commandId.split(':');
      const dir = scope === 'user' ? getUserCommandsDir() : getProjectCommandsDir();
      const filePath = path.join(dir, `${name}.md`);

      let existingContent: string;
      try {
        existingContent = await fs.readFile(filePath, 'utf8');
      } catch {
        return {
          content: [{ type: 'text', text: `Command not found: ${commandId}` }],
          isError: true,
        };
      }

      const parsed = matter(existingContent);

      // Update frontmatter
      if (params.description !== undefined) parsed.data.description = params.description;
      if (params.argumentHint !== undefined) parsed.data['argument-hint'] = params.argumentHint;

      // Update body
      const body = (params.content as string) || parsed.content.trim();

      // Rebuild
      let fileContent = body;
      if (Object.keys(parsed.data).length > 0) {
        let fm = '---\n';
        for (const [key, value] of Object.entries(parsed.data)) {
          if (value === undefined || value === null) continue;
          fm += `${key}: ${value}\n`;
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
                commandId,
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
            text: `Error updating command: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['commands:write'],
};

/**
 * Delete a command
 */
export const deleteCommandTool: ToolDefinition = {
  tool: {
    name: 'delete_command',
    description: 'Delete a command',
    inputSchema: {
      type: 'object',
      properties: {
        commandId: {
          type: 'string',
          description: 'Command ID in format "scope:name"',
        },
      },
      required: ['commandId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const commandId = params.commandId as string;

      if (!commandId || !commandId.includes(':')) {
        return {
          content: [{ type: 'text', text: 'Command ID is required in format "scope:name"' }],
          isError: true,
        };
      }

      const [scope, name] = commandId.split(':');
      const dir = scope === 'user' ? getUserCommandsDir() : getProjectCommandsDir();
      const filePath = path.join(dir, `${name}.md`);

      try {
        await fs.unlink(filePath);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  commandId,
                  message: 'Command deleted successfully',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: 'text', text: `Command not found: ${commandId}` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error deleting command: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['commands:write'],
};

/**
 * All command tools
 */
export const commandTools: ToolDefinition[] = [
  listCommandsTool,
  getCommandTool,
  createCommandTool,
  updateCommandTool,
  deleteCommandTool,
];
