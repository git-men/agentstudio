/**
 * Engine Configuration API Routes
 * 
 * Provides endpoints for:
 * - GET /api/engine - Get current engine configuration
 * - GET /api/engine/capabilities - Get engine capabilities
 * - GET /api/engine/paths - Get engine paths configuration
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import {
  getEngineConfig,
  getEngineType,
  getEnginePaths,
  isFeatureSupported,
  projectPathToHash,
  getProjectDataDir,
  isCursorEngine,
} from '../config/engineConfig.js';
import type { EngineInfoResponse } from '../types/engine.js';
import {
  getMcpServers,
  getRules,
  getCommands,
  getSkills,
  getPluginsConfig,
  getMarketplacesConfig,
} from '../services/cursorConfigService.js';

const router: RouterType = Router();

/**
 * GET /api/engine
 * Get current engine configuration
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const config = getEngineConfig();
    const response: EngineInfoResponse = {
      engine: config.engine,
      name: config.name,
      version: config.version,
      capabilities: config.capabilities,
      paths: config.paths,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting engine config:', error);
    res.status(500).json({
      error: 'Failed to get engine configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/engine/capabilities
 * Get engine capabilities only
 */
router.get('/capabilities', (_req: Request, res: Response) => {
  try {
    const config = getEngineConfig();
    res.json(config.capabilities);
  } catch (error) {
    console.error('Error getting engine capabilities:', error);
    res.status(500).json({
      error: 'Failed to get engine capabilities',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/engine/paths
 * Get engine paths configuration
 */
router.get('/paths', (_req: Request, res: Response) => {
  try {
    const paths = getEnginePaths();
    res.json(paths);
  } catch (error) {
    console.error('Error getting engine paths:', error);
    res.status(500).json({
      error: 'Failed to get engine paths',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/engine/feature/:feature
 * Check if a specific feature is supported
 */
router.get('/feature/:feature', (req: Request, res: Response) => {
  try {
    const { feature } = req.params;
    const config = getEngineConfig();
    const features = config.capabilities.features;
    
    if (!(feature in features)) {
      res.status(400).json({
        error: 'Unknown feature',
        message: `Feature "${feature}" is not recognized`,
        validFeatures: Object.keys(features),
      });
      return;
    }
    
    const supported = isFeatureSupported(feature as keyof typeof features);
    res.json({
      feature,
      supported,
      engine: getEngineType(),
    });
  } catch (error) {
    console.error('Error checking feature:', error);
    res.status(500).json({
      error: 'Failed to check feature support',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/engine/project-data
 * Get project data directory information
 */
router.get('/project-data', (req: Request, res: Response) => {
  try {
    const { projectPath } = req.query;
    
    if (!projectPath || typeof projectPath !== 'string') {
      res.status(400).json({
        error: 'Missing projectPath query parameter',
      });
      return;
    }
    
    const hash = projectPathToHash(projectPath);
    const dataDir = getProjectDataDir(projectPath);
    
    res.json({
      projectPath,
      hash,
      dataDir,
      mcpsDir: `${dataDir}/mcps`,
      transcriptsDir: `${dataDir}/agent-transcripts`,
      terminalsDir: `${dataDir}/terminals`,
      assetsDir: `${dataDir}/assets`,
    });
  } catch (error) {
    console.error('Error getting project data:', error);
    res.status(500).json({
      error: 'Failed to get project data directory',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/engine/cursor-config
 * Get Cursor configuration (MCP, rules, commands, skills, plugins)
 * Only available when running with cursor-cli engine
 */
router.get('/cursor-config', async (_req: Request, res: Response) => {
  try {
    if (!isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'This endpoint is only available when running with cursor-cli engine',
      });
      return;
    }

    const [mcp, rules, commands, skills, plugins, marketplaces] = await Promise.all([
      getMcpServers(),
      getRules(),
      getCommands(),
      getSkills(),
      getPluginsConfig(),
      getMarketplacesConfig(),
    ]);

    res.json({
      mcp,
      rules,
      commands,
      skills,
      plugins,
      marketplaces,
    });
  } catch (error) {
    console.error('Error getting Cursor config:', error);
    res.status(500).json({
      error: 'Failed to get Cursor configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
