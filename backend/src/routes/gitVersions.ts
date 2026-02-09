/**
 * Git Version Management API Routes
 * 
 * Provides endpoints for managing project versions via Git.
 * All routes are scoped under /api/projects/:projectId/versions
 */

import express from 'express';
import path from 'path';
import { ProjectMetadataStorage } from '../services/projectMetadataStorage';
import {
  createVersion,
  createTagOnly,
  listVersions,
  getVersionStatus,
  getCurrentCommitHash,
  checkoutVersion,
  rollbackVersion,
  deleteVersion,
} from '../services/gitVersionService';

interface VersionParams {
  projectId: string;
  tag?: string;
}

const router: express.Router = express.Router({ mergeParams: true });
const projectStorage = new ProjectMetadataStorage();

/**
 * Resolve project path from the projectId URL parameter.
 * projectId can be an encoded path or a project identifier.
 */
function resolveProjectPath(projectId: string): string {
  const decodedPath = decodeURIComponent(projectId);
  const normalizedPath = path.isAbsolute(decodedPath) ? decodedPath : `/${decodedPath}`;
  
  // Try to look up the project to get the real path
  const project = projectStorage.getProject(decodedPath);
  if (project && project.path) {
    return project.path;
  }

  // Fallback: use decoded path directly
  return normalizedPath;
}

// ========================================
// GET /api/projects/:projectId/versions
// List all versions for a project
// ========================================
router.get('/', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const versions = await listVersions(projectPath);
    res.json({ versions });
  } catch (error: any) {
    console.error('[GitVersion] Error listing versions:', error.message);
    res.status(500).json({ error: error.message || 'Failed to list versions' });
  }
});

// ========================================
// GET /api/projects/:projectId/versions/status
// Get version status (current version, dirty state, etc.)
// ========================================
router.get('/status', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const status = await getVersionStatus(projectPath);
    res.json(status);
  } catch (error: any) {
    console.error('[GitVersion] Error getting version status:', error.message);
    res.status(500).json({ error: error.message || 'Failed to get version status' });
  }
});

// ========================================
// GET /api/projects/:projectId/versions/commit
// Get current HEAD commit hash
// ========================================
router.get('/commit', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const commitHash = await getCurrentCommitHash(projectPath);
    res.json({ commitHash });
  } catch (error: any) {
    console.error('[GitVersion] Error getting current commit hash:', error.message);
    res.status(500).json({ error: error.message || 'Failed to get current commit hash' });
  }
});

// ========================================
// POST /api/projects/:projectId/versions
// Create a new version
// Body: { message: string, slot: number }
// ========================================
router.post('/', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    console.log('[GitVersion] createVersion request', {
      projectId: req.params.projectId,
      decodedProjectId: decodeURIComponent(req.params.projectId),
      resolvedProjectPath: projectPath,
    });
    const { message, slot } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Version message is required' });
    }
    const slotNumber = Number(slot);
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 5) {
      return res.status(400).json({ error: 'Version slot must be an integer between 1 and 5' });
    }

    const result = await createVersion(projectPath, message.trim(), slotNumber);
    
    console.log(`[GitVersion] Created version ${result.tag} for project: ${projectPath}`);
    res.json({
      success: true,
      version: result,
    });
  } catch (error: any) {
    console.error('[GitVersion] Error creating version:', error.message);
    
    if (error.message.includes('No changes to save')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: error.message || 'Failed to create version' });
  }
});

// ========================================
// POST /api/projects/:projectId/versions/tag
// Create a tag for current HEAD without creating a commit
// Body: { message?: string }
// ========================================
router.post('/tag', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const { tag, message } = req.body;

    if (!tag || typeof tag !== 'string' || !tag.trim()) {
      return res.status(400).json({ error: 'Tag is required' });
    }
    if (message !== undefined && typeof message !== 'string') {
      return res.status(400).json({ error: 'Tag message must be a string' });
    }

    const result = await createTagOnly(projectPath, tag.trim(), message?.trim());

    console.log(`[GitVersion] Created tag ${result.tag} for project: ${projectPath}`);
    res.json({
      success: true,
      version: result,
    });
  } catch (error: any) {
    console.error('[GitVersion] Error creating tag:', error.message);
    res.status(500).json({ error: error.message || 'Failed to create tag' });
  }
});

// ========================================
// POST /api/projects/:projectId/versions/checkout
// Switch to a specific version
// Body: { tag: string, force?: boolean }
// ========================================
router.post('/checkout', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const { tag, force } = req.body;

    if (!tag || typeof tag !== 'string') {
      return res.status(400).json({ error: 'Version tag is required' });
    }

    await checkoutVersion(projectPath, tag, !!force);
    
    console.log(`[GitVersion] Checked out version ${tag} for project: ${projectPath}`);
    res.json({
      success: true,
      message: `Switched to version ${tag}`,
      tag,
    });
  } catch (error: any) {
    console.error('[GitVersion] Error checking out version:', error.message);
    
    if (error.message === 'DIRTY_WORKING_TREE') {
      return res.status(409).json({
        error: 'Working tree has uncommitted changes',
        code: 'DIRTY_WORKING_TREE',
        message: 'Please save a new version or discard changes before switching versions.',
      });
    }
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: error.message || 'Failed to checkout version' });
  }
});

// ========================================
// POST /api/projects/:projectId/versions/rollback
// Rollback to a specific commit (creates a new commit + tag matching that state)
// Body: { hash: string }
// ========================================
router.post('/rollback', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const { hash } = req.body;

    if (!hash || typeof hash !== 'string') {
      return res.status(400).json({ error: 'Commit hash is required' });
    }

    const result = await rollbackVersion(projectPath, hash.trim());

    console.log(`[GitVersion] Rolled back to commit ${hash} → new version ${result.tag} for project: ${projectPath}`);
    res.json({
      success: true,
      version: result,
    });
  } catch (error: any) {
    console.error('[GitVersion] Error rolling back version:', error.message);

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('Rollback failed')) {
      return res.status(409).json({ error: error.message });
    }

    res.status(500).json({ error: error.message || 'Failed to rollback version' });
  }
});

// ========================================
// DELETE /api/projects/:projectId/versions/:tag
// Delete a version tag
// ========================================
router.delete('/:tag', async (req: express.Request<VersionParams>, res) => {
  try {
    const projectPath = resolveProjectPath(req.params.projectId);
    const tag = req.params.tag!;

    await deleteVersion(projectPath, tag);
    
    console.log(`[GitVersion] Deleted version ${tag} for project: ${projectPath}`);
    res.json({
      success: true,
      message: `Version ${tag} deleted`,
    });
  } catch (error: any) {
    console.error('[GitVersion] Error deleting version:', error.message);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    res.status(500).json({ error: error.message || 'Failed to delete version' });
  }
});

export default router;
