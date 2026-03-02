import { useState, useEffect, useRef } from 'react';
import { API_BASE } from '../../lib/config';
import { authFetch } from '../../lib/authFetch';
import type { AgentTool } from '../../types/index.js';

export interface UseToolSelectorProps {
  agent: any;
}

export const useToolSelector = ({ agent }: UseToolSelectorProps) => {
  // Tool selector state
  const [showToolSelector, setShowToolSelector] = useState(false);
  const [selectedRegularTools, setSelectedRegularTools] = useState<string[]>([]);
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [mcpToolsEnabled, setMcpToolsEnabled] = useState(false);
  const [permissionMode, setPermissionMode] = useState<'default' | 'acceptEdits' | 'bypassPermissions'>('bypassPermissions');
  const [selectedModel, setSelectedModel] = useState<string>('sonnet');
  const [showPermissionDropdown, setShowPermissionDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [selectedClaudeVersion, setSelectedClaudeVersion] = useState<string | undefined>(undefined);
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);
  const [isVersionLocked, setIsVersionLocked] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const expandedRef = useRef(false);

  // Initialize tool selector with agent's preset tools
  useEffect(() => {
    if (agent?.allowedTools?.length > 0) {
      const enabledTools = agent.allowedTools.filter((tool: AgentTool) => tool.enabled);

      // Separate regular tools and MCP tools
      const regularTools: string[] = [];
      const mcpTools: string[] = [];

      enabledTools.forEach((tool: AgentTool) => {
        if (tool.name.includes('.') && !tool.name.startsWith('mcp__')) {
          // MCP tool format: serverName.toolName -> mcp__serverName__toolName
          const [serverName, toolName] = tool.name.split('.');
          const mcpToolId = `mcp__${serverName}__${toolName}`;
          mcpTools.push(mcpToolId);
        } else if (tool.name.startsWith('mcp__')) {
          // Already formatted MCP tool
          mcpTools.push(tool.name);
        } else {
          // Regular tool
          regularTools.push(tool.name);
        }
      });

      setSelectedRegularTools(regularTools);
      setSelectedMcpTools(mcpTools);
      setMcpToolsEnabled(mcpTools.length > 0);

      // Expand server-level MCP entries eagerly so badge counts are accurate
      const hasServerLevel = mcpTools.some(t => {
        const parts = t.split('__');
        return parts.length === 2 && parts[0] === 'mcp';
      });
      if (hasServerLevel && !expandedRef.current) {
        expandedRef.current = true;
        authFetch(`${API_BASE}/mcp`).then(res => res.json()).then(data => {
          const servers: { name: string; tools?: string[] }[] = data.servers || [];
          let expanded: string[] = [...mcpTools];
          let changed = false;
          for (const entry of mcpTools) {
            const parts = entry.split('__');
            if (parts.length === 2 && parts[0] === 'mcp') {
              const server = servers.find(s => s.name === parts[1]);
              if (server?.tools?.length) {
                expanded = expanded.filter(id => id !== entry);
                for (const toolName of server.tools) {
                  const fullId = `mcp__${parts[1]}__${toolName}`;
                  if (!expanded.includes(fullId)) {
                    expanded.push(fullId);
                  }
                }
                changed = true;
              }
            }
          }
          if (changed) {
            setSelectedMcpTools(expanded);
          }
        }).catch(() => { /* MCP fetch failed, keep server-level entries */ });
      }
    }
  }, [agent?.allowedTools]);

  return {
    // State values
    showToolSelector,
    selectedRegularTools,
    selectedMcpTools,
    mcpToolsEnabled,
    permissionMode,
    selectedModel,
    showPermissionDropdown,
    showModelDropdown,
    selectedClaudeVersion,
    showVersionDropdown,
    isVersionLocked,

    // State setters
    setShowToolSelector,
    setSelectedRegularTools,
    setSelectedMcpTools,
    setMcpToolsEnabled,
    setPermissionMode,
    setSelectedModel,
    setShowPermissionDropdown,
    setShowModelDropdown,
    setSelectedClaudeVersion,
    setShowVersionDropdown,
    setIsVersionLocked,
    envVars,
    setEnvVars,
  };
};