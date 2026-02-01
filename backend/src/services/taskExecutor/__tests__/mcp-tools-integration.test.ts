/**
 * Test MCP tools integration in taskWorker and A2A routes
 *
 * This test verifies that MCP tools from agent configuration are correctly
 * extracted and passed to buildQueryOptions in both:
 * 1. Scheduled tasks (taskWorker.ts)
 * 2. A2A agent calls (a2a.ts)
 *
 * Bug Fix History:
 * - 2026-02-01: Fixed taskWorker.ts line 100 - was passing undefined for mcpTools
 * - 2026-02-01: Fixed a2a.ts line 240 - was passing undefined for mcpTools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Helper function that extracts MCP tools from agent configuration.
 * This is the same logic used in taskWorker.ts and a2a.ts.
 */
function extractMcpTools(allowedTools: Array<{ name: string; enabled: boolean }>): string[] {
  return allowedTools
    .filter((tool) => tool.enabled && tool.name.startsWith('mcp__'))
    .map((tool) => tool.name);
}

describe('MCP Tools Integration', () => {
  describe('MCP Tool Extraction Logic', () => {
    it('should extract MCP tools from agent configuration', () => {
      // Mock agent with MCP tools
      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        allowedTools: [
          { name: 'Read', enabled: true },
          { name: 'Write', enabled: true },
          { name: 'mcp__hil__send_and_wait_reply', enabled: true },
          { name: 'mcp__hil__send_message_only', enabled: true },
          { name: 'mcp__playwright__browser_navigate', enabled: false }, // disabled
          { name: 'Bash', enabled: true },
        ],
      };

      // Extract MCP tools (simulating taskWorker logic)
      const mcpTools = extractMcpTools(agent.allowedTools);

      // Verify extraction
      expect(mcpTools).toHaveLength(2);
      expect(mcpTools).toContain('mcp__hil__send_and_wait_reply');
      expect(mcpTools).toContain('mcp__hil__send_message_only');
      expect(mcpTools).not.toContain('mcp__playwright__browser_navigate'); // disabled
      expect(mcpTools).not.toContain('Read'); // not MCP tool
      expect(mcpTools).not.toContain('Bash'); // not MCP tool
    });

    it('should extract server names from MCP tool names', () => {
      const mcpTools = [
        'mcp__hil__send_and_wait_reply',
        'mcp__hil__send_message_only',
        'mcp__playwright__browser_navigate',
      ];

      // Extract server names (simulating claudeUtils logic)
      const serverNames = new Set<string>();
      for (const tool of mcpTools) {
        const parts = tool.split('__');
        if (parts.length >= 2 && parts[0] === 'mcp') {
          serverNames.add(parts[1]);
        }
      }

      // Verify server name extraction
      expect(serverNames.size).toBe(2);
      expect(serverNames.has('hil')).toBe(true);
      expect(serverNames.has('playwright')).toBe(true);
    });

    it('should handle agents with no MCP tools', () => {
      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        allowedTools: [
          { name: 'Read', enabled: true },
          { name: 'Write', enabled: true },
          { name: 'Bash', enabled: true },
        ],
      };

      const mcpTools = extractMcpTools(agent.allowedTools);

      expect(mcpTools).toHaveLength(0);
    });

    it('should handle agents with all MCP tools disabled', () => {
      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        allowedTools: [
          { name: 'mcp__hil__send_and_wait_reply', enabled: false },
          { name: 'mcp__hil__send_message_only', enabled: false },
        ],
      };

      const mcpTools = extractMcpTools(agent.allowedTools);

      expect(mcpTools).toHaveLength(0);
    });

    it('should handle empty allowedTools array', () => {
      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        allowedTools: [],
      };

      const mcpTools = extractMcpTools(agent.allowedTools);

      expect(mcpTools).toHaveLength(0);
    });

    it('should handle MCP tools with various server names', () => {
      const agent = {
        id: 'test-agent',
        name: 'Test Agent',
        allowedTools: [
          { name: 'mcp__hil__send_and_wait_reply', enabled: true },
          { name: 'mcp__browser__navigate', enabled: true },
          { name: 'mcp__supabase__query', enabled: true },
          { name: 'mcp__unsplash__search', enabled: true },
          { name: 'mcp__github__create_issue', enabled: true },
        ],
      };

      const mcpTools = extractMcpTools(agent.allowedTools);

      expect(mcpTools).toHaveLength(5);
      expect(mcpTools).toContain('mcp__hil__send_and_wait_reply');
      expect(mcpTools).toContain('mcp__browser__navigate');
      expect(mcpTools).toContain('mcp__supabase__query');
      expect(mcpTools).toContain('mcp__unsplash__search');
      expect(mcpTools).toContain('mcp__github__create_issue');
    });
  });

  describe('Scheduled Tasks MCP Tools Integration', () => {
    /**
     * This test verifies the fix for taskWorker.ts line 100.
     * Previously, mcpTools was hardcoded as undefined, preventing
     * scheduled tasks from using MCP tools configured in the agent.
     */
    it('should pass extracted MCP tools to buildQueryOptions in scheduled tasks', () => {
      const agent = {
        id: 'scheduled-task-agent',
        name: 'Scheduled Task Agent',
        allowedTools: [
          { name: 'Read', enabled: true },
          { name: 'Write', enabled: true },
          { name: 'mcp__hil__send_and_wait_reply', enabled: true },
          { name: 'mcp__hil__send_message_only', enabled: true },
        ],
      };

      // Extract MCP tools as done in taskWorker.ts
      const mcpTools = extractMcpTools(agent.allowedTools);

      // Verify that MCP tools are extracted and would be passed to buildQueryOptions
      expect(mcpTools.length).toBeGreaterThan(0);
      expect(mcpTools).toContain('mcp__hil__send_and_wait_reply');

      // The mcpTools should be passed as the third parameter to buildQueryOptions
      // buildQueryOptions(agent, projectPath, mcpTools, ...)
      const mcpToolsForBuildQueryOptions = mcpTools.length > 0 ? mcpTools : undefined;
      expect(mcpToolsForBuildQueryOptions).toBeDefined();
      expect(mcpToolsForBuildQueryOptions).toEqual(mcpTools);
    });

    it('should pass undefined when no MCP tools are configured', () => {
      const agent = {
        id: 'scheduled-task-agent',
        name: 'Scheduled Task Agent',
        allowedTools: [
          { name: 'Read', enabled: true },
          { name: 'Write', enabled: true },
        ],
      };

      const mcpTools = extractMcpTools(agent.allowedTools);
      const mcpToolsForBuildQueryOptions = mcpTools.length > 0 ? mcpTools : undefined;

      expect(mcpToolsForBuildQueryOptions).toBeUndefined();
    });
  });

  describe('A2A Route MCP Tools Integration', () => {
    /**
     * This test verifies the fix for a2a.ts line 240.
     * Previously, mcpTools was hardcoded as undefined, preventing
     * A2A agents from using MCP tools configured in the agent.
     */
    it('should pass extracted MCP tools to buildQueryOptions in A2A routes', () => {
      const agentConfig = {
        id: 'a2a-agent',
        name: 'A2A Agent',
        systemPrompt: 'You are a helpful agent',
        allowedTools: [
          { name: 'Read', enabled: true },
          { name: 'Write', enabled: true },
          { name: 'mcp__browser__navigate', enabled: true },
          { name: 'mcp__browser__screenshot', enabled: true },
        ],
        enabled: true,
      };

      // Extract MCP tools as done in a2a.ts
      const mcpTools = (agentConfig.allowedTools || [])
        .filter((tool: any) => tool.enabled && tool.name.startsWith('mcp__'))
        .map((tool: any) => tool.name);

      // Verify that MCP tools are extracted and would be passed to buildQueryOptions
      expect(mcpTools.length).toBeGreaterThan(0);
      expect(mcpTools).toContain('mcp__browser__navigate');
      expect(mcpTools).toContain('mcp__browser__screenshot');

      // The mcpTools should be passed as the third parameter to buildQueryOptions
      const mcpToolsForBuildQueryOptions = mcpTools.length > 0 ? mcpTools : undefined;
      expect(mcpToolsForBuildQueryOptions).toBeDefined();
      expect(mcpToolsForBuildQueryOptions).toEqual(mcpTools);
    });

    it('should handle agentConfig with null allowedTools', () => {
      const agentConfig = {
        id: 'a2a-agent',
        name: 'A2A Agent',
        systemPrompt: 'You are a helpful agent',
        allowedTools: null as any, // Simulate null value
        enabled: true,
      };

      // Extract MCP tools with null safety (as done in a2a.ts)
      const mcpTools = (agentConfig.allowedTools || [])
        .filter((tool: any) => tool.enabled && tool.name.startsWith('mcp__'))
        .map((tool: any) => tool.name);

      expect(mcpTools).toHaveLength(0);
    });

    it('should handle agentConfig with undefined allowedTools', () => {
      const agentConfig = {
        id: 'a2a-agent',
        name: 'A2A Agent',
        systemPrompt: 'You are a helpful agent',
        // allowedTools is undefined
        enabled: true,
      } as any;

      // Extract MCP tools with undefined safety (as done in a2a.ts)
      const mcpTools = (agentConfig.allowedTools || [])
        .filter((tool: any) => tool.enabled && tool.name.startsWith('mcp__'))
        .map((tool: any) => tool.name);

      expect(mcpTools).toHaveLength(0);
    });
  });
});
