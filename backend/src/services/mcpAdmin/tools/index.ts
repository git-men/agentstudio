/**
 * MCP Admin Tools Index
 *
 * Exports all tool definitions for the MCP Admin Server.
 */

export { projectTools } from './projectTools.js';
export { agentTools } from './agentTools.js';
export { mcpServerTools } from './mcpServerTools.js';
export { systemTools } from './systemTools.js';
export { providerTools } from './providerTools.js';
export { scheduledTaskTools } from './scheduledTaskTools.js';
export { skillTools } from './skillTools.js';
export { ruleTools } from './ruleTools.js';
export { commandTools } from './commandTools.js';
export { hookTools } from './hookTools.js';
export { marketplaceTools } from './marketplaceTools.js';
export { a2aTools } from './a2aTools.js';
export { tunnelTools } from './tunnelTools.js';
export { wecomBotTools } from './wecomBotTools.js';

import { projectTools } from './projectTools.js';
import { agentTools } from './agentTools.js';
import { mcpServerTools } from './mcpServerTools.js';
import { systemTools } from './systemTools.js';
import { providerTools } from './providerTools.js';
import { scheduledTaskTools } from './scheduledTaskTools.js';
import { skillTools } from './skillTools.js';
import { ruleTools } from './ruleTools.js';
import { commandTools } from './commandTools.js';
import { hookTools } from './hookTools.js';
import { marketplaceTools } from './marketplaceTools.js';
import { a2aTools } from './a2aTools.js';
import { tunnelTools } from './tunnelTools.js';
import { wecomBotTools } from './wecomBotTools.js';
import type { ToolDefinition } from '../types.js';

/**
 * All available tools
 */
export const allTools: ToolDefinition[] = [
  ...projectTools,
  ...agentTools,
  ...mcpServerTools,
  ...systemTools,
  ...providerTools,
  ...scheduledTaskTools,
  ...skillTools,
  ...ruleTools,
  ...commandTools,
  ...hookTools,
  ...marketplaceTools,
  ...a2aTools,
  ...tunnelTools,
  ...wecomBotTools,
];
