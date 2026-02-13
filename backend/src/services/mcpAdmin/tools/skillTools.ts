/**
 * Skill Management Tools
 *
 * MCP tools for managing skills in AgentStudio.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { SkillStorage } from '../../skillStorage.js';

const skillStorage = new SkillStorage();

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
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const scope = (params.scope as string) || 'all';
      const includeDisabled = (params.includeDisabled as boolean) ?? false;

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
      },
      required: ['skillId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project' | undefined;

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
    description: 'Create a new skill with SKILL.md content',
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
          description: 'Scope: "user" (default) or "project"',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of tools this skill can use',
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
      const allowedTools = params.allowedTools as string[] | undefined;

      if (!name || !description || !content) {
        return {
          content: [{ type: 'text', text: 'name, description, and content are required' }],
          isError: true,
        };
      }

      const result = await skillStorage.createSkill({
        name,
        description,
        content,
        scope,
        allowedTools,
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
      },
      required: ['skillId', 'scope'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project';

      if (!skillId || !scope) {
        return {
          content: [{ type: 'text', text: 'skillId and scope are required' }],
          isError: true,
        };
      }

      const updates: Record<string, unknown> = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.description !== undefined) updates.description = params.description;
      if (params.content !== undefined) updates.content = params.content;
      if (params.allowedTools !== undefined) updates.allowedTools = params.allowedTools;

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
      },
      required: ['skillId'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const skillId = params.skillId as string;
      const scope = params.scope as 'user' | 'project' | undefined;

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
