/**
 * A2A Tools Tests — allow_a2a_call
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '../types.js';

const mockLoadA2AConfig = vi.fn();
const mockSaveA2AConfig = vi.fn();
const mockGenerateApiKey = vi.fn();
const mockGetOrCreateA2AId = vi.fn();
const mockGenerateAgentCard = vi.fn();
const mockGetAgent = vi.fn();

vi.mock('../../a2a/a2aConfigService.js', () => ({
  loadA2AConfig: (...args: unknown[]) => mockLoadA2AConfig(...args),
  saveA2AConfig: (...args: unknown[]) => mockSaveA2AConfig(...args),
}));

vi.mock('../../a2a/apiKeyService.js', () => ({
  generateApiKey: (...args: unknown[]) => mockGenerateApiKey(...args),
  listApiKeysWithDecryption: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../a2a/agentMappingService.js', () => ({
  getOrCreateA2AId: (...args: unknown[]) => mockGetOrCreateA2AId(...args),
}));

vi.mock('../../a2a/agentCardService.js', () => ({
  generateAgentCard: (...args: unknown[]) => mockGenerateAgentCard(...args),
}));

vi.mock('../../agentStorage.js', () => ({
  AgentStorage: vi.fn().mockImplementation(() => ({
    getAgent: (...args: unknown[]) => mockGetAgent(...args),
  })),
}));

vi.mock('../../../types/a2a.js', () => ({
  DEFAULT_A2A_CONFIG: {
    allowedAgents: [],
    taskTimeout: 300000,
    maxConcurrentTasks: 5,
  },
}));

vi.mock('../../tunnelService.js', () => ({
  tunnelService: {
    getAllStatuses: vi.fn().mockReturnValue([{ connected: false, domain: null }]),
    getAllConfigs: vi.fn().mockReturnValue([{ protocol: 'https', domainSuffix: '', serverUrl: '', tunnelName: '' }]),
  },
}));

vi.mock('../../../utils/networkUtils.js', () => ({
  getNetworkInfo: vi.fn().mockReturnValue({ bestLocalIP: '192.168.1.100' }),
}));

import { a2aTools } from '../tools/a2aTools.js';

const defaultContext: ToolContext = {
  apiKeyId: 'test-key',
  permissions: ['admin:*'],
};

function findTool(name: string) {
  return a2aTools.find((t) => t.tool.name === name);
}

describe('allow_a2a_call', () => {
  const allowTool = findTool('allow_a2a_call');

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetOrCreateA2AId.mockResolvedValue('agent-id-123');
    mockGetAgent.mockReturnValue({
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Default agent',
      enabled: true,
      source: 'local',
      allowedTools: [],
    });
    mockGenerateAgentCard.mockReturnValue({
      url: 'http://192.168.1.100:4936/a2a/agent-id-123/messages',
      description: 'Target agent',
    });
    mockLoadA2AConfig.mockResolvedValue({
      allowedAgents: [],
      taskTimeout: 300000,
      maxConcurrentTasks: 5,
    });
    mockSaveA2AConfig.mockResolvedValue(undefined);
    mockGenerateApiKey.mockResolvedValue({
      key: 'agt_proj_test_key_123',
      keyData: { id: 'key-1', description: 'test', createdAt: new Date().toISOString() },
    });
  });

  it('should be registered', () => {
    expect(allowTool).toBeDefined();
    expect(allowTool!.tool.name).toBe('allow_a2a_call');
  });

  it('should require system:write permission', () => {
    expect(allowTool!.requiredPermissions).toContain('system:write');
  });

  it('should successfully allow a2a call between two projects', async () => {
    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text!);
    expect(data.status).toBe('success');
    expect(data.name).toBe('target-project');
    expect(data.url).toBe('http://192.168.1.100:4936/a2a/agent-id-123/messages');
    expect(data.enabled).toBe(true);

    expect(mockGenerateApiKey).toHaveBeenCalledWith(
      '/Users/me/target-project',
      'A2A access from caller-project'
    );
    expect(mockSaveA2AConfig).toHaveBeenCalledWith(
      '/Users/me/caller-project',
      expect.objectContaining({
        allowedAgents: [
          expect.objectContaining({
            name: 'target-project',
            apiKey: 'agt_proj_test_key_123',
            enabled: true,
          }),
        ],
      })
    );
  });

  it('should return already_exists when target is already in allowed list', async () => {
    mockLoadA2AConfig.mockResolvedValue({
      allowedAgents: [
        {
          name: 'target-project',
          url: 'http://192.168.1.100:4936/a2a/agent-id-123/messages',
          apiKey: 'existing-key',
          description: '',
          enabled: true,
        },
      ],
      taskTimeout: 300000,
      maxConcurrentTasks: 5,
    });

    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text!);
    expect(data.status).toBe('already_exists');
    expect(data.name).toBe('target-project');

    expect(mockGenerateApiKey).not.toHaveBeenCalled();
    expect(mockSaveA2AConfig).not.toHaveBeenCalled();
  });

  it('should create default config when loadA2AConfig returns null', async () => {
    mockLoadA2AConfig.mockResolvedValue(null);

    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text!);
    expect(data.status).toBe('success');

    expect(mockSaveA2AConfig).toHaveBeenCalledWith(
      '/Users/me/caller-project',
      expect.objectContaining({
        allowedAgents: expect.arrayContaining([
          expect.objectContaining({ name: 'target-project' }),
        ]),
      })
    );
  });

  it('should return error when agent type is not found', async () => {
    mockGetAgent.mockReturnValue(null);

    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should return error when a dependency throws', async () => {
    mockGetOrCreateA2AId.mockRejectedValue(new Error('mapping service failure'));

    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('mapping service failure');
  });

  it('should preserve existing allowed agents when adding a new one', async () => {
    const existingAgent = {
      name: 'other-project',
      url: 'http://192.168.1.100:4936/a2a/other-id/messages',
      apiKey: 'other-key',
      description: '',
      enabled: true,
    };

    mockLoadA2AConfig.mockResolvedValue({
      allowedAgents: [existingAgent],
      taskTimeout: 300000,
      maxConcurrentTasks: 5,
    });

    const result = await allowTool!.handler(
      {
        project_path: '/Users/me/caller-project',
        target_project_path: '/Users/me/target-project',
      },
      defaultContext
    );

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text!);
    expect(data.status).toBe('success');

    const savedConfig = mockSaveA2AConfig.mock.calls[0][1];
    expect(savedConfig.allowedAgents).toHaveLength(2);
    expect(savedConfig.allowedAgents[0]).toEqual(existingAgent);
    expect(savedConfig.allowedAgents[1].name).toBe('target-project');
  });
});
