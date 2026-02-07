import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { join } from 'path';
import { readFileSync } from 'fs';

import filesRouter from './routes/files';
import agentsRouter from './routes/agents';
import mcpRouter from './routes/mcp';
import sessionsRouter from './routes/sessions';
import mediaRouter from './routes/media';
import mediaAuthRouter from './routes/mediaAuth';
import settingsRouter from './routes/settings';
import commandsRouter from './routes/commands';
import subagentsRouter from './routes/subagents';
import projectsRouter from './routes/projects';
import authRouter from './routes/auth';
import configRouter from './routes/config';
import slackRouter from './routes/slack';
import skillsRouter from './routes/skills';
import pluginsRouter from './routes/plugins';
import a2aRouter from './routes/a2a';
import a2aManagementRouter from './routes/a2aManagement';
import scheduledTasksRouter from './routes/scheduledTasks';
import mcpAdminRouter from './routes/mcpAdmin';
import mcpAdminManagementRouter from './routes/mcpAdminManagement';
import cloudflareTunnelRouter from './routes/cloudflareTunnel';
import taskExecutorRouter from './routes/taskExecutor';
import versionRouter from './routes/version';
import tunnelRouter from './routes/tunnel';
import networkRouter from './routes/network';
import aguiRouter from './routes/agui';
import speechToTextRouter from './routes/speechToText';
import engineRouter from './routes/engine';
import rulesRouter from './routes/rules';
import hooksRouter from './routes/hooks';
import { authMiddleware } from './middleware/auth';
import { httpsOnly } from './middleware/httpsOnly';
import { loadConfig, getSlidesDir } from './config/index';
import { cleanupOrphanedTasks } from './services/a2a/taskCleanup';
import { initializeScheduler, shutdownScheduler } from './services/schedulerService';
import { shutdownTelemetry } from './services/telemetry';
import { initializeTaskExecutor, shutdownTaskExecutor } from './services/taskExecutor/index.js';
import { tunnelService } from './services/tunnelService.js';
import { logSdkConfig } from './config/sdkConfig.js';
import { initializeEngine, logEngineConfig } from './config/engineConfig.js';
import { initializeMarketplaceUpdateService, shutdownMarketplaceUpdateService } from './services/marketplaceUpdateService.js';
import { getEngineStatus } from './engines/index.js';

dotenv.config();

// ============================================================================
// Global Error Handlers - Prevent process crashes
// ============================================================================

// EPIPE Guard: Prevent infinite loop when stdout/stderr pipes are broken.
// When the launching terminal is closed, stdout/stderr become broken pipes.
// Any console.log/error call will then throw EPIPE, and if an uncaughtException
// handler also uses console.error, it creates an infinite recursion:
//   uncaughtException → console.error() → EPIPE → uncaughtException → ...
// These handlers silently swallow EPIPE errors on stdout/stderr to break the cycle.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  // For non-EPIPE errors, we can't safely write to stdout, so just ignore
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  // For non-EPIPE errors, we can't safely write to stderr, so just ignore
});

// Safe logging helper: writes to stderr only if the stream is still writable.
// Falls back silently if the pipe is broken, preventing EPIPE cascades.
function safeErrorLog(...args: unknown[]): void {
  try {
    if (process.stderr.writable) {
      console.error(...args);
    }
  } catch {
    // If writing fails (e.g., EPIPE), silently ignore to prevent recursion
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error & { code?: string }) => {
  // Silently ignore EPIPE errors to prevent infinite recursion.
  // EPIPE occurs when stdout/stderr pipes are broken (e.g., terminal closed).
  if (error.code === 'EPIPE') {
    return;
  }
  safeErrorLog('[Fatal] Uncaught Exception:', error);
  safeErrorLog('[Fatal] Stack:', error.stack);
  // Don't exit the process - log and continue
  // This prevents the entire server from crashing due to a single unhandled error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  // Silently ignore EPIPE-related rejections
  if (reason && (reason.code === 'EPIPE' || (reason instanceof Error && (reason as any).code === 'EPIPE'))) {
    return;
  }
  safeErrorLog('[Fatal] Unhandled Promise Rejection at:', promise);
  safeErrorLog('[Fatal] Reason:', reason);
  // Don't exit the process - log and continue
  // This is especially important for MCP fetch operations and other async code
});

// Handle uncaught exceptions in async functions
process.on('uncaughtExceptionMonitor', (error: Error & { code?: string }, origin: string) => {
  // Skip EPIPE errors in monitor as well
  if (error.code === 'EPIPE') {
    return;
  }
  safeErrorLog('[Monitor] Uncaught Exception Monitor triggered');
  safeErrorLog('[Monitor] Origin:', origin);
  safeErrorLog('[Monitor] Error:', error);
  safeErrorLog('[Monitor] Stack:', error.stack);
});

// Initialize and log engine configuration at startup
initializeEngine();
logEngineConfig();
logSdkConfig(); // Keep for backward compatibility

// Get version from package.json (works in both dev and npm package mode)
const getVersion = () => {
  // Try npm package mode first (package.json in same directory as dist)
  const npmPackagePath = join(__dirname, 'package.json');
  // Then try development mode (backend/package.json)
  const devPackagePath = join(__dirname, '../package.json');
  // Also try root package.json
  const rootPackagePath = join(__dirname, '../../package.json');

  for (const packagePath of [npmPackagePath, devPackagePath, rootPackagePath]) {
    try {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (packageJson.version) {
        return packageJson.version;
      }
    } catch {
      // Continue to next path
    }
  }

  console.warn('Could not read version from package.json');
  return 'unknown';
};

const VERSION = getVersion();

const app: express.Express = express();

// Async initialization
(async () => {
  // Load configuration (including port and host)
  const config = await loadConfig();
  const PORT = config.port || 4936;
  const HOST = config.host || '0.0.0.0';

  // Initialize system Claude version if needed
  try {
    const { initializeSystemVersion } = await import('./services/claudeVersionStorage.js');
    const { getSystemClaudeExecutablePath } = await import('./utils/claudeUtils.js');
    const { SDK_ENGINE } = await import('./config/sdkConfig.js');

    // Try to find Claude executable based on SDK engine
    let claudePath: string | null = null;
    try {
      claudePath = await getSystemClaudeExecutablePath(SDK_ENGINE);
      if (claudePath) {
        console.log(`[System] Found ${SDK_ENGINE} CLI at: ${claudePath}`);
      }
    } catch (error) {
      console.log(`[System] ${SDK_ENGINE} CLI not found in PATH, initializing without executable path`);
    }

    // Initialize system version (with or without executable path)
    await initializeSystemVersion(claudePath || '');
    console.log(`[System] Initialized Claude version${claudePath ? ` from: ${claudePath}` : ' without executable path'}`);
  } catch (error) {
    console.warn('Failed to initialize system Claude version:', error);
  }

  // Log engine status
  try {
    const engineStatus = getEngineStatus();
    console.log(`[Engines] Registered engines: ${engineStatus.registeredEngines.join(', ')}`);
    console.log(`[Engines] Default engine: ${engineStatus.defaultEngine}`);
  } catch (error) {
    console.warn('[Engines] Failed to get engine status:', error);
  }

  // Middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://app.posthog.com", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"], // Allow eval for development, CDN for Monaco, PostHog
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
        imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:", "blob:", "data:", "http://localhost:*", "http://127.0.0.1:*", "https://localhost:*", "https://127.0.0.1:*", "https://app.posthog.com", "https://us.i.posthog.com", "https://us-assets.i.posthog.com"],
        frameAncestors: ["'self'", "http://localhost:3000", "https://localhost:3000", "http://localhost:3001", "https://agentstudio.cc", "https://*.agentstudio.cc"], // Allow iframe embedding
        workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
        childSrc: ["'self'", "blob:"],
        // Disable upgrade-insecure-requests for HTTP environments
        upgradeInsecureRequests: null
      }
    },
    // Disable problematic headers for non-HTTPS access
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    // Disable HSTS for HTTP environments (prevents forcing HTTPS)
    strictTransportSecurity: false
  }));

  // Configure CORS origins
  const getAllowedOrigins = () => {
    const defaultOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'https://localhost:3000',
      'https://localhost:3001'
    ];

    // Add custom origins from configuration
    const customOrigins = config.corsOrigins ?
      config.corsOrigins.split(',').map(origin => origin.trim()) : [];

    return [...defaultOrigins, ...customOrigins];
  };

  app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = getAllowedOrigins();

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Check if the origin is allowed
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow Vercel preview URLs (*.vercel.app)
      if (origin.endsWith('.vercel.app')) {
        return callback(null, true);
      }

      // Allow agentstudio.cc and its subdomains (*.agentstudio.cc) - hardcoded
      if (origin === 'https://agentstudio.cc' || origin === 'http://agentstudio.cc' ||
        origin.endsWith('.agentstudio.cc')) {
        return callback(null, true);
      }

      // Allow custom domains from configuration (CORS_ALLOWED_DOMAINS)
      const customDomains = config.corsAllowedDomains ?
        config.corsAllowedDomains.split(',').map(domain => domain.trim()) : [];

      for (const domain of customDomains) {
        // Match exact domain (https://example.com)
        if (origin === `https://${domain}` || origin === `http://${domain}`) {
          return callback(null, true);
        }
        // Match subdomains (https://*.example.com)
        if (origin.endsWith(`.${domain}`)) {
          return callback(null, true);
        }
      }

      // Allow any localhost with any port for development
      if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
        return callback(null, true);
      }

      // Allow 127.0.0.1 with any port for development
      if (origin.match(/^https?:\/\/127\.0\.0\.1(:\d+)?$/)) {
        return callback(null, true);
      }

      // For embedded mode: Allow same-origin requests from any host/IP
      // This allows the frontend (served from the same server) to access the API
      // Extract protocol, host, and port from origin
      try {
        const originUrl = new URL(origin);
        const serverHost = `${originUrl.protocol}//${originUrl.host}`;
        
        // Check if origin matches the server's actual address
        // In embedded mode, origin should be the same as the server address
        const serverPort = PORT;
        const possibleServerUrls = [
          `http://${HOST}:${serverPort}`,
          `https://${HOST}:${serverPort}`,
          `http://localhost:${serverPort}`,
          `https://localhost:${serverPort}`,
          `http://127.0.0.1:${serverPort}`,
          `https://127.0.0.1:${serverPort}`,
        ];

        // Also check if origin matches any of the server's network interfaces
        // For 0.0.0.0, allow any IP:port combination that matches the server port
        if (HOST === '0.0.0.0' || HOST === '::') {
          if (originUrl.port === serverPort.toString()) {
            // Same port = likely same-origin request in embedded mode
            return callback(null, true);
          }
        }

        if (possibleServerUrls.includes(serverHost)) {
          return callback(null, true);
        }
      } catch (err) {
        // Invalid URL, continue to error
      }

      const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
      return callback(new Error(msg), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Requested-With', 'X-Project-Path'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
  }));

  // JSON parser - skip /api/slack (needs raw body for signature verification)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/slack')) {
      return next();
    }
    express.json({ limit: '10mb' })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static files - serve slides directory
  const slidesDir = await getSlidesDir();
  app.use('/slides', express.static(slidesDir));

  // ============================================================================
  // Initialize Background Services
  // ============================================================================

  // 1. Initialize Task Executor (handles both A2A async tasks and scheduled tasks)
  console.info('[TaskExecutor] Initializing unified task executor...');
  try {
    await initializeTaskExecutor();
    console.info('[TaskExecutor] Task executor initialized successfully');
  } catch (error) {
    console.error('[TaskExecutor] Failed to initialize task executor:', error);
    console.error('[TaskExecutor] Tasks will not be executed. Please check configuration.');
  }

  // 2. A2A Task Lifecycle: Clean up orphaned tasks on startup
  console.info('[A2A] Running orphaned task cleanup...');
  try {
    const cleanedCount = await cleanupOrphanedTasks();
    if (cleanedCount > 0) {
      console.info(`[A2A] Cleaned up ${cleanedCount} orphaned tasks`);
    } else {
      console.info('[A2A] No orphaned tasks found');
    }
  } catch (error) {
    console.error('[A2A] Error during orphaned task cleanup:', error);
  }

  // Note: Task timeout monitor is no longer needed - handled by executor internally

  // 3. Scheduled Tasks: Initialize scheduler (always initialize, but enable state depends on env var)
  const enableSchedulerInitially = process.env.ENABLE_SCHEDULER !== 'false'; // Default to true
  console.info('[Scheduler] Initializing scheduled tasks... (ENABLE_SCHEDULER=' + process.env.ENABLE_SCHEDULER + ', initial enabled=' + enableSchedulerInitially + ')');
  try {
    initializeScheduler({ enabled: enableSchedulerInitially });
  } catch (error) {
    console.error('[Scheduler] Error initializing scheduler:', error);
  }

  // 4. Tunnel Service: Initialize WebSocket tunnel for external access
  console.info('[Tunnel] Initializing tunnel service...');
  try {
    await tunnelService.initialize(PORT);
    console.info('[Tunnel] Tunnel service initialized');
  } catch (error) {
    console.error('[Tunnel] Error initializing tunnel service:', error);
  }

  // 5. Marketplace Update Service: Initialize background update checker
  const enableMarketplaceUpdates = process.env.ENABLE_MARKETPLACE_UPDATES !== 'false'; // Default to true
  console.info('[MarketplaceUpdate] Initializing marketplace update service...');
  try {
    initializeMarketplaceUpdateService({
      enabled: enableMarketplaceUpdates,
      defaultCheckInterval: parseInt(process.env.MARKETPLACE_UPDATE_INTERVAL || '60', 10), // Default: 60 minutes
      autoApplyUpdates: process.env.MARKETPLACE_AUTO_APPLY_UPDATES === 'true', // Default: false
    });
    console.info('[MarketplaceUpdate] Marketplace update service initialized');
  } catch (error) {
    console.error('[MarketplaceUpdate] Error initializing marketplace update service:', error);
  }

  // Static files - serve embedded frontend (for npm package) or development frontend
  // Check both npm package location (./public) and development location (../../frontend/dist)
  const fs = await import('fs');
  const npmPublicPath = join(__dirname, 'public');
  const devFrontendPath = join(__dirname, '../../frontend/dist');

  // Prefer npm package embedded frontend, fallback to development path
  const frontendDistPath = fs.existsSync(npmPublicPath) ? npmPublicPath : devFrontendPath;
  const hasEmbeddedFrontend = fs.existsSync(join(frontendDistPath, 'index.html'));

  if (hasEmbeddedFrontend && process.env.API_ONLY !== 'true') {
    app.use(express.static(frontendDistPath));

    // For SPA routing - serve index.html for any non-API routes
    app.get('*', (req, res, next) => {
      // Skip API routes and other specific routes
      if (req.path.startsWith('/api') ||
        req.path.startsWith('/media') ||
        req.path.startsWith('/slides') ||
        req.path.startsWith('/a2a')) {
        return next();
      }

      // Serve index.html for all other routes
      res.sendFile(join(frontendDistPath, 'index.html'));
    });

    console.log(`Frontend static files enabled from: ${frontendDistPath}`);
  } else if (process.env.API_ONLY === 'true') {
    console.log('API only mode - frontend serving disabled');
  } else {
    console.log('Frontend build not found, serving API only');
  }

  // Routes - Public routes
  app.use('/api/auth', authRouter);
  // MCP Admin - uses its own API key authentication
  app.use('/api/mcp-admin', mcpAdminRouter);
  // Slack webhook - needs raw body for signature verification
  app.use('/api/slack',
    express.json({
      limit: '10mb',
      verify: (req: any, res, buf) => {
        req.rawBody = buf.toString('utf8');
      }
    }),
    slackRouter
  );

  // A2A Protocol routes - Public but require API key authentication and HTTPS in production
  app.use('/a2a/:a2aAgentId', httpsOnly, a2aRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    try {
      const engineStatus = getEngineStatus();
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: VERSION,
        name: 'agentstudio-backend',
        engine: engineStatus.defaultEngine || 'unknown',
        engines: engineStatus.registeredEngines || [],
      });
    } catch (error) {
      // Fallback if engine status is not available
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: VERSION,
        name: 'agentstudio-backend'
      });
    }
  });

  // A2A Health check (public endpoint, no authentication required)
  app.get('/api/a2a/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      protocol: 'A2A',
      timestamp: new Date().toISOString(),
      features: {
        agentCard: true,
        syncMessages: true,
        asyncTasks: true,
        taskManagement: true,
        apiKeyAuth: true,
      },
    });
  });

  // AGUI Health check (public endpoint for testing)
  app.get('/api/agui/health', (req, res) => {
    try {
      const engineStatus = getEngineStatus();
      res.json({
        status: 'ok',
        protocol: 'AGUI',
        timestamp: new Date().toISOString(),
        engines: engineStatus.registeredEngines,
        defaultEngine: engineStatus.defaultEngine,
        activeSessions: engineStatus.totalActiveSessions,
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: 'Failed to get engine status',
      });
    }
  });

  // Protected routes - Require authentication
  app.use('/api/files', authMiddleware, filesRouter);
  app.use('/api/agents', authMiddleware, agentsRouter);
  app.use('/api/mcp', authMiddleware, mcpRouter);
  app.use('/api/sessions', authMiddleware, sessionsRouter);
  app.use('/api/settings', authMiddleware, settingsRouter);
  app.use('/api/config', authMiddleware, configRouter);
  app.use('/api/commands', authMiddleware, commandsRouter);
  app.use('/api/subagents', authMiddleware, subagentsRouter);
  app.use('/api/projects', authMiddleware, projectsRouter);
  app.use('/api/a2a', authMiddleware, a2aManagementRouter); // A2A management routes with user auth
  app.use('/api/skills', authMiddleware, skillsRouter);
  app.use('/api/plugins', authMiddleware, pluginsRouter);
  app.use('/api/scheduled-tasks', authMiddleware, scheduledTasksRouter);
  app.use('/api/mcp-admin-management', authMiddleware, mcpAdminManagementRouter); // MCP Admin management with JWT auth
  app.use('/api/cloudflare-tunnel', authMiddleware, cloudflareTunnelRouter); // Cloudflare Tunnel management
  app.use('/api/task-executor', authMiddleware, taskExecutorRouter);
  app.use('/api/version', authMiddleware, versionRouter);
  app.use('/api/tunnel', authMiddleware, tunnelRouter); // Tunnel management
  app.use('/api/network-info', authMiddleware, networkRouter); // Network information
  app.use('/api/agui', authMiddleware, aguiRouter); // AGUI unified engine routes
  app.use('/api/speech-to-text', authMiddleware, speechToTextRouter); // Speech-to-text service
  app.use('/api/engine', engineRouter); // Engine configuration (public, no auth required)
  app.use('/api/rules', authMiddleware, rulesRouter); // Rules management (both Claude and Cursor)
  app.use('/api/hooks', authMiddleware, hooksRouter); // Hooks management (Claude only)
  app.use('/api/media', mediaAuthRouter); // Media auth endpoints
  app.use('/media', mediaRouter); // Remove authMiddleware - media files are now public

  // Error handling
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  // Graceful shutdown handler
  const gracefulShutdown = async () => {
    console.info('[System] Shutting down gracefully...');

    // 1. Stop scheduler (no new tasks will be scheduled)
    try {
      shutdownScheduler();
      console.info('[Scheduler] Scheduler stopped');
    } catch (error) {
      console.error('[Scheduler] Error shutting down scheduler:', error);
    }

    // 2. Stop marketplace update service
    try {
      shutdownMarketplaceUpdateService();
      console.info('[MarketplaceUpdate] Marketplace update service stopped');
    } catch (error) {
      console.error('[MarketplaceUpdate] Error shutting down marketplace update service:', error);
    }

    // 2. Stop task executor (wait for running tasks to complete or timeout)
    try {
      await shutdownTaskExecutor();
      console.info('[TaskExecutor] Task executor stopped');
    } catch (error) {
      console.error('[TaskExecutor] Error shutting down task executor:', error);
    }

    // 3. Stop tunnel service
    try {
      tunnelService.disconnect();
      console.info('[Tunnel] Tunnel service stopped');
    } catch (error) {
      console.error('[Tunnel] Error shutting down tunnel service:', error);
    }

    // Shutdown telemetry (async but we don't wait)
    shutdownTelemetry().catch((error) => {
      console.error('[Telemetry] Error shutting down telemetry:', error);
    });

    console.info('[System] Shutdown complete');
    // Exit process
    process.exit(0);
  };

  // Register shutdown handlers
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Check if this file is being run directly (CommonJS way)
  if (require.main === module) {
    app.listen(PORT, HOST, () => {
      console.log(`AI PPT Editor backend running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      console.log(`Serving slides from: ${slidesDir}`);
    });
  }
})();

export default app;
