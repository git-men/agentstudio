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

  // ==========================================================================
  // 真实场景测试：Marketplace 根目录 + agents/arin/agent.json
  //
  // 模拟真实的 marketplace 目录结构：
  //   /marketplace/
  //   ├── .claude-plugin/
  //   │   └── marketplace.json
  //   ├── plugins/
  //   │   ├── code-reviewer/
  //   │   └── data-analyst/
  //   └── agents/
  //       └── arin/
  //           └── agent.json    ← 两层深度
  //
  // Fallback 扫描只看一层：{marketplace}/{subdir}/agent.json
  // 即只看 plugins/agent.json 和 agents/agent.json，不会递归到 agents/arin/
  // ==========================================================================

  describe('BUG: fallback scanner 无法发现两层深度的 agent', () => {
    it('manifest 无 agents 声明时，agents/arin/agent.json 不会被发现', async () => {
      // manifest 只有 plugins，没有 agents 数组
      const manifestWithoutAgents = {
        name: 'vag-internal-marketplace',
        plugins: [
          { name: 'code-reviewer', source: './plugins/code-reviewer' },
          { name: 'data-analyst', source: './plugins/data-analyst' },
        ],
        // 注意：没有 agents 数组！
      };

      // 模拟目录结构
      const marketplacePath = '/test/.cursor/plugins/marketplaces/marketplace';
      const directoryEntries: Record<string, string[]> = {
        [marketplacePath]: ['.claude-plugin', 'plugins', 'agents'],
      };
      const directoryFlags: Record<string, boolean> = {
        [`${marketplacePath}/plugins`]: true,
        [`${marketplacePath}/agents`]: true,
      };
      const existingFiles: Record<string, boolean> = {
        [`${marketplacePath}/.claude-plugin/marketplace.json`]: true,
        // agents/agent.json 不存在（fallback 会找的位置）
        [`${marketplacePath}/agents/agent.json`]: false,
        // agents/arin/agent.json 存在（真实位置，但 fallback 不会找到这里）
        [`${marketplacePath}/agents/arin/agent.json`]: true,
        // plugins/agent.json 不存在
        [`${marketplacePath}/plugins/agent.json`]: false,
      };

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr in existingFiles) return existingFiles[pathStr];
        // 默认：marketplace 路径和 manifest 存在
        if (pathStr === marketplacePath) return true;
        if (pathStr.includes('marketplace.json')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifestWithoutAgents));
      vi.mocked(fs.readdirSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return (directoryEntries[pathStr] || []) as any;
      });
      vi.mocked(fs.statSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        return {
          isDirectory: () => directoryFlags[pathStr] ?? false,
          isFile: () => !directoryFlags[pathStr],
        } as any;
      });

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue(marketplacePath);

      const { agentImporter } = await import('../agentImporter');

      const result = await agentImporter.importAgentsFromMarketplace('marketplace');

      // 关键断言：Fallback 扫描找不到两层深度的 agent
      expect(result.totalAgents).toBe(0);
      expect(result.importedCount).toBe(0);
      // Arin agent 没有被导入，这就是 bug 的证明
    });
  });

  describe('FIX: manifest agents 声明能正确导入两层深度的 agent', () => {
    it('manifest 有 agents 声明时，agents/arin/agent.json 被正确发现和导入', async () => {
      // manifest 包含 agents 声明
      const manifestWithAgents = {
        name: 'vag-internal-marketplace',
        plugins: [
          { name: 'code-reviewer', source: './plugins/code-reviewer' },
        ],
        agents: [
          {
            name: 'Arin (阿然)',
            source: 'agents/arin/agent.json',
            description: 'ForgeaX AI 游戏构建助手',
            version: '1.0.0',
          },
        ],
      };

      const arinAgentConfig = {
        id: 'arin',
        name: 'Arin (阿然)',
        description: 'ForgeaX AI 游戏构建助手',
        version: '1.0.0',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        permissionMode: 'acceptEdits',
        allowedTools: [],
        ui: { icon: '🎮', headerTitle: 'Arin' },
        tags: ['gaming'],
      };

      const marketplacePath = '/test/.cursor/plugins/marketplaces/marketplace';

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        // manifest 存在
        if (pathStr.includes('marketplace.json')) return true;
        // agent.json 源文件存在
        if (pathStr.includes('agents/arin/agent.json')) return true;
        // 目标 agent 文件不存在（还没导入）
        if (pathStr === '/test/.claude/agents/arin.json') return false;
        // agents 目录存在
        if (pathStr.includes('.claude-plugin/agents')) return false;
        return true;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('marketplace.json')) return JSON.stringify(manifestWithAgents);
        if (pathStr.includes('agent.json')) return JSON.stringify(arinAgentConfig);
        return '{}';
      });
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue(marketplacePath);

      const { agentImporter } = await import('../agentImporter');

      const result = await agentImporter.importAgentsFromMarketplace('marketplace');

      // 关键断言：通过 manifest 声明，agent 被正确发现和导入
      expect(result.totalAgents).toBe(1);
      expect(result.importedCount).toBe(1);
      expect(result.errorCount).toBe(0);

      // 验证写入了 agent 配置文件
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('agents/arin.json'),
        expect.any(String),
      );

      // 验证创建了 symlink
      expect(fs.symlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('.claude-plugin/agents/arin.json'),
        expect.stringContaining('/test/.claude/agents/arin.json'),
      );
    });

    it('manifest agents 中 generateAgentId 对中文名称正确处理', async () => {
      // 验证 "Arin (阿然)" 生成的 ID 是 "arin"
      const manifestWithAgents = {
        name: 'test',
        plugins: [],
        agents: [
          {
            name: 'Arin (阿然)',
            source: 'agents/arin/agent.json',
            description: 'Test',
          },
        ],
      };

      const arinConfig = {
        id: 'arin',
        name: 'Arin (阿然)',
        systemPrompt: { type: 'preset', preset: 'claude_code' },
      };

      const marketplacePath = '/test/.cursor/plugins/marketplaces/marketplace';

      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('marketplace.json')) return true;
        if (pathStr.includes('agents/arin/agent.json')) return true;
        if (pathStr === '/test/.claude/agents/arin.json') return false;
        return true;
      });
      vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.includes('marketplace.json')) return JSON.stringify(manifestWithAgents);
        if (pathStr.includes('agent.json')) return JSON.stringify(arinConfig);
        return '{}';
      });
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(fs.symlinkSync).mockReturnValue(undefined);

      const { pluginPaths } = await import('../pluginPaths');
      vi.mocked(pluginPaths.getMarketplacePath).mockReturnValue(marketplacePath);

      const { agentImporter } = await import('../agentImporter');

      const result = await agentImporter.importAgentsFromMarketplace('marketplace');

      expect(result.importedCount).toBe(1);
      expect(result.results[0].agentId).toBe('arin');
      // "Arin (阿然)" → toLowerCase → "arin (阿然)" → 非[a-z0-9]替换 → "arin-" → 去掉尾 → "arin"
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
