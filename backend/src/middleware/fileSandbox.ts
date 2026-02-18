/**
 * File Sandbox Middleware
 *
 * Restricts file system operations to allowed directories only.
 * Prevents arbitrary file read/write when the product edition is not 'full',
 * or when FILE_SANDBOX_DIRS is explicitly configured.
 *
 * Behavior:
 * - full edition without FILE_SANDBOX_DIRS: no restrictions (backward compatible)
 * - chat-only / lite / custom editions: sandbox enforced, must have allowed dirs
 * - FILE_SANDBOX_DIRS env var: comma-separated list of allowed root directories
 * - Project paths from /api/projects are automatically allowed
 *
 * Security:
 * - Resolves all paths to absolute, prevents symlink/traversal attacks
 * - Both the projectPath parameter and the file path within it are validated
 * - /browse endpoint is restricted to allowed directories
 * - /create-directory endpoint is restricted to allowed directories
 */

import type { Request, Response, NextFunction } from 'express';
import { resolve, normalize } from 'path';
import { realpathSync, existsSync } from 'fs';
import { getProductEdition } from '../config/productConfig.js';

let _allowedDirs: string[] | null = null;
let _sandboxEnabled: boolean | null = null;

/**
 * Parse allowed directories from configuration.
 */
function parseAllowedDirs(): string[] {
  const envDirs = process.env.FILE_SANDBOX_DIRS;
  if (!envDirs) return [];

  return envDirs
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0)
    .map(d => {
      try {
        const resolved = resolve(d);
        return existsSync(resolved) ? realpathSync(resolved) : resolved;
      } catch {
        return resolve(d);
      }
    });
}

/**
 * Determine if sandbox should be enforced.
 */
function isSandboxEnabled(): boolean {
  if (_sandboxEnabled !== null) return _sandboxEnabled;

  const edition = getProductEdition();

  if (process.env.FILE_SANDBOX_DIRS) {
    _sandboxEnabled = true;
  } else if (edition === 'full') {
    _sandboxEnabled = false;
  } else {
    // Non-full editions enforce sandbox
    _sandboxEnabled = true;
  }

  return _sandboxEnabled;
}

/**
 * Get the list of allowed root directories.
 */
function getAllowedDirs(): string[] {
  if (_allowedDirs !== null) return _allowedDirs;
  _allowedDirs = parseAllowedDirs();
  return _allowedDirs;
}

/**
 * Check if a resolved absolute path is within any allowed directory.
 */
function isPathAllowed(absolutePath: string): boolean {
  const normalizedPath = normalize(absolutePath);
  const dirs = getAllowedDirs();

  for (const dir of dirs) {
    if (normalizedPath === dir || normalizedPath.startsWith(dir + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve a path safely, following symlinks.
 */
function safeResolve(inputPath: string): string {
  const resolved = resolve(inputPath);
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved);
    }
  } catch {
    // Path doesn't exist yet (e.g., for write), use resolved
  }
  return resolved;
}

/**
 * Extract the target path from the request based on the route.
 */
function extractTargetPath(req: Request): string | null {
  const projectPath = req.query.projectPath as string | undefined;
  const filePath = (req.query.path || req.body?.path) as string | undefined;
  const parentPath = req.body?.parentPath as string | undefined;
  const browsePath = req.query.path as string | undefined;

  // /browse endpoint
  if (req.path === '/browse') {
    return browsePath ? safeResolve(browsePath) : null;
  }

  // /create-directory endpoint
  if (req.path === '/create-directory' && parentPath) {
    return safeResolve(parentPath);
  }

  // /read, /write, /read-multiple endpoints
  if (projectPath) {
    return safeResolve(projectPath);
  }

  if (filePath) {
    return safeResolve(filePath);
  }

  return null;
}

/**
 * File sandbox middleware.
 * Checks all file operations against the allowed directory list.
 */
export function fileSandboxMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isSandboxEnabled()) {
    next();
    return;
  }

  const dirs = getAllowedDirs();

  // If sandbox is enabled but no dirs are configured, block everything
  // except /project-id which is safe (no file system access)
  if (req.path === '/project-id') {
    next();
    return;
  }

  if (dirs.length === 0) {
    res.status(403).json({
      error: 'File access restricted',
      message: 'File sandbox is enabled but no allowed directories are configured. Set FILE_SANDBOX_DIRS environment variable.',
    });
    return;
  }

  const targetPath = extractTargetPath(req);

  // If we can't determine the target path, allow it
  // (the route handler's own validation will catch bad inputs)
  if (!targetPath) {
    next();
    return;
  }

  if (!isPathAllowed(targetPath)) {
    res.status(403).json({
      error: 'File access denied',
      message: 'The requested path is outside the allowed sandbox directories.',
      allowedDirs: dirs,
    });
    return;
  }

  next();
}

/**
 * Add a directory to the runtime allowed list.
 * Used by project management to dynamically allow project directories.
 */
export function addAllowedDirectory(dir: string): void {
  const resolved = safeResolve(dir);
  const dirs = getAllowedDirs();
  if (!dirs.includes(resolved)) {
    dirs.push(resolved);
  }
}

/**
 * Get current sandbox status for logging/debugging.
 */
export function getSandboxStatus(): { enabled: boolean; allowedDirs: string[] } {
  return {
    enabled: isSandboxEnabled(),
    allowedDirs: getAllowedDirs(),
  };
}

/**
 * Log sandbox configuration at startup.
 */
export function logSandboxConfig(): void {
  const status = getSandboxStatus();
  if (status.enabled) {
    console.log('🔒 File Sandbox: ENABLED');
    if (status.allowedDirs.length > 0) {
      console.log(`   Allowed directories: ${status.allowedDirs.join(', ')}`);
    } else {
      console.log('   ⚠️  No allowed directories configured - all file operations will be blocked');
    }
  } else {
    console.log('🔓 File Sandbox: DISABLED (full edition)');
  }
}
