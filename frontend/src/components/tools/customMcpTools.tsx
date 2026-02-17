import React from 'react';
import { BaseToolExecution } from './sdk-types';
import { A2ACallTool } from './A2ACallTool';
import { A2UIRenderTool } from './A2UIRenderTool';

/**
 * Interface for custom MCP tool components
 */
type CustomMcpToolComponent = React.FC<{ execution: BaseToolExecution }>;

/**
 * Registry of custom MCP tools
 * Key format: serverName__toolName
 */
export const CUSTOM_MCP_TOOLS: Record<string, CustomMcpToolComponent> = {
    // Map 'call_external_agent' from 'a2a-client' server to A2ACallTool
    'a2a-client__call_external_agent': A2ACallTool,
    // Map 'render_ui' from 'a2ui-renderer' server to A2UIRenderTool
    'a2ui-renderer__render_ui': A2UIRenderTool,
};
