/**
 * Skill Management Tools
 *
 * MCP tools for managing skills in AgentStudio.
 */

import path from 'path';
import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { SkillStorage } from '../../skillStorage.js';
import { getSdkDirName } from '../../../config/engineConfig.js';

const defaultSkillStorage = new SkillStorage();

function getSkillStorage(projectPath?: string): SkillStorage {
  if (!projectPath) return defaultSkillStorage;
  const projectSkillsDir = path.join(projectPath, getSdkDirName(), 'skills');
  return new SkillStorage(undefined, projectSkillsDir);
}

/**
 * List all skills
 */
export const listSkillsTool: ToolDefinition = {
  tool: {
    name: 'list_skills',
    description: 'List all skills in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Filter by scope: "user", "project", or "all" (default: all)',
        },
        includeDisabled: {
          type: 'boolean',
          description: 'Include disabled skills (default: false)',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project directory (required when scope is "project" or "all")',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const scope = (params.scope as string) || 'all';
      const includeDisabled = (params.includeDisabled as boolean) ?? false;
      const projectPath = params.projectPath as string | undefined;
      const skillStorage = getSkillStorage(projectPath);

      let skills;
      if (scope === 'user') {
        skills = await skillStorage.getUserSkills(includeDisabled);
      } else if (scope === 'project') {
        skills = await skillStorage.getProjectSkills(includeDisabled);
      } else {
        skills = await skillStorage.getAllSkills(includeDisabled);
      }

      const skillList = skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        scope: s.scope,
        enabled: s.enabled !== false,
        source: s.source,
        tags: s.tags,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                skills: skillList,
                total: skillList.length,
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
            text: `Error listing skills: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['skills:read'],
};

/**
 * Get skill details
 */
export const getSkillTool: ToolDefinition = {
  tool: {
    name: 'get_skill',
    description: 'Get detailed information about a specific skill, including its SKILL.md content',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Skill ID',
        },
        scope: {
          type: 'string',
          description: 'Scope: "user" or "project" (optional, searches both if not specified)',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project directory (required when scope is "project")',
        },
      },
      required: ['skillId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project' | undefined;
      const projectPath = params.projectPath as string | undefined;
      const skillStorage = getSkillStorage(projectPath);

      if (!skillId) {
        return {
          content: [{ type: 'text', text: 'Skill ID is required' }],
          isError: true,
        };
      }

      const skill = await skillStorage.getSkill(skillId, scope);

      if (!skill) {
        return {
          content: [{ type: 'text', text: `Skill not found: ${skillId}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(skill, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting skill: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['skills:read'],
};

/**
 * Create a new skill
 */
export const createSkillTool: ToolDefinition = {
  tool: {
    name: 'create_skill',
    description: 'Create a new skill with SKILL.md content. Supports multi-file skill packages via additionalFiles.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (lowercase, numbers, hyphens only, max 64 chars)',
        },
        description: {
          type: 'string',
          description: 'Skill description (max 1024 chars)',
        },
        content: {
          type: 'string',
          description: 'Full SKILL.md content (including YAML frontmatter and markdown body)',
        },
        scope: {
          type: 'string',
          description: 'Scope: "user" (default, global ~/.claude/skills/) or "project" (project-level, requires projectPath)',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project directory. Required when scope is "project". Skills will be created under <projectPath>/.claude/skills/',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of tools this skill can use',
        },
        additionalFiles: {
          type: 'array',
          description: 'Additional files for multi-file skill packages (e.g. reference docs, scripts)',
          items: {
            type: 'object',
            properties: {
              relativePath: {
                type: 'string',
                description: 'File path relative to skill directory, e.g. "reference/guide.md"',
              },
              content: {
                type: 'string',
                description: 'File content',
              },
            },
            required: ['relativePath', 'content'],
          },
        },
      },
      required: ['name', 'description', 'content'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const name = params.name as string;
      const description = params.description as string;
      const content = params.content as string;
      const scope = (params.scope as 'user' | 'project') || 'user';
      const projectPath = params.projectPath as string | undefined;
      const allowedTools = params.allowedTools as string[] | undefined;
      const additionalFiles = params.additionalFiles as Array<{ relativePath: string; content: string }> | undefined;

      if (scope === 'project' && !projectPath) {
        return {
          content: [{ type: 'text', text: 'projectPath is required when scope is "project"' }],
          isError: true,
        };
      }

      const skillStorage = getSkillStorage(projectPath);

      if (!name || !description || !content) {
        return {
          content: [{ type: 'text', text: 'name, description, and content are required' }],
          isError: true,
        };
      }

      const mappedFiles = additionalFiles?.map((f) => {
        const ext = f.relativePath.split('.').pop()?.toLowerCase() || '';
        const type = ext === 'md' ? 'markdown' : ext === 'sh' || ext === 'js' || ext === 'ts' ? 'script' : 'text';
        return {
          name: f.relativePath.split('/').pop() || f.relativePath,
          path: f.relativePath,
          type: type as 'markdown' | 'text' | 'script' | 'template' | 'other',
          content: f.content,
        };
      });

      const result = await skillStorage.createSkill({
        name,
        description,
        content,
        scope,
        allowedTools,
        additionalFiles: mappedFiles,
      });

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to create skill: ${result.errors?.join(', ') || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                skillId: result.skillId,
                name,
                scope,
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
            text: `Error creating skill: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['skills:write'],
};

/**
 * Update an existing skill
 */
export const updateSkillTool: ToolDefinition = {
  tool: {
    name: 'update_skill',
    description: 'Update an existing skill',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Skill ID to update',
        },
        scope: {
          type: 'string',
          description: 'Scope: "user" or "project"',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project directory (required when scope is "project")',
        },
        name: {
          type: 'string',
          description: 'New skill name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        content: {
          type: 'string',
          description: 'New SKILL.md content',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated allowed tools list',
        },
        additionalFiles: {
          type: 'array',
          description: 'Additional files to add/update in the skill package',
          items: {
            type: 'object',
            properties: {
              relativePath: {
                type: 'string',
                description: 'File path relative to skill directory',
              },
              content: {
                type: 'string',
                description: 'File content',
              },
            },
            required: ['relativePath', 'content'],
          },
        },
      },
      required: ['skillId', 'scope'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project';
      const projectPath = params.projectPath as string | undefined;

      if (!skillId || !scope) {
        return {
          content: [{ type: 'text', text: 'skillId and scope are required' }],
          isError: true,
        };
      }

      if (scope === 'project' && !projectPath) {
        return {
          content: [{ type: 'text', text: 'projectPath is required when scope is "project"' }],
          isError: true,
        };
      }

      const skillStorage = getSkillStorage(projectPath);

      const updates: Record<string, unknown> = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.description !== undefined) updates.description = params.description;
      if (params.content !== undefined) updates.content = params.content;
      if (params.allowedTools !== undefined) updates.allowedTools = params.allowedTools;
      if (params.additionalFiles !== undefined) {
        const rawFiles = params.additionalFiles as Array<{ relativePath: string; content: string }>;
        updates.additionalFiles = rawFiles.map((f) => {
          const ext = f.relativePath.split('.').pop()?.toLowerCase() || '';
          const type = ext === 'md' ? 'markdown' : ext === 'sh' || ext === 'js' || ext === 'ts' ? 'script' : 'text';
          return {
            name: f.relativePath.split('/').pop() || f.relativePath,
            path: f.relativePath,
            type: type as 'markdown' | 'text' | 'script' | 'template' | 'other',
            content: f.content,
          };
        });
      }

      const result = await skillStorage.updateSkill(skillId, scope, updates as any);

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to update skill: ${result.errors?.join(', ') || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                skillId,
                updatedFiles: result.updatedFiles,
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
            text: `Error updating skill: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['skills:write'],
};

/**
 * Delete a skill
 */
export const deleteSkillTool: ToolDefinition = {
  tool: {
    name: 'delete_skill',
    description: 'Delete a skill',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: {
          type: 'string',
          description: 'Skill ID to delete',
        },
        scope: {
          type: 'string',
          description: 'Scope: "user" or "project" (optional, searches both if not specified)',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path to the project directory (required when scope is "project")',
        },
      },
      required: ['skillId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project' | undefined;
      const projectPath = params.projectPath as string | undefined;
      const skillStorage = getSkillStorage(projectPath);

      if (!skillId) {
        return {
          content: [{ type: 'text', text: 'Skill ID is required' }],
          isError: true,
        };
      }

      const result = await skillStorage.deleteSkill(skillId, scope);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: result,
                skillId,
                message: result ? 'Skill deleted successfully' : 'Failed to delete skill (not found)',
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
            text: `Error deleting skill: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['skills:write'],
};

/**
 * All skill tools
 */
export const skillTools: ToolDefinition[] = [
  listSkillsTool,
  getSkillTool,
  createSkillTool,
  updateSkillTool,
  deleteSkillTool,
];
