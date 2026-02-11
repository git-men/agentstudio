/**
 * Marketplace Skills Routes
 * 
 * Provides skill-level management API for marketplace plugins.
 * Skills are grouped by plugin (as categories) and can be individually
 * enabled/disabled.
 * 
 * API Endpoints:
 * - GET    /api/marketplace-skills           - List all skills grouped by plugin
 * - POST   /api/marketplace-skills/toggle    - Toggle a single skill
 * - POST   /api/marketplace-skills/batch     - Batch toggle multiple skills
 * - POST   /api/marketplace-skills/group/:marketplaceName/:pluginName/enable-all  - Enable all skills in a group
 * - POST   /api/marketplace-skills/group/:marketplaceName/:pluginName/disable-all - Disable all skills in a group
 */

import express from 'express';
import { marketplaceSkillService } from '../services/marketplaceSkillService';

const router: express.Router = express.Router();

/**
 * GET /api/marketplace-skills
 * List all marketplace skills grouped by plugin.
 * 
 * Query params:
 * - search: Optional search string to filter skills
 * 
 * Response: {
 *   totalCount: number,
 *   enabledCount: number,
 *   groups: [{
 *     name: string,
 *     pluginName: string,
 *     marketplaceName: string,
 *     description?: string,
 *     totalCount: number,
 *     enabledCount: number,
 *     skills: [{
 *       id: string,       // "marketplaceName/pluginName/skillName"
 *       name: string,
 *       description?: string,
 *       enabled: boolean,
 *       pluginName: string,
 *       marketplaceName: string,
 *     }]
 *   }]
 * }
 */
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const result = await marketplaceSkillService.getGroupedSkills(
      search as string | undefined
    );
    res.json(result);
  } catch (error) {
    console.error('Failed to get marketplace skills:', error);
    res.status(500).json({
      error: 'Failed to retrieve marketplace skills',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/marketplace-skills/toggle
 * Toggle a single skill's enabled state.
 * 
 * Body: {
 *   skillId: string,   // "marketplaceName/pluginName/skillName"
 *   enabled: boolean,
 * }
 * 
 * Response: {
 *   success: boolean,
 *   skillId: string,
 *   enabled: boolean,
 *   error?: string,
 * }
 */
router.post('/toggle', async (req, res) => {
  try {
    const { skillId, enabled } = req.body;

    if (!skillId || typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Missing required fields: skillId (string) and enabled (boolean)',
      });
    }

    const result = await marketplaceSkillService.toggleSkill(skillId, enabled);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to toggle marketplace skill:', error);
    res.status(500).json({
      error: 'Failed to toggle skill',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/marketplace-skills/batch
 * Batch toggle multiple skills.
 * 
 * Body: {
 *   actions: [{
 *     skillId: string,
 *     enabled: boolean,
 *   }]
 * }
 * 
 * Response: {
 *   results: [{ success, skillId, enabled, error? }],
 *   successCount: number,
 *   failCount: number,
 * }
 */
router.post('/batch', async (req, res) => {
  try {
    const { actions } = req.body;

    if (!actions || !Array.isArray(actions)) {
      return res.status(400).json({
        error: 'Missing required field: actions (array of { skillId, enabled })',
      });
    }

    // Validate each action
    for (const action of actions) {
      if (!action.skillId || typeof action.enabled !== 'boolean') {
        return res.status(400).json({
          error: 'Each action must have skillId (string) and enabled (boolean)',
        });
      }
    }

    const result = await marketplaceSkillService.batchToggle({ actions });
    res.json(result);
  } catch (error) {
    console.error('Failed to batch toggle marketplace skills:', error);
    res.status(500).json({
      error: 'Failed to batch toggle skills',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/marketplace-skills/group/:marketplaceName/:pluginName/enable-all
 * Enable all skills in a plugin group.
 */
router.post('/group/:marketplaceName/:pluginName/enable-all', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const result = await marketplaceSkillService.enableAllInGroup(marketplaceName, pluginName);
    res.json({
      ...result,
      message: `Enabled ${result.successCount} skills in ${pluginName}`,
    });
  } catch (error) {
    console.error('Failed to enable all skills in group:', error);
    res.status(500).json({
      error: 'Failed to enable all skills in group',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/marketplace-skills/group/:marketplaceName/:pluginName/disable-all
 * Disable all skills in a plugin group.
 */
router.post('/group/:marketplaceName/:pluginName/disable-all', async (req, res) => {
  try {
    const { marketplaceName, pluginName } = req.params;
    const result = await marketplaceSkillService.disableAllInGroup(marketplaceName, pluginName);
    res.json({
      ...result,
      message: `Disabled ${result.successCount} skills in ${pluginName}`,
    });
  } catch (error) {
    console.error('Failed to disable all skills in group:', error);
    res.status(500).json({
      error: 'Failed to disable all skills in group',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
