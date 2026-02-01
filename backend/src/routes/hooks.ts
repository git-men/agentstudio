/**
 * Hooks API routes (Claude Code only)
 * 
 * Hooks are configured in settings files:
 * - Global: ~/.claude/settings.json
 * - Local: .claude/settings.local.json
 */

import express, { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Hook, HookListItem, HookCreate, HookUpdate, HooksConfig } from '../types/hooks.js';
import { isCursorEngine } from '../config/engineConfig.js';
import { getSdkDirName } from '../config/sdkConfig.js';

const router: Router = Router();

// Get global settings file path
const getGlobalSettingsPath = (): string => {
  return path.join(os.homedir(), '.claude', 'settings.json');
};

// Get local settings file path
const getLocalSettingsPath = (projectPath?: string): string => {
  const sdkDirName = getSdkDirName();
  if (projectPath) {
    return path.join(projectPath, sdkDirName, 'settings.local.json');
  }
  return path.join(process.cwd(), '..', sdkDirName, 'settings.local.json');
};

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Read settings file
async function readSettingsFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    if (!(await fileExists(filePath))) {
      return {};
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading settings file ${filePath}:`, error);
    return {};
  }
}

// Write settings file
async function writeSettingsFile(filePath: string, settings: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
}

// Extract hooks from settings
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

// GET /api/hooks - List all hooks
router.get('/', async (req: Request, res: Response) => {
  try {
    // Hooks are only available in Claude SDK mode
    if (isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'Hooks are only available when using Claude SDK engine',
      });
      return;
    }
    
    const projectPath = req.query.projectPath as string;
    const scope = req.query.scope as 'global' | 'local' | 'all' || 'all';
    
    const hooks: HookListItem[] = [];
    
    // Read global hooks
    if (scope === 'all' || scope === 'global') {
      const globalSettings = await readSettingsFile(getGlobalSettingsPath());
      const globalHooks = extractHooks(globalSettings, 'global');
      hooks.push(...globalHooks);
    }
    
    // Read local hooks
    if (scope === 'all' || scope === 'local') {
      const localSettings = await readSettingsFile(getLocalSettingsPath(projectPath));
      const localHooks = extractHooks(localSettings, 'local');
      hooks.push(...localHooks);
    }
    
    res.json({
      hooks,
      engine: 'claude-sdk',
    });
  } catch (error) {
    console.error('Error listing hooks:', error);
    res.status(500).json({ error: 'Failed to list hooks' });
  }
});

// GET /api/hooks/:id - Get a single hook
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'Hooks are only available when using Claude SDK engine',
      });
      return;
    }
    
    const { id } = req.params;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:index
    const [scope, indexStr] = id.split(':');
    const index = parseInt(indexStr, 10);
    
    if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
      res.status(400).json({ error: 'Invalid hook ID format. Expected: scope:index' });
      return;
    }
    
    const settingsPath = scope === 'global' 
      ? getGlobalSettingsPath() 
      : getLocalSettingsPath(projectPath);
    
    const settings = await readSettingsFile(settingsPath);
    const hooksConfig = settings as HooksConfig;
    const hooks = hooksConfig.hooks || [];
    
    if (index < 0 || index >= hooks.length) {
      res.status(404).json({ error: 'Hook not found' });
      return;
    }
    
    const hook = hooks[index];
    const hookItem: HookListItem = {
      id,
      event: hook.event,
      command: hook.command,
      matcher: hook.matcher,
      enabled: hook.enabled !== false,
      timeout: hook.timeout,
    };
    
    res.json({ hook: hookItem });
  } catch (error) {
    console.error('Error getting hook:', error);
    res.status(500).json({ error: 'Failed to get hook' });
  }
});

// POST /api/hooks - Create a new hook
router.post('/', async (req: Request, res: Response) => {
  try {
    if (isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'Hooks are only available when using Claude SDK engine',
      });
      return;
    }
    
    const hookData: HookCreate = req.body;
    const projectPath = req.query.projectPath as string;
    const scope = (req.query.scope as 'global' | 'local') || 'global';
    
    if (!hookData.event || !hookData.command) {
      res.status(400).json({ error: 'Missing required fields: event, command' });
      return;
    }
    
    const validEvents = [
      'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
      'PermissionRequest', 'SessionStart', 'UserPromptSubmit', 'Notification'
    ];
    
    if (!validEvents.includes(hookData.event)) {
      res.status(400).json({ error: `Invalid event type. Must be one of: ${validEvents.join(', ')}` });
      return;
    }
    
    const settingsPath = scope === 'global' 
      ? getGlobalSettingsPath() 
      : getLocalSettingsPath(projectPath);
    
    const settings = await readSettingsFile(settingsPath);
    const hooksConfig = settings as HooksConfig;
    
    if (!hooksConfig.hooks) {
      hooksConfig.hooks = [];
    }
    
    const newHook: Hook = {
      event: hookData.event,
      command: hookData.command,
      matcher: hookData.matcher,
      enabled: hookData.enabled !== false,
      timeout: hookData.timeout,
    };
    
    hooksConfig.hooks.push(newHook);
    await writeSettingsFile(settingsPath, settings);
    
    const hookItem: HookListItem = {
      id: `${scope}:${hooksConfig.hooks.length - 1}`,
      ...newHook,
      enabled: newHook.enabled !== false,
    };
    
    res.status(201).json({ hook: hookItem, message: 'Hook created successfully' });
  } catch (error) {
    console.error('Error creating hook:', error);
    res.status(500).json({ error: 'Failed to create hook' });
  }
});

// PUT /api/hooks/:id - Update a hook
router.put('/:id', async (req: Request, res: Response) => {
  try {
    if (isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'Hooks are only available when using Claude SDK engine',
      });
      return;
    }
    
    const { id } = req.params;
    const updateData: HookUpdate = req.body;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:index
    const [scope, indexStr] = id.split(':');
    const index = parseInt(indexStr, 10);
    
    if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
      res.status(400).json({ error: 'Invalid hook ID format. Expected: scope:index' });
      return;
    }
    
    const settingsPath = scope === 'global' 
      ? getGlobalSettingsPath() 
      : getLocalSettingsPath(projectPath);
    
    const settings = await readSettingsFile(settingsPath);
    const hooksConfig = settings as HooksConfig;
    const hooks = hooksConfig.hooks || [];
    
    if (index < 0 || index >= hooks.length) {
      res.status(404).json({ error: 'Hook not found' });
      return;
    }
    
    // Update hook
    const existingHook = hooks[index];
    const updatedHook: Hook = {
      event: updateData.event ?? existingHook.event,
      command: updateData.command ?? existingHook.command,
      matcher: updateData.matcher ?? existingHook.matcher,
      enabled: updateData.enabled ?? existingHook.enabled,
      timeout: updateData.timeout ?? existingHook.timeout,
    };
    
    hooks[index] = updatedHook;
    await writeSettingsFile(settingsPath, settings);
    
    const hookItem: HookListItem = {
      id,
      ...updatedHook,
      enabled: updatedHook.enabled !== false,
    };
    
    res.json({ hook: hookItem, message: 'Hook updated successfully' });
  } catch (error) {
    console.error('Error updating hook:', error);
    res.status(500).json({ error: 'Failed to update hook' });
  }
});

// DELETE /api/hooks/:id - Delete a hook
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (isCursorEngine()) {
      res.status(400).json({
        error: 'Not available',
        message: 'Hooks are only available when using Claude SDK engine',
      });
      return;
    }
    
    const { id } = req.params;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:index
    const [scope, indexStr] = id.split(':');
    const index = parseInt(indexStr, 10);
    
    if (!scope || isNaN(index) || !['global', 'local'].includes(scope)) {
      res.status(400).json({ error: 'Invalid hook ID format. Expected: scope:index' });
      return;
    }
    
    const settingsPath = scope === 'global' 
      ? getGlobalSettingsPath() 
      : getLocalSettingsPath(projectPath);
    
    const settings = await readSettingsFile(settingsPath);
    const hooksConfig = settings as HooksConfig;
    const hooks = hooksConfig.hooks || [];
    
    if (index < 0 || index >= hooks.length) {
      res.status(404).json({ error: 'Hook not found' });
      return;
    }
    
    // Remove hook
    hooks.splice(index, 1);
    await writeSettingsFile(settingsPath, settings);
    
    res.json({ message: 'Hook deleted successfully' });
  } catch (error) {
    console.error('Error deleting hook:', error);
    res.status(500).json({ error: 'Failed to delete hook' });
  }
});

export default router;
