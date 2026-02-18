/**
 * Product Gate Middleware
 *
 * Centralized Express middleware that enforces feature module access control
 * based on the current product edition. Replaces scattered inline checks
 * with a unified gateway.
 *
 * Behavior:
 * - 'full' edition: all requests pass through (no overhead)
 * - Other editions: resolves the request path to a feature module and checks access
 * - Infrastructure routes (auth, engine, health) always pass through
 * - Unknown routes pass through (fail-open for safety)
 * - Readonly modules only allow GET/HEAD/OPTIONS methods
 */

import type { Request, Response, NextFunction } from 'express';
import {
  getProductEdition,
  getModuleAccess,
  resolveModule,
} from '../config/productConfig.js';

const READONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global product gate middleware.
 * Apply once in the middleware chain, before route handlers.
 */
export function productGateMiddleware(req: Request, res: Response, next: NextFunction): void {
  const edition = getProductEdition();

  if (edition === 'full') {
    next();
    return;
  }

  const moduleId = resolveModule(req.path);

  // Infrastructure routes (no module mapping) always pass through
  if (!moduleId) {
    next();
    return;
  }

  const access = getModuleAccess(moduleId);

  if (access === 'full') {
    next();
    return;
  }

  if (access === 'readonly') {
    if (READONLY_METHODS.has(req.method)) {
      next();
      return;
    }
    res.status(403).json({
      error: 'Readonly access',
      message: `Module "${moduleId}" is read-only in the current product edition. Only GET requests are allowed.`,
      module: moduleId,
      edition,
    });
    return;
  }

  // access === 'disabled'
  res.status(403).json({
    error: 'Feature not available',
    message: `Module "${moduleId}" is not available in the current product edition (${edition}).`,
    module: moduleId,
    edition,
  });
}

/**
 * Create a product gate middleware for a specific module.
 * Use this to gate individual route registrations when fine-grained
 * control is needed beyond path-based resolution.
 */
export function moduleGate(moduleId: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const edition = getProductEdition();

    if (edition === 'full') {
      next();
      return;
    }

    const access = getModuleAccess(moduleId);

    if (access === 'full') {
      next();
      return;
    }

    if (access === 'readonly') {
      if (READONLY_METHODS.has(req.method)) {
        next();
        return;
      }
      res.status(403).json({
        error: 'Readonly access',
        message: `Module "${moduleId}" is read-only in the current product edition.`,
        module: moduleId,
        edition,
      });
      return;
    }

    res.status(403).json({
      error: 'Feature not available',
      message: `Module "${moduleId}" is not available in the current product edition (${edition}).`,
      module: moduleId,
      edition,
    });
  };
}
