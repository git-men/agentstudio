import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../config/paths', () => ({
  MCP_SERVER_CONFIG_FILE: '/mock/.agentstudio/mcp-servers.json',
}));

vi.mock('../../config/engineConfig', () => ({
  getEnginePaths: vi.fn(() => ({
    mcpConfigPath: '/mock/.claude/mcp.json',
  })),
}));

import { readMcpConfig, readEngineMcpConfig } from '../mcpConfigReader';

describe('mcpConfigReader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readMcpConfig', () => {
    it('should return parsed MCP config when file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        mcpServers: {
          'test-server': { command: 'node', args: ['server.js'] },
        },
      }));

      const result = readMcpConfig();
      expect(result.mcpServers).toHaveProperty('test-server');
      expect(result.mcpServers['test-server'].command).toBe('node');
    });

    it('should return empty mcpServers when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = readMcpConfig();
      expect(result).toEqual({ mcpServers: {} });
    });

    it('should return empty mcpServers on JSON parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json{{{');

      const result = readMcpConfig();
      expect(result).toEqual({ mcpServers: {} });
    });
  });

  describe('readEngineMcpConfig', () => {
    it('should return engine MCP servers when config exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        mcpServers: {
          'engine-server': { command: 'python', args: ['mcp.py'] },
        },
      }));

      const result = readEngineMcpConfig();
      expect(result).toHaveProperty('engine-server');
    });

    it('should return empty object when engine config does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = readEngineMcpConfig();
      expect(result).toEqual({});
    });

    it('should return empty object when engine path equals AgentStudio config path', async () => {
      const { getEnginePaths } = await import('../../config/engineConfig');
      vi.mocked(getEnginePaths).mockReturnValue({
        mcpConfigPath: '/mock/.agentstudio/mcp-servers.json',
      } as any);

      const result = readEngineMcpConfig();
      expect(result).toEqual({});
    });
  });
});
