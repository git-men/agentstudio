/**
 * Marketplace Plugin Management Tools
 *
 * MCP tools for browsing, installing, and managing marketplace plugins in AgentStudio.
 */

import type { ToolDefinition, McpToolCallResult } from '../types.js';
import { pluginScanner } from '../../pluginScanner.js';
import { pluginInstaller } from '../../pluginInstaller.js';
import type { PluginInstallRequest } from '../../../types/plugins.js';

/**
 * List all configured marketplaces
 */
export const listMarketplacesTool: ToolDefinition = {
  tool: {
    name: 'list_marketplaces',
    description: 'List all configured plugin marketplaces in AgentStudio',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const marketplaces = await pluginScanner.scanMarketplaces();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                marketplaces: marketplaces.map((m) => ({
                  id: m.id,
                  name: m.name,
                  displayName: m.displayName,
                  type: m.type,
                  description: m.description,
                  pluginCount: m.pluginCount,
                })),
                total: marketplaces.length,
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
          { type: 'text', text: `Error listing marketplaces: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * List plugins in a marketplace
 */
export const listMarketplacePluginsTool: ToolDefinition = {
  tool: {
    name: 'list_marketplace_plugins',
    description: 'List all plugins in a specific marketplace, showing which are installed/enabled',
    inputSchema: {
      type: 'object',
      properties: {
        marketplaceName: {
          type: 'string',
          description: 'Marketplace name (use list_marketplaces to get available names)',
        },
        installedOnly: {
          type: 'boolean',
          description: 'If true, only return installed/enabled plugins (default: false)',
        },
      },
      required: ['marketplaceName'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const marketplaceName = params.marketplaceName as string;
      const installedOnly = (params.installedOnly as boolean) ?? false;

      let plugins = await pluginScanner.scanMarketplacePlugins(marketplaceName);

      if (installedOnly) {
        plugins = plugins.filter((p) => p.enabled);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                marketplace: marketplaceName,
                plugins: plugins.map((p) => ({
                  name: p.name,
                  displayName: p.manifest?.name || p.name,
                  description: p.manifest?.description,
                  version: p.version,
                  enabled: p.enabled,
                  components: p.components
                    ? {
                        agents: p.components.agents?.length || 0,
                        skills: p.components.skills?.length || 0,
                        commands: p.components.commands?.length || 0,
                        mcpServers: p.components.mcpServers?.length || 0,
                      }
                    : undefined,
                })),
                total: plugins.length,
                installed: plugins.filter((p) => p.enabled).length,
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
            text: `Error listing plugins: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * List all installed plugins across all marketplaces
 */
export const listInstalledPluginsTool: ToolDefinition = {
  tool: {
    name: 'list_installed_plugins',
    description: 'List all currently installed/enabled plugins across all marketplaces',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (): Promise<McpToolCallResult> => {
    try {
      const plugins = await pluginScanner.scanInstalledPlugins();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                plugins: plugins.map((p) => ({
                  name: p.name,
                  displayName: p.manifest?.name || p.name,
                  description: p.manifest?.description,
                  version: p.version,
                  marketplace: p.marketplace,
                  enabled: p.enabled,
                })),
                total: plugins.length,
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
            text: `Error listing installed plugins: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:read'],
};

/**
 * Install / enable a plugin
 */
export const installPluginTool: ToolDefinition = {
  tool: {
    name: 'install_plugin',
    description: 'Install (enable) a plugin from a marketplace. The plugin must exist in the marketplace.',
    inputSchema: {
      type: 'object',
      properties: {
        pluginName: {
          type: 'string',
          description: 'Plugin name to install',
        },
        marketplaceName: {
          type: 'string',
          description: 'Marketplace name where the plugin is located',
        },
      },
      required: ['pluginName', 'marketplaceName'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const pluginName = params.pluginName as string;
      const marketplaceName = params.marketplaceName as string;

      const request: PluginInstallRequest = {
        pluginName,
        marketplaceId: marketplaceName,
        marketplaceName,
      };

      const result = await pluginInstaller.installPlugin(request);

      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to install plugin: ${result.error || result.message || 'Unknown error'}`,
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
                pluginName,
                marketplaceName,
                message: result.message || `Plugin "${pluginName}" installed successfully`,
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
            text: `Error installing plugin: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

/**
 * Uninstall / disable a plugin
 */
export const uninstallPluginTool: ToolDefinition = {
  tool: {
    name: 'uninstall_plugin',
    description: 'Uninstall (disable) an installed plugin',
    inputSchema: {
      type: 'object',
      properties: {
        pluginName: {
          type: 'string',
          description: 'Plugin name to uninstall',
        },
        marketplaceName: {
          type: 'string',
          description: 'Marketplace name where the plugin is located',
        },
      },
      required: ['pluginName', 'marketplaceName'],
    },
  },
  handler: async (params): Promise<McpToolCallResult> => {
    try {
      const pluginName = params.pluginName as string;
      const marketplaceName = params.marketplaceName as string;

      const success = await pluginInstaller.uninstallPlugin(pluginName, marketplaceName);

      if (!success) {
        return {
          content: [{ type: 'text', text: `Failed to uninstall plugin "${pluginName}"` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { success: true, pluginName, marketplaceName, message: `Plugin "${pluginName}" uninstalled successfully` },
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
            text: `Error uninstalling plugin: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
  requiredPermissions: ['system:write'],
};

export const marketplaceTools: ToolDefinition[] = [
  listMarketplacesTool,
  listMarketplacePluginsTool,
  listInstalledPluginsTool,
  installPluginTool,
  uninstallPluginTool,
];
