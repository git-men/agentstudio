/**
 * LAVS Permission Checker
 *
 * Enforces permission constraints declared in LAVS manifests.
 * Checks file access patterns, path traversal, and execution limits.
 */

import path from 'path';
import { minimatch } from 'minimatch';
import {
  Permissions,
  ScriptHandler,
  LAVSError,
  LAVSErrorCode,
} from './types.js';

/**
 * LAVS Permission Checker - enforces manifest-declared security constraints
 */
export class PermissionChecker {
  /**
   * Merge manifest-level and endpoint-level permissions.
   * Endpoint-level permissions take precedence over manifest-level.
   *
   * @param manifestPermissions - Manifest-level permissions (defaults)
   * @param endpointPermissions - Endpoint-level permissions (overrides)
   * @returns Merged permissions object
   */
  mergePermissions(
    manifestPermissions?: Permissions,
    endpointPermissions?: Permissions
  ): Permissions {
    if (!manifestPermissions && !endpointPermissions) {
      return {};
    }
    if (!manifestPermissions) {
      return { ...endpointPermissions };
    }
    if (!endpointPermissions) {
      return { ...manifestPermissions };
    }

    return {
      fileAccess: endpointPermissions.fileAccess ?? manifestPermissions.fileAccess,
      networkAccess: endpointPermissions.networkAccess ?? manifestPermissions.networkAccess,
      maxExecutionTime: endpointPermissions.maxExecutionTime ?? manifestPermissions.maxExecutionTime,
      maxMemory: endpointPermissions.maxMemory ?? manifestPermissions.maxMemory,
    };
  }

  /**
   * Check if a target path is within the allowed base directory.
   * Prevents path traversal attacks (e.g., ../../etc/passwd).
   *
   * @param targetPath - The path to check (absolute or relative)
   * @param allowedBase - The allowed base directory (absolute)
   * @throws LAVSError with code PermissionDenied if path is outside allowed base
   */
  checkPathTraversal(targetPath: string, allowedBase: string): void {
    const resolvedTarget = path.resolve(allowedBase, targetPath);
    const normalizedBase = path.resolve(allowedBase);

    // Ensure resolved target is within or equal to the allowed base
    if (!resolvedTarget.startsWith(normalizedBase + path.sep) && resolvedTarget !== normalizedBase) {
      throw new LAVSError(
        LAVSErrorCode.PermissionDenied,
        `Path traversal detected: '${targetPath}' resolves outside allowed directory '${allowedBase}'`,
        { resolvedPath: resolvedTarget, allowedBase: normalizedBase }
      );
    }
  }

  /**
   * Check if a handler's working directory is within the allowed base.
   *
   * @param handler - Script handler with optional cwd
   * @param agentDir - Agent directory (the allowed base)
   * @throws LAVSError with code PermissionDenied if cwd is outside agent directory
   */
  checkHandlerCwd(handler: ScriptHandler, agentDir: string): void {
    if (!handler.cwd) {
      return; // No custom cwd, will use agentDir as default
    }

    this.checkPathTraversal(handler.cwd, agentDir);
  }

  /**
   * Check if file access patterns allow a given path.
   * Uses glob matching against permissions.fileAccess patterns.
   *
   * @param filePath - The file path to check (relative to agent dir)
   * @param permissions - Permission constraints including fileAccess patterns
   * @returns true if access is allowed, false otherwise
   */
  checkFileAccess(filePath: string, permissions: Permissions): boolean {
    // No fileAccess restrictions - allow all
    if (!permissions.fileAccess || permissions.fileAccess.length === 0) {
      return true;
    }

    // Normalize the file path
    const normalizedPath = filePath.startsWith('./') ? filePath : `./${filePath}`;

    // First check deny patterns (negative patterns take precedence)
    for (const pattern of permissions.fileAccess) {
      if (pattern.startsWith('!')) {
        if (minimatch(normalizedPath, pattern.slice(1))) {
          return false; // Explicitly denied
        }
      }
    }

    // Then check allow patterns
    for (const pattern of permissions.fileAccess) {
      if (!pattern.startsWith('!')) {
        if (minimatch(normalizedPath, pattern)) {
          return true; // Allowed
        }
      }
    }

    // No positive pattern matched - deny by default
    return false;
  }

  /**
   * Get the effective execution timeout for a handler.
   * Priority: handler.timeout > permissions.maxExecutionTime > default (30000ms)
   *
   * @param handler - Script handler with optional timeout
   * @param permissions - Permission constraints with optional maxExecutionTime
   * @param defaultTimeout - Default timeout in milliseconds (default: 30000)
   * @returns Effective timeout in milliseconds
   */
  getEffectiveTimeout(
    handler: ScriptHandler,
    permissions: Permissions,
    defaultTimeout: number = 30000
  ): number {
    // Handler-level timeout takes precedence
    if (handler.timeout != null && handler.timeout > 0) {
      // But cannot exceed permission-level max
      if (permissions.maxExecutionTime != null && permissions.maxExecutionTime > 0) {
        return Math.min(handler.timeout, permissions.maxExecutionTime);
      }
      return handler.timeout;
    }

    // Permission-level timeout
    if (permissions.maxExecutionTime != null && permissions.maxExecutionTime > 0) {
      return permissions.maxExecutionTime;
    }

    return defaultTimeout;
  }

  /**
   * Run all permission checks for a script handler execution.
   * This is a convenience method that combines multiple checks.
   *
   * @param handler - Script handler configuration
   * @param permissions - Merged permissions
   * @param agentDir - Agent base directory
   * @throws LAVSError if any permission check fails
   */
  assertAllowed(
    handler: ScriptHandler,
    permissions: Permissions,
    agentDir: string
  ): void {
    // 1. Check handler cwd for path traversal
    this.checkHandlerCwd(handler, agentDir);

    // 2. Check script command path if it looks like a file path
    if (handler.command && (handler.command.includes('/') || handler.command.includes('\\'))) {
      // Only check relative paths (absolute paths are resolved by loader)
      if (!path.isAbsolute(handler.command)) {
        this.checkPathTraversal(handler.command, agentDir);
      }
    }
  }
}
