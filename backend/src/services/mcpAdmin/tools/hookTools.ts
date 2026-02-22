/**
 * Hook Management Tools
 *
 * MCP tools for managing Claude SDK hooks in AgentStudio.
 * Hooks are custom shell commands that execute on specific events.
 * Only available when using Claude SDK engine (not Cursor engine).
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { isCursorEngine } from '../../../config/engineConfig.js';
import { getSdkDirName } from '../../../config/sdkConfig.js';
import type { Hook, HookListItem, HooksConfig, HookEventType } from '../../../types/hooks.js';

const HOOK_EVENT_TYPES: HookEventType[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
];

function getGlobalSettingsPath(): string {
  const sdkDirName = getSdkDirName();
  return path.join(os.homedir(), sdkDirName, 'settings.json');
}

function getLocalSettingsPath(projectPath?: string): string {
  const sdkDirName = getSdkDirName();
  if (projectPath) {
    return path.join(projectPath, sdkDirName, 'settings.local.json');
  }
  return path.join(process.cwd(), '..', sdkDirName, 'settings.local.json');
}

async function readSettingsFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeSettingsFile(filePath: string, settings: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

function extractHooks(settings: Record<string, unknown>, scope: 'global' | 'local'): HookListItem[] {
  const hooksConfig = settings as HooksConfig;
  const hooks = hooksConfig.hooks || [];
  return hooks.map((hook, index) => ({
    id: `${scope}:${index}`,
    event: hook.event,
    command: hook.command,
    matcher: hook.matcher,
    enabled: hook.enabled !== false,
    timeout: hook.timeout,
  }));
}

function notAvailableResult(): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: 'Hooks are only available when using Claude SDK engine, not Cursor engine.',
      },
    ],
    isError: true,
  };
}

/**
 * List all hooks
 */
export const listHooksTool: ToolDefinition = {
  tool: {
    name: 'list_hooks',
    description: 'List all configured hooks. Hooks are event-triggered shell commands (Claude SDK engine only).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Scope to list: "global" (~/.claude/settings.json), "local" (project-level), or "all" (default)',
        },
        projectPath: {
          type: 'string',
          description: 'Project path for local scope hooks',
        },
      },
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    if (isCursorEngine()) return notAvailableResult();
    try {
      const scope = (params.scope as 'global' | 'local' | 'all') || 'all';
      const projectPath = params.projectPath as string | undefined;
      const hooks: HookListItem[] = [];

      if (scope === 'all' || scope === 'global') {
        const settings = await readSettingsFile(getGlobalSettingsPath());
        hooks.push(...extractHooks(settings, 'global'));
      }
      if (scope === 'all' || scope === 'local') {
        const settings = await readSettingsFile(getLocalSettingsPath(projectPath));
        hooks.push(...extractHooks(settings, 'local'));
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ hooks, total: hooks.length }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error listing hooks: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * Get a single hook by ID
 */
export const getHookTool: ToolDefinition = {
  tool: {
    name: 'get_hook',
    description: 'Get details of a specific hook by ID (format: "global:0" or "local:1")',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Hook ID in format "scope:index" (e.g. "global:0", "local:2")',
        },
        projectPath: {
          type: 'string',
          description: 'Project path (required for local scope hooks)',
        },
      },
      required: ['id'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    if (isCursorEngine()) return notAvailableResult();
    try {
      const id = params.id as string;
      const projectPath = params.projectPath as string | undefined;
      const [scope, indexStr] = id.split(':');
      const index = parseInt(indexStr, 10);

      if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
        return { content: [{ type: 'text', text: 'Invalid hook ID. Expected format: "global:0" or "local:1"' }], isError: true };
      }

      const settingsPath = scope === 'global' ? getGlobalSettingsPath() : getLocalSettingsPath(projectPath);
      const settings = await readSettingsFile(settingsPath);
      const hooks = (settings as HooksConfig).hooks || [];

      if (index < 0 || index >= hooks.length) {
        return { content: [{ type: 'text', text: `Hook ${id} not found` }], isError: true };
      }

      const hook = hooks[index];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ id, ...hook, enabled: hook.enabled !== false }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error getting hook: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * Create a new hook
 */
export const createHookTool: ToolDefinition = {
  tool: {
    name: 'create_hook',
    description: `Create a new hook. Hooks execute shell commands on specific events.
Available events: ${HOOK_EVENT_TYPES.join(', ')}.
Example: create a PreToolUse hook to log all tool calls, or a PostToolUse hook to run tests after file edits.`,
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'string',
          description: `Event that triggers this hook. One of: ${HOOK_EVENT_TYPES.join(', ')}`,
        },
        command: {
          type: 'string',
          description: 'Shell command to execute when the hook fires',
        },
        scope: {
          type: 'string',
          description: 'Scope: "global" (default, ~/.claude/settings.json) or "local" (project-level)',
        },
        projectPath: {
          type: 'string',
          description: 'Project path (required for local scope)',
        },
        matcher: {
          type: 'object',
          description: 'Optional: filter when the hook runs',
          properties: {
            tool_name: { type: 'string', description: 'Specific tool name to match' },
            tool_names: { type: 'array', items: { type: 'string' }, description: 'List of tool names to match' },
            path_pattern: { type: 'string', description: 'Glob pattern for file paths' },
          },
        },
        enabled: {
          type: 'boolean',
          description: 'Whether hook is enabled (default: true)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (optional)',
        },
      },
      required: ['event', 'command'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    if (isCursorEngine()) return notAvailableResult();
    try {
      const event = params.event as HookEventType;
      const command = params.command as string;
      const scope = (params.scope as 'global' | 'local') || 'global';
      const projectPath = params.projectPath as string | undefined;

      if (!HOOK_EVENT_TYPES.includes(event)) {
        return {
          content: [{ type: 'text', text: `Invalid event type. Must be one of: ${HOOK_EVENT_TYPES.join(', ')}` }],
          isError: true,
        };
      }

      const settingsPath = scope === 'global' ? getGlobalSettingsPath() : getLocalSettingsPath(projectPath);
      const settings = await readSettingsFile(settingsPath);
      const hooksConfig = settings as HooksConfig;
      if (!hooksConfig.hooks) hooksConfig.hooks = [];

      const newHook: Hook = {
        event,
        command,
        enabled: params.enabled !== false,
      };
      if (params.matcher) newHook.matcher = params.matcher as Hook['matcher'];
      if (params.timeout) newHook.timeout = params.timeout as number;

      hooksConfig.hooks.push(newHook);
      const newIndex = hooksConfig.hooks.length - 1;

      await writeSettingsFile(settingsPath, hooksConfig as Record<string, unknown>);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, id: `${scope}:${newIndex}`, event, command, scope },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error creating hook: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Update an existing hook
 */
export const updateHookTool: ToolDefinition = {
  tool: {
    name: 'update_hook',
    description: 'Update an existing hook by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Hook ID in format "scope:index" (e.g. "global:0")',
        },
        projectPath: {
          type: 'string',
          description: 'Project path (required for local scope)',
        },
        event: { type: 'string', description: 'New event type' },
        command: { type: 'string', description: 'New shell command' },
        enabled: { type: 'boolean', description: 'Enable or disable the hook' },
        matcher: { type: 'object', description: 'New matcher configuration' },
        timeout: { type: 'number', description: 'New timeout in milliseconds' },
      },
      required: ['id'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    if (isCursorEngine()) return notAvailableResult();
    try {
      const id = params.id as string;
      const projectPath = params.projectPath as string | undefined;
      const [scope, indexStr] = id.split(':');
      const index = parseInt(indexStr, 10);

      if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
        return { content: [{ type: 'text', text: 'Invalid hook ID format' }], isError: true };
      }

      const settingsPath = scope === 'global' ? getGlobalSettingsPath() : getLocalSettingsPath(projectPath);
      const settings = await readSettingsFile(settingsPath);
      const hooksConfig = settings as HooksConfig;
      const hooks = hooksConfig.hooks || [];

      if (index < 0 || index >= hooks.length) {
        return { content: [{ type: 'text', text: `Hook ${id} not found` }], isError: true };
      }

      const hook = hooks[index];
      if (params.event !== undefined) hook.event = params.event as HookEventType;
      if (params.command !== undefined) hook.command = params.command as string;
      if (params.enabled !== undefined) hook.enabled = params.enabled as boolean;
      if (params.matcher !== undefined) hook.matcher = params.matcher as Hook['matcher'];
      if (params.timeout !== undefined) hook.timeout = params.timeout as number;

      await writeSettingsFile(settingsPath, hooksConfig as Record<string, unknown>);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, id, updated: hook }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error updating hook: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Delete a hook
 */
export const deleteHookTool: ToolDefinition = {
  tool: {
    name: 'delete_hook',
    description: 'Delete a hook by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Hook ID in format "scope:index" (e.g. "global:0")',
        },
        projectPath: {
          type: 'string',
          description: 'Project path (required for local scope)',
        },
      },
      required: ['id'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    if (isCursorEngine()) return notAvailableResult();
    try {
      const id = params.id as string;
      const projectPath = params.projectPath as string | undefined;
      const [scope, indexStr] = id.split(':');
      const index = parseInt(indexStr, 10);

      if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
        return { content: [{ type: 'text', text: 'Invalid hook ID format' }], isError: true };
      }

      const settingsPath = scope === 'global' ? getGlobalSettingsPath() : getLocalSettingsPath(projectPath);
      const settings = await readSettingsFile(settingsPath);
      const hooksConfig = settings as HooksConfig;
      const hooks = hooksConfig.hooks || [];

      if (index < 0 || index >= hooks.length) {
        return { content: [{ type: 'text', text: `Hook ${id} not found` }], isError: true };
      }

      const deleted = hooks.splice(index, 1)[0];
      await writeSettingsFile(settingsPath, hooksConfig as Record<string, unknown>);

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, deleted }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error deleting hook: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const hookTools: ToolDefinition[] = [
  listHooksTool,
  getHookTool,
  createHookTool,
  updateHookTool,
  deleteHookTool,
];
