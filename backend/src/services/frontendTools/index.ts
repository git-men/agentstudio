/**
 * Frontend Tools Module — Public API
 */

// Core
export { frontendToolBridge } from './frontendToolBridge.js';

// Notification channels
export { notificationChannelManager } from './notificationChannelManager.js';
export { SSENotificationChannel, generateSSEChannelId } from './sseChannel.js';
export { SlackNotificationChannel, generateSlackChannelId } from './slackChannel.js';

// MCP integration
export {
  createFrontendToolMcpServer,
  createUnifiedFrontendToolServer,
  getMcpToolName,
  resolveServerName,
  registerServerName,
  isFrontendTool,
  UNIFIED_SERVER_NAME,
  type SessionRef,
} from './frontendToolMcp.js';

// Integration helper
export { integrateFrontendTools } from './integration.js';

// Providers
export {
  getFrontendToolProvider,
  InProcessProvider,
  HttpMcpProvider,
  type IFrontendToolProvider,
  type ProviderType,
  type ProviderContext,
  type FrontendToolProviderResult,
} from './frontendToolProviders.js';

// HTTP MCP server
export { httpMcpToolRegistry, createHttpMcpRouter } from './httpMcpServer.js';

// MCP config management
export { writeMcpConfig } from './mcpConfigManager.js';

// Built-in tools
export { ASK_USER_QUESTION_TOOL, BUILTIN_FRONTEND_TOOLS } from './builtinTools.js';

// Types
export type {
  FrontendToolDefinition,
  FrontendToolRequest,
  FrontendToolResult,
  NotificationChannel,
  ChannelType,
} from './types.js';

// Initialization
export { initFrontendToolsModule, isFrontendToolsModuleInitialized } from './init.js';
