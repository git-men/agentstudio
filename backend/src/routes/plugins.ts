import express from 'express';
import { pluginScanner } from '../services/pluginScanner';
import { pluginInstaller } from '../services/pluginInstaller';
import { pluginParser } from '../services/pluginParser';
import { pluginPaths } from '../services/pluginPaths';
import { agentImporter } from '../services/agentImporter';
import { 
  getMarketplaceUpdateServiceStatus,
  checkAllUpdatesNow,
  checkUpdateNow,
  updateMarketplaceAutoUpdateConfig,
} from '../services/marketplaceUpdateService';
import { syncBuiltinMarketplaces, getBuiltinMarketplaceStatus } from '../services/builtinMarketplaceService';
import { MarketplaceAddRequest, PluginInstallRequest, MarketplaceType } from '../types/plugins';

// Valid marketplace types
const VALID_MARKETPLACE_TYPES: MarketplaceType[] = ['git', 'github', 'local', 'cos', 'archive'];

const router: express.Router = express.Router();

// ============================================
// Marketplace Routes
// ============================================

/**
 * GET /api/plugin-marketplaces
 * Get all marketplaces
 */
router.get('/marketplaces', async (req, res) => {
  try {
    const marketplaces = await pluginScanner.scanMarketplaces();
    res.json({ marketplaces });
  } catch (error) {
    console.error('Failed to get marketplaces:', error);
    res.status(500).json({
      error: 'Failed to retrieve marketplaces',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugin-marketplaces
 * Add a new marketplace
 */
router.post('/marketplaces', async (req, res) => {
  try {
    const request: MarketplaceAddRequest = req.body;

    // Validate request
    if (!request.name || !request.type || !request.source) {
      return res.status(400).json({
        error: 'Missing required fields: name, type, source',
      });
    }

    if (!VALID_MARKETPLACE_TYPES.includes(request.type)) {
      return res.status(400).json({
        error: `Invalid type. Must be one of: ${VALID_MARKETPLACE_TYPES.join(', ')}`,
      });
    }

    // Validate COS-specific configuration
    if (request.type === 'cos' && !request.source) {
      return res.status(400).json({
        error: 'COS marketplace requires a source URL',
      });
    }

    // Validate archive URL
    if (request.type === 'archive' && !request.source.startsWith('http')) {
      return res.status(400).json({
        error: 'Archive marketplace requires a valid HTTP/HTTPS URL',
      });
    }

    const result = await pluginInstaller.addMarketplace(request);

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
      });
    }

    // Get marketplace info
    const marketplaceName = request.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const marketplace = await pluginScanner.scanMarketplace(marketplaceName);

    const parts = [`${result.pluginCount} plugins`];
    if (result.agentCount && result.agentCount > 0) {
      parts.push(`${result.agentCount} agents`);
    }

    res.json({
      marketplace,
      message: `Marketplace added successfully with ${parts.join(' and ')}`,
    });
  } catch (error) {
    console.error('Failed to add marketplace:', error);
    res.status(500).json({
      error: 'Failed to add marketplace',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugin-marketplaces/:id/sync
 * Sync (update) a marketplace
 */
router.post('/marketplaces/:id/sync', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pluginInstaller.syncMarketplace(id);

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
      });
    }

    const parts = [`${result.pluginCount} plugins`];
    if (result.agentCount && result.agentCount > 0) {
      parts.push(`${result.agentCount} agents`);
    }

    res.json({
      success: true,
      pluginCount: result.pluginCount,
      agentCount: result.agentCount,
      message: `Marketplace synced successfully with ${parts.join(' and ')}`,
    });
  } catch (error) {
    console.error('Failed to sync marketplace:', error);
    res.status(500).json({
      error: 'Failed to sync marketplace',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugin-marketplaces/:id/check-updates
 * Check if a marketplace has updates available
 */
router.get('/marketplaces/:id/check-updates', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pluginInstaller.checkForUpdates(id);

    res.json(result);
  } catch (error) {
    console.error('Failed to check for updates:', error);
    res.status(500).json({
      error: 'Failed to check for updates',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugin-marketplaces/check-all-updates
 * Check all marketplaces for updates
 */
router.get('/marketplaces/check-all-updates', async (req, res) => {
  try {
    const marketplaces = await pluginScanner.scanMarketplaces();
    const results = [];
    let updatesAvailable = 0;

    for (const marketplace of marketplaces) {
      const result = await pluginInstaller.checkForUpdates(marketplace.id);
      results.push(result);
      if (result.hasUpdate) {
        updatesAvailable++;
      }
    }

    res.json({
      results,
      updatesAvailable,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to check all marketplaces for updates:', error);
    res.status(500).json({
      error: 'Failed to check for updates',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugin-marketplaces/reinitialize-builtin
 * Re-run builtin marketplace initialization (same as startup flow).
 * Uses file lock to prevent concurrent runs.
 * Called by as-mate after COS sync completes, or manually.
 */
router.post('/marketplaces/reinitialize-builtin', async (req, res) => {
  try {
    const result = await syncBuiltinMarketplaces();

    if (!result.success && result.error === 'Sync already in progress') {
      res.status(409).json(result); // Conflict
      return;
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to reinitialize builtin marketplaces:', error);
    res.status(500).json({
      error: 'Failed to reinitialize builtin marketplaces',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugin-marketplaces/builtin-status
 * Get the current status of builtin marketplace sync
 */
router.get('/marketplaces/builtin-status', async (req, res) => {
  try {
    const status = getBuiltinMarketplaceStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get builtin marketplace status',
    });
  }
});

/**
 * GET /api/plugin-marketplaces/auto-update-list
 * Get list of marketplaces with auto-update enabled
 */
router.get('/marketplaces/auto-update-list', async (req, res) => {
  try {
    const marketplaceNames = await pluginInstaller.getAutoUpdateMarketplaces();
    res.json({ marketplaces: marketplaceNames });
  } catch (error) {
    console.error('Failed to get auto-update marketplaces:', error);
    res.status(500).json({
      error: 'Failed to get auto-update marketplaces',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/plugin-marketplaces/:id
 * Remove a marketplace
 */
router.delete('/marketplaces/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await pluginInstaller.removeMarketplace(id);

    if (!success) {
      return res.status(404).json({
        error: 'Marketplace not found',
      });
    }

    res.json({
      success: true,
      message: 'Marketplace removed successfully',
    });
  } catch (error) {
    console.error('Failed to remove marketplace:', error);
    res.status(500).json({
      error: 'Failed to remove marketplace',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Plugin Routes
// ============================================

/**
 * GET /api/plugins/available
 * Get all available plugins from all marketplaces
 */
router.get('/available', async (req, res) => {
  try {
    const plugins = await pluginScanner.getAvailablePlugins();
    res.json({ plugins });
  } catch (error) {
    console.error('Failed to get available plugins:', error);
    res.status(500).json({
      error: 'Failed to retrieve available plugins',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugins/installed
 * Get all installed plugins
 */
router.get('/installed', async (req, res) => {
  try {
    const plugins = await pluginScanner.scanInstalledPlugins();
    res.json({ plugins });
  } catch (error) {
    console.error('Failed to get installed plugins:', error);
    res.status(500).json({
      error: 'Failed to retrieve installed plugins',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugins/:marketplaceName/:pluginName
 * Get details of a specific plugin
 */
router.get('/:marketplaceName/:pluginName', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;

    const plugin = await pluginScanner.scanPlugin(marketplaceName, pluginName);

    if (!plugin) {
      return res.status(404).json({
        error: 'Plugin not found',
      });
    }

    // Get parsed plugin for more details
    const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);
    const parsedPlugin = await pluginParser.parsePlugin(pluginPath, marketplaceName, pluginName);

    res.json({
      plugin,
      components: parsedPlugin.components, // Return detailed component info
      files: parsedPlugin.files,
      readme: await pluginParser.readReadme(pluginPath),
      manifest: parsedPlugin.manifest,
    });
  } catch (error) {
    console.error('Failed to get plugin details:', error);
    res.status(500).json({
      error: 'Failed to retrieve plugin details',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/plugins/:marketplaceName/:pluginName/files/:filePath
 * Get content of a specific file in a plugin
 */
router.get('/:marketplaceName/:pluginName/files/*', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const filePath = (req.params as any)[0]; // Get the wildcard path

    const pluginPath = pluginPaths.getPluginPath(marketplaceName, pluginName);
    const fullFilePath = pluginPath + '/' + filePath;

    // Security check: ensure file is within plugin directory
    if (!fullFilePath.startsWith(pluginPath)) {
      return res.status(403).json({
        error: 'Access denied',
      });
    }

    const content = await pluginParser.readFileContent(fullFilePath);
    res.json({ content });
  } catch (error) {
    console.error('Failed to read file:', error);
    res.status(500).json({
      error: 'Failed to read file',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/install
 * Install a plugin (create symlinks)
 */
router.post('/install', async (req, res) => {
  try {
    const request: PluginInstallRequest = req.body;

    // Validate request
    if (!request.pluginName || !request.marketplaceName) {
      return res.status(400).json({
        error: 'Missing required fields: pluginName, marketplaceName',
      });
    }

    const result = await pluginInstaller.installPlugin(request);

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      plugin: result.plugin,
      message: result.message,
    });
  } catch (error) {
    console.error('Failed to install plugin:', error);
    res.status(500).json({
      error: 'Failed to install plugin',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/:marketplaceName/:pluginName/enable
 * Enable a plugin (create symlinks)
 */
router.post('/:marketplaceName/:pluginName/enable', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const success = await pluginInstaller.enablePlugin(pluginName, marketplaceName);

    if (!success) {
      return res.status(400).json({
        error: 'Failed to enable plugin',
      });
    }

    // Get updated plugin info
    const plugin = await pluginScanner.scanPlugin(marketplaceName, pluginName);

    res.json({
      success: true,
      plugin,
      message: 'Plugin enabled successfully',
    });
  } catch (error) {
    console.error('Failed to enable plugin:', error);
    res.status(500).json({
      error: 'Failed to enable plugin',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/:marketplaceName/:pluginName/disable
 * Disable a plugin (remove symlinks)
 */
router.post('/:marketplaceName/:pluginName/disable', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const success = await pluginInstaller.disablePlugin(pluginName, marketplaceName);

    if (!success) {
      return res.status(400).json({
        error: 'Failed to disable plugin',
      });
    }

    // Get updated plugin info
    const plugin = await pluginScanner.scanPlugin(marketplaceName, pluginName);

    res.json({
      success: true,
      plugin,
      message: 'Plugin disabled successfully',
    });
  } catch (error) {
    console.error('Failed to disable plugin:', error);
    res.status(500).json({
      error: 'Failed to disable plugin',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/plugins/:marketplaceName/:pluginName
 * Uninstall a plugin (remove symlinks)
 */
router.delete('/:marketplaceName/:pluginName', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const success = await pluginInstaller.uninstallPlugin(pluginName, marketplaceName);

    if (!success) {
      return res.status(404).json({
        error: 'Plugin not found',
      });
    }

    res.json({
      success: true,
      message: 'Plugin uninstalled successfully',
    });
  } catch (error) {
    console.error('Failed to uninstall plugin:', error);
    res.status(500).json({
      error: 'Failed to uninstall plugin',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Marketplace Update Service Routes
// ============================================

/**
 * GET /api/plugins/update-service/status
 * Get marketplace update service status
 */
router.get('/update-service/status', async (req, res) => {
  try {
    const status = getMarketplaceUpdateServiceStatus();
    res.json(status);
  } catch (error) {
    console.error('Failed to get update service status:', error);
    res.status(500).json({
      error: 'Failed to get update service status',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/update-service/check-all
 * Trigger immediate update check for all marketplaces
 */
router.post('/update-service/check-all', async (req, res) => {
  try {
    const result = await checkAllUpdatesNow();
    res.json(result);
  } catch (error) {
    console.error('Failed to check all updates:', error);
    res.status(500).json({
      error: 'Failed to check updates',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/update-service/check/:marketplaceId
 * Trigger immediate update check for a specific marketplace
 */
router.post('/update-service/check/:marketplaceId', async (req, res) => {
  try {
    const { marketplaceId } = req.params;
    const result = await checkUpdateNow(marketplaceId);
    res.json(result);
  } catch (error) {
    console.error('Failed to check marketplace update:', error);
    res.status(500).json({
      error: 'Failed to check update',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/plugins/marketplaces/:id/auto-update
 * Update marketplace auto-update configuration
 */
router.put('/marketplaces/:id/auto-update', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, checkInterval } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid request: enabled must be a boolean',
      });
    }

    await updateMarketplaceAutoUpdateConfig(id, { enabled, checkInterval });

    res.json({
      success: true,
      message: `Auto-update ${enabled ? 'enabled' : 'disabled'} for marketplace '${id}'`,
    });
  } catch (error) {
    console.error('Failed to update auto-update config:', error);
    res.status(500).json({
      error: 'Failed to update auto-update configuration',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Marketplace Agent Import Routes
// ============================================

/**
 * GET /api/plugins/marketplaces/:id/agents
 * List agents available in a marketplace
 */
router.get('/marketplaces/:id/agents', async (req, res) => {
  try {
    const { id } = req.params;
    const agents = await agentImporter.listMarketplaceAgents(id);
    const installedAgents = await agentImporter.getInstalledAgentsFromMarketplace(id);

    res.json({
      agents: agents.map(agent => ({
        ...agent,
        installed: installedAgents.includes(agentImporter['generateAgentId'](agent.name)),
      })),
      installedCount: installedAgents.length,
      totalCount: agents.length,
    });
  } catch (error) {
    console.error('Failed to list marketplace agents:', error);
    res.status(500).json({
      error: 'Failed to list marketplace agents',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/marketplaces/:id/agents/import-all
 * Import all agents from a marketplace
 */
router.post('/marketplaces/:id/agents/import-all', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await agentImporter.importAgentsFromMarketplace(id);

    if (result.errorCount > 0 && result.importedCount === 0) {
      return res.status(400).json({
        error: 'Failed to import agents',
        result,
      });
    }

    res.json({
      success: true,
      result,
      message: `Imported ${result.importedCount}/${result.totalAgents} agents from marketplace '${id}'`,
    });
  } catch (error) {
    console.error('Failed to import marketplace agents:', error);
    res.status(500).json({
      error: 'Failed to import agents',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/plugins/marketplaces/:id/agents/:agentName/import
 * Import a specific agent from a marketplace
 */
router.post('/marketplaces/:id/agents/:agentName/import', async (req, res) => {
  try {
    const { id, agentName } = req.params;
    const agents = await agentImporter.listMarketplaceAgents(id);
    
    const agentDef = agents.find(a => a.name === agentName || agentImporter['generateAgentId'](a.name) === agentName);
    
    if (!agentDef) {
      return res.status(404).json({
        error: `Agent '${agentName}' not found in marketplace '${id}'`,
      });
    }

    const result = await agentImporter.importAgent(id, agentDef);

    if (!result.success) {
      return res.status(400).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      agentId: result.agentId,
      agentName: result.agentName,
      message: `Agent '${result.agentName}' imported successfully`,
    });
  } catch (error) {
    console.error('Failed to import agent:', error);
    res.status(500).json({
      error: 'Failed to import agent',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/plugins/marketplaces/:id/agents/:agentName
 * Uninstall a marketplace agent
 */
router.delete('/marketplaces/:id/agents/:agentName', async (req, res) => {
  try {
    const { id, agentName } = req.params;
    const agentId = agentImporter['generateAgentId'](agentName);
    
    const success = await agentImporter.uninstallAgent(agentId);

    if (!success) {
      return res.status(400).json({
        error: `Failed to uninstall agent '${agentName}'. It may not be a marketplace-installed agent.`,
      });
    }

    res.json({
      success: true,
      message: `Agent '${agentName}' uninstalled successfully`,
    });
  } catch (error) {
    console.error('Failed to uninstall agent:', error);
    res.status(500).json({
      error: 'Failed to uninstall agent',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/plugins/marketplaces/:id/agents
 * Uninstall all agents from a marketplace
 */
router.delete('/marketplaces/:id/agents', async (req, res) => {
  try {
    const { id } = req.params;
    const count = await agentImporter.uninstallMarketplaceAgents(id);

    res.json({
      success: true,
      uninstalledCount: count,
      message: `Uninstalled ${count} agents from marketplace '${id}'`,
    });
  } catch (error) {
    console.error('Failed to uninstall marketplace agents:', error);
    res.status(500).json({
      error: 'Failed to uninstall agents',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

