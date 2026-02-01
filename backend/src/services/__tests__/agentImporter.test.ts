/**
 * Unit tests for agentImporter.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock modules
vi.mock('fs');
vi.mock('../pluginPaths');
vi.mock('../../config/paths.js', () => ({
  AGENTS_DIR: '/test/.claude/agents'
}));

describe('AgentImporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listMarketplaceAgents', () => {
    it('should list agents defined in marketplace manifest', async () => {
      const mockManifest = {
        name: 'test-marketplace',
        version: '1.0.0',
        owner: { name: 'Test' },
        plugins: [],
        agents: [
          {
            name: 'Agent 1',
            source: './agents/agent1.json',
            description: 'First agent'
          },
          {
            name: 'Agent 2',
            source: './agents/agent2.json',
            description: 'Second agent'
          }
        ]
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const agents = await agentImporter.listMarketplaceAgents('test-market');
      
      expect(agents.length).toBe(2);
      expect(agents[0].name).toBe('Agent 1');
      expect(agents[1].name).toBe('Agent 2');
    });

    it('should return empty array if no agents defined', async () => {
      const mockManifest = {
        name: 'test-marketplace',
        version: '1.0.0',
        owner: { name: 'Test' },
        plugins: []
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const agents = await agentImporter.listMarketplaceAgents('test-market');
      
      expect(agents.length).toBe(0);
    });

    it('should return empty array if manifest not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const agents = await agentImporter.listMarketplaceAgents('nonexistent');
      
      expect(agents.length).toBe(0);
    });
  });

  describe('importAgent', () => {
    it('should import an agent from source file', async () => {
      const mockAgentConfig = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        version: '1.0.0',
        systemPrompt: 'You are a test agent',
        permissionMode: 'acceptEdits',
        allowedTools: [],
        ui: {
          icon: '🤖',
          headerTitle: 'Test Agent',
          headerDescription: 'A test agent'
        },
        tags: ['test']
      };

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        // Agent source file exists
        if (pathStr.includes('agents/test-agent.json') && pathStr.includes('marketplaces')) return true;
        // Target agent file doesn't exist yet
        if (pathStr.includes('.claude/agents/test-agent.json')) return false;
        // Marketplace path and directories exist
        return true;
      });
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false
      } as any);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockAgentConfig));
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgent('test-market', {
        name: 'Test Agent',
        source: './agents/test-agent.json',
        description: 'A test agent'
      });
      
      expect(result.success).toBe(true);
      expect(result.agentId).toBe('test-agent');
      expect(result.agentName).toBe('Test Agent');
    });

    it('should import an agent with inline config', async () => {
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        // Target agent file doesn't exist yet
        if (pathStr.includes('.claude/agents/')) return false;
        return true;
      });
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgent('test-market', {
        name: 'Inline Agent',
        description: 'An inline agent',
        source: '', // Empty source indicates inline config
        config: {
          systemPrompt: 'You are an inline agent',
          permissionMode: 'acceptEdits',
          ui: {
            icon: '🎯',
            headerTitle: 'Inline Agent'
          },
          tags: ['inline']
        }
      });
      
      expect(result.success).toBe(true);
      expect(result.agentName).toBe('Inline Agent');
    });

    it('should fail if source file not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgent('test-market', {
        name: 'Missing Agent',
        source: './agents/missing.json'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail if no source or config provided', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgent('test-market', {
        name: 'No Config Agent',
        description: 'Agent without source or config',
        source: '' // Empty source to test the validation
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('source or config');
    });
  });

  describe('importAgentsFromMarketplace', () => {
    it('should import all agents from a marketplace', async () => {
      const mockManifest = {
        name: 'test-marketplace',
        version: '1.0.0',
        owner: { name: 'Test' },
        plugins: [],
        agents: [
          {
            name: 'Agent 1',
            description: 'First agent',
            config: {
              systemPrompt: 'Agent 1 prompt',
              ui: { icon: '1️⃣' }
            }
          },
          {
            name: 'Agent 2',
            description: 'Second agent',
            config: {
              systemPrompt: 'Agent 2 prompt',
              ui: { icon: '2️⃣' }
            }
          }
        ]
      };

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('marketplace.json')) return true;
        if (pathStr.includes('.claude/agents/')) return false;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgentsFromMarketplace('test-market');
      
      expect(result.totalAgents).toBe(2);
      expect(result.importedCount).toBe(2);
      expect(result.errorCount).toBe(0);
    });

    it('should handle partial failures', async () => {
      const mockManifest = {
        name: 'test-marketplace',
        version: '1.0.0',
        owner: { name: 'Test' },
        plugins: [],
        agents: [
          {
            name: 'Good Agent',
            config: {
              systemPrompt: 'Good prompt',
              ui: { icon: '✅' }
            }
          },
          {
            name: 'Bad Agent',
            // No source or config - will fail
            description: 'This will fail'
          }
        ]
      };

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('marketplace.json')) return true;
        if (pathStr.includes('.claude/agents/')) return false;
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.importAgentsFromMarketplace('test-market');
      
      expect(result.totalAgents).toBe(2);
      expect(result.importedCount).toBe(1);
      expect(result.errorCount).toBe(1);
    });
  });

  describe('uninstallAgent', () => {
    it('should uninstall a plugin-installed agent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true
      } as any);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.uninstallAgent('test-agent');
      
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should not uninstall a local agent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => false
      } as any);

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.uninstallAgent('local-agent');
      
      expect(result).toBe(false);
    });

    it('should return false for non-existent agent', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { agentImporter } = await import('../agentImporter');
      
      const result = await agentImporter.uninstallAgent('nonexistent');
      
      expect(result).toBe(false);
    });
  });

  describe('uninstallMarketplaceAgents', () => {
    it('should uninstall all agents from a marketplace', async () => {
      const mockManifest = {
        name: 'test-marketplace',
        agents: [
          { name: 'Agent 1', config: {} },
          { name: 'Agent 2', config: {} }
        ]
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockManifest));
      vi.mocked(fs.lstatSync).mockReturnValue({
        isSymbolicLink: () => true
      } as any);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const count = await agentImporter.uninstallMarketplaceAgents('test-market');
      
      expect(count).toBe(2);
    });
  });

  describe('getInstalledAgentsFromMarketplace', () => {
    it('should return list of installed agents from a marketplace', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['agent-1.json', 'agent-2.json', 'local-agent.json'] as any);
      vi.mocked(fs.lstatSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return {
          isSymbolicLink: () => !pathStr.includes('local-agent')
        } as any;
      });
      vi.mocked(fs.readlinkSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('agent-1')) {
          return '/test/.claude/plugins/marketplaces/test-market/.claude-plugin/agents/agent-1.json';
        }
        if (pathStr.includes('agent-2')) {
          return '/test/.claude/plugins/marketplaces/other-market/.claude-plugin/agents/agent-2.json';
        }
        return '';
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue('/test/.claude/plugins/marketplaces/test-market');

      const { agentImporter } = await import('../agentImporter');
      
      const installedAgents = await agentImporter.getInstalledAgentsFromMarketplace('test-market');
      
      // Only agent-1 is from test-market
      expect(installedAgents.length).toBe(1);
      expect(installedAgents[0]).toBe('agent-1');
    });
  });
});
