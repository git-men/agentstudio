/**
 * LAVS (Local Agent View Service) Routes
 *
 * Handles HTTP requests for LAVS endpoints.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { ManifestLoader } from '../lavs/loader.js';
import { ScriptExecutor } from '../lavs/script-executor.js';
import { FunctionExecutor } from '../lavs/function-executor.js';
import { LAVSValidator } from '../lavs/validator.js';
import { PermissionChecker } from '../lavs/permission-checker.js';
import { LAVSRateLimiter } from '../lavs/rate-limiter.js';
import { subscriptionManager } from '../lavs/subscription-manager.js';
import {
  LAVSManifest,
  LAVSError,
  LAVSErrorCode,
  ExecutionContext,
  ScriptHandler,
  FunctionHandler,
} from '../lavs/types.js';
import { AGENTS_DIR } from '../config/paths.js';

const router: express.Router = express.Router();

// Shared instances
const validator = new LAVSValidator();
const permissionChecker = new PermissionChecker();
const rateLimiter = new LAVSRateLimiter({ maxRequests: 60, windowMs: 60000 });

// Periodic cleanup of expired rate limit windows (every 5 minutes)
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

// Cache loaded manifests to avoid re-parsing on every request
const manifestCache = new Map<string, LAVSManifest>();

/**
 * Validate agentId to prevent path traversal and injection attacks.
 * Only allows alphanumeric characters, hyphens, underscores, and dots (not leading).
 */
const SAFE_AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function assertSafeAgentId(agentId: string): void {
  if (!agentId || !SAFE_AGENT_ID.test(agentId) || agentId.includes('..')) {
    throw new LAVSError(
      LAVSErrorCode.InvalidRequest,
      `Invalid agent ID: '${agentId}'. Only alphanumeric, hyphen, underscore, and dot characters are allowed.`
    );
  }
}

/**
 * Get agent directory path
 * Agents can be in either global agents directory or project agents directory
 */
function getAgentDirectory(agentId: string): string {
  assertSafeAgentId(agentId);

  // Check project agents directory (one level up from backend if cwd is backend/)
  const cwd = process.cwd();
  let projectAgentDir = path.join(cwd, 'agents', agentId);

  // If cwd ends with 'backend', check parent directory
  if (cwd.endsWith('backend')) {
    projectAgentDir = path.join(cwd, '..', 'agents', agentId);
  }

  if (fs.existsSync(projectAgentDir)) {
    return path.resolve(projectAgentDir);
  }

  // Check global agents directory
  const globalAgentDir = path.join(AGENTS_DIR, agentId);
  if (fs.existsSync(globalAgentDir)) {
    return globalAgentDir;
  }

  // Default to project directory even if it doesn't exist yet
  return path.resolve(projectAgentDir);
}

/**
 * Load LAVS manifest for an agent
 * Uses cache to avoid repeated file reads
 */
async function loadAgentManifest(agentId: string): Promise<LAVSManifest | null> {
  try {
    // Check cache
    if (manifestCache.has(agentId)) {
      return manifestCache.get(agentId)!;
    }

    // Load from file
    const agentDir = getAgentDirectory(agentId);
    const lavsPath = path.join(agentDir, 'lavs.json');

    const loader = new ManifestLoader();
    const manifest = await loader.load(lavsPath);

    // Cache it
    manifestCache.set(agentId, manifest);

    return manifest;
  } catch (error: unknown) {
    // If file doesn't exist, that's OK - agent just doesn't use LAVS
    if (
      error instanceof LAVSError &&
      error.code === LAVSErrorCode.InvalidRequest &&
      error.message.includes('not found')
    ) {
      return null;
    }

    // Other errors should be logged
    console.error(`[LAVS] Failed to load manifest for agent ${agentId}:`, error);
    throw error;
  }
}

/**
 * Clear manifest cache for an agent.
 * Also clears the validator's compiled schema cache to prevent stale validation.
 * Call this when agent configuration changes.
 */
export function clearManifestCache(agentId?: string) {
  if (agentId) {
    manifestCache.delete(agentId);
  } else {
    manifestCache.clear();
  }
  // Clear validator schema cache to prevent stale validations
  validator.clearCache();
}

/**
 * GET /api/agents/:agentId/lavs/manifest
 * Get LAVS manifest for an agent
 */
router.get('/:agentId/lavs/manifest', async (req, res) => {
  try {
    const { agentId } = req.params;

    const manifest = await loadAgentManifest(agentId);

    if (!manifest) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Agent does not have LAVS configuration' },
      });
    }

    res.json({ jsonrpc: '2.0', result: manifest });
  } catch (error: unknown) {
    console.error('[LAVS] Error getting manifest:', error);

    if (error instanceof LAVSError) {
      res.status(mapErrorCodeToHTTP(error.code)).json({
        jsonrpc: '2.0',
        error: { code: error.code, message: error.message, data: error.data },
      });
    } else {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: LAVSErrorCode.InternalError, message },
      });
    }
  }
});

/**
 * POST /api/agents/:agentId/lavs/:endpoint
 * Call a LAVS endpoint
 *
 * Request body: input data for the endpoint
 * Response: endpoint result
 */
router.post('/:agentId/lavs/:endpoint', async (req, res) => {
  const requestStart = Date.now();
  const { agentId, endpoint: endpointId } = req.params;

  try {
    const input = req.body;

    // Get projectPath from headers (for data isolation)
    const projectPath = req.headers['x-project-path'] as string | undefined;
    console.log(JSON.stringify({
      level: 'info',
      module: 'lavs',
      event: 'request_start',
      agentId,
      endpointId,
      projectPath: projectPath || null,
      method: 'POST',
      timestamp: new Date().toISOString(),
    }));

    // 1. Load manifest
    const manifest = await loadAgentManifest(agentId);
    if (!manifest) {
      return res.status(404).json({
        error: 'Agent does not have LAVS configuration',
      });
    }

    // 2. Rate limit check
    const rateLimitKey = `${agentId}:${endpointId}`;
    const rateLimitResult = rateLimiter.check(rateLimitKey);
    if (!rateLimitResult.allowed) {
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(rateLimitResult.resetAt / 1000)));
      return res.status(429).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: `Rate limit exceeded for endpoint '${endpointId}'. Try again later.`,
          data: { retryAfter: Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000) },
        },
      });
    }
    res.setHeader('X-RateLimit-Remaining', String(rateLimitResult.remaining));

    // 3. Find endpoint
    const endpoint = manifest.endpoints.find((e) => e.id === endpointId);
    if (!endpoint) {
      return res.status(404).json({
        error: `Endpoint not found: ${endpointId}`,
      });
    }

    // 3. Check method (only query and mutation for now, subscription needs WebSocket)
    if (endpoint.method === 'subscription') {
      return res.status(400).json({
        error: 'Subscription endpoints require WebSocket connection',
      });
    }

    // 4. Validate input against schema
    validator.assertValidInput(endpoint, input);

    // 5. Build execution context with merged permissions
    const agentDir = getAgentDirectory(agentId);
    const mergedPermissions = permissionChecker.mergePermissions(
      manifest.permissions,
      endpoint.permissions
    );

    const context: ExecutionContext = {
      endpointId: endpoint.id,
      agentId,
      workdir: agentDir,
      permissions: mergedPermissions,
      // Pass projectPath as environment variable for data isolation
      env: projectPath ? {
        LAVS_PROJECT_PATH: projectPath,
      } : undefined,
    };

    // 6. Check permissions (path traversal, file access)
    if (endpoint.handler.type === 'script') {
      permissionChecker.assertAllowed(
        endpoint.handler as ScriptHandler,
        mergedPermissions,
        agentDir
      );
    }

    // 7. Execute handler
    let result: unknown;

    switch (endpoint.handler.type) {
      case 'script': {
        const executor = new ScriptExecutor();
        result = await executor.execute(
          endpoint.handler as ScriptHandler,
          input,
          context
        );
        break;
      }

      case 'function': {
        const funcExecutor = new FunctionExecutor();
        result = await funcExecutor.execute(
          endpoint.handler as FunctionHandler,
          input,
          context
        );
        break;
      }

      case 'http':
      case 'mcp':
        return res.status(501).json({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Handler type '${endpoint.handler.type}' not yet implemented`,
          },
        });

      default:
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: LAVSErrorCode.InvalidRequest,
            message: `Unknown handler type: ${(endpoint.handler as any).type}`,
          },
        });
    }

    // 8. Validate output against schema
    validator.assertValidOutput(endpoint, result);

    // 9. Auto-publish mutation results to subscribers
    if (endpoint.method === 'mutation') {
      subscriptionManager.publishToAgent(agentId, {
        type: `${endpointId}:mutated`,
        data: result,
      });
    }

    // 10. Return result (JSON-RPC 2.0 success format)
    const duration = Date.now() - requestStart;
    console.log(JSON.stringify({
      level: 'info',
      module: 'lavs',
      event: 'request_success',
      agentId,
      endpointId,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    }));

    res.json({
      jsonrpc: '2.0',
      result,
    });
  } catch (error: unknown) {
    const duration = Date.now() - requestStart;
    console.error(JSON.stringify({
      level: 'error',
      module: 'lavs',
      event: 'request_error',
      agentId,
      endpointId,
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof LAVSError ? error.code : undefined,
      timestamp: new Date().toISOString(),
    }));

    if (error instanceof LAVSError) {
      // Map LAVS error codes to HTTP status codes
      const statusCode = mapErrorCodeToHTTP(error.code);

      // JSON-RPC 2.0 error format
      res.status(statusCode).json({
        jsonrpc: '2.0',
        error: {
          code: error.code,
          message: error.message,
          data: error.data,
        },
      });
    } else {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: LAVSErrorCode.InternalError,
          message: 'Internal server error',
          data: { detail: error instanceof Error ? error.message : String(error) },
        },
      });
    }
  }
});

/**
 * GET /api/agents/:agentId/lavs/:endpoint/subscribe
 * Subscribe to a LAVS subscription endpoint via SSE
 */
router.get('/:agentId/lavs/:endpoint/subscribe', async (req, res) => {
  try {
    const { agentId, endpoint: endpointId } = req.params;

    // 1. Load manifest
    const manifest = await loadAgentManifest(agentId);
    if (!manifest) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Agent does not have LAVS configuration' },
      });
    }

    // 2. Find endpoint
    const endpoint = manifest.endpoints.find((e) => e.id === endpointId);
    if (!endpoint) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Endpoint not found: ${endpointId}` },
      });
    }

    // 3. Verify it's a subscription endpoint
    if (endpoint.method !== 'subscription') {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: `Endpoint '${endpointId}' is not a subscription endpoint` },
      });
    }

    // 4. Create SSE subscription
    subscriptionManager.subscribe(agentId, endpointId, res);
  } catch (error: unknown) {
    console.error('[LAVS] Error creating subscription:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Failed to create subscription' },
    });
  }
});

/**
 * POST /api/agents/:agentId/lavs/:endpoint/publish
 * Publish an event to all subscribers of a subscription endpoint.
 * Used by backend services or handler scripts to push data.
 */
router.post('/:agentId/lavs/:endpoint/publish', async (req, res) => {
  try {
    const { agentId, endpoint: endpointId } = req.params;
    const event = req.body;

    if (!event.type) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32602, message: "Missing required field 'type' in event" },
      });
    }

    const count = subscriptionManager.publish(agentId, endpointId, event);

    res.json({
      jsonrpc: '2.0',
      result: { published: true, subscriberCount: count },
    });
  } catch (error: unknown) {
    console.error('[LAVS] Error publishing event:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Failed to publish event' },
    });
  }
});

/**
 * GET /api/agents/:agentId/lavs-subscriptions
 * List active subscriptions for an agent
 */
router.get('/:agentId/lavs-subscriptions', async (req, res) => {
  const { agentId } = req.params;
  const subscriptions = subscriptionManager.getSubscriptionsForAgent(agentId);
  res.json({
    jsonrpc: '2.0',
    result: {
      subscriptions,
      totalActive: subscriptionManager.getActiveCount(),
    },
  });
});

/**
 * GET /api/agents/:agentId/lavs-view
 * Serve the view component HTML for local components
 */
router.get('/:agentId/lavs-view', async (req, res) => {
  try {
    const { agentId } = req.params;
    const projectPath = req.query.projectPath as string || '';

    // Load manifest
    const manifest = await loadAgentManifest(agentId);
    if (!manifest || !manifest.view) {
      return res.status(404).send('No view configured for this agent');
    }

    const { component } = manifest.view;

    // Only serve local components
    if (component.type !== 'local') {
      return res.status(400).send('This endpoint only serves local components');
    }

    // Read the HTML file
    const fsp = await import('fs/promises');
    let htmlContent = await fsp.readFile(component.path, 'utf-8');

    // Inject LAVS context variables into the HTML (properly escaped to prevent XSS)
    const escapeForJS = (str: string) =>
      str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\x3c').replace(/>/g, '\\x3e').replace(/\n/g, '\\n');
    const lavsContextScript = `<script>
      window.LAVS_AGENT_ID = "${escapeForJS(agentId)}";
      window.LAVS_PROJECT_PATH = "${escapeForJS(projectPath)}";
    </script>`;

    // Insert script before closing </head> or at the start of <body>
    if (htmlContent.includes('</head>')) {
      htmlContent = htmlContent.replace('</head>', `${lavsContextScript}</head>`);
    } else if (htmlContent.includes('<body>')) {
      htmlContent = htmlContent.replace('<body>', `<body>${lavsContextScript}`);
    } else {
      // Fallback: prepend to content
      htmlContent = lavsContextScript + htmlContent;
    }

    // Serve as HTML with security headers
    res.setHeader('Content-Type', 'text/html');
    // CSP: restrict scripts to self, allow connecting to LAVS API
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",  // Allow inline scripts for LAVS context injection
      "style-src 'self' 'unsafe-inline'",   // Allow inline styles for view components
      "connect-src 'self'",                  // Only allow connections to same origin (LAVS API)
      "img-src 'self' data: https:",         // Allow images from self, data URIs, and HTTPS
      "frame-ancestors 'self'",              // Only allow embedding by same origin
    ].join('; '));
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Restrict Permissions-Policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.send(htmlContent);
  } catch (error: unknown) {
    console.error('[LAVS] Error serving view:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).send(`Error loading view: ${msg}`);
  }
});

/**
 * POST /api/agents/:agentId/lavs-cache/clear
 * Clear manifest cache for an agent
 * Useful during development when lavs.json changes
 */
router.post('/:agentId/lavs-cache/clear', (req, res) => {
  const { agentId } = req.params;
  clearManifestCache(agentId);

  res.json({ jsonrpc: '2.0', result: { success: true, message: `Cache cleared for agent ${agentId}` } });
});

/**
 * Map LAVS error codes to HTTP status codes
 */
function mapErrorCodeToHTTP(code: number): number {
  switch (code) {
    case LAVSErrorCode.ParseError:
    case LAVSErrorCode.InvalidRequest:
    case LAVSErrorCode.InvalidParams:
      return 400; // Bad Request

    case LAVSErrorCode.MethodNotFound:
      return 404; // Not Found

    case LAVSErrorCode.PermissionDenied:
      return 403; // Forbidden

    case LAVSErrorCode.Timeout:
      return 504; // Gateway Timeout

    case LAVSErrorCode.HandlerError:
    case LAVSErrorCode.InternalError:
    default:
      return 500; // Internal Server Error
  }
}

export default router;
