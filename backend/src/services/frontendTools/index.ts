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
  getMcpToolName,
  resolveServerName,
  registerServerName,
  isFrontendTool,
  type SessionRef,
} from './frontendToolMcp.js';

// Integration helper
export { integrateFrontendTools } from './integration.js';

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

// Dynamic tool registry
export { registerDynamicTools, getDynamicTools, clearDynamicTools } from './dynamicToolRegistry.js';
