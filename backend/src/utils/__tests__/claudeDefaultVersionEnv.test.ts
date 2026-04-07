import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/claudeVersionStorage', () => ({
  getDefaultVersionId: vi.fn(),
  getAllVersionsInternal: vi.fn(),
}));

import { getDefaultClaudeVersionEnv } from '../claudeDefaultVersionEnv';
import { getDefaultVersionId, getAllVersionsInternal } from '../../services/claudeVersionStorage';

describe('claudeDefaultVersionEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefaultClaudeVersionEnv', () => {
    it('should return env vars when default version has API key', async () => {
      vi.mocked(getDefaultVersionId).mockResolvedValue('v1');
      vi.mocked(getAllVersionsInternal).mockResolvedValue([
        {
          id: 'v1',
          name: 'Default',
          alias: 'default',
          environmentVariables: {
            ANTHROPIC_API_KEY: 'sk-test-123',
            HTTP_PROXY: 'http://proxy:8080',
          },
        },
      ] as any);

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toEqual({
        ANTHROPIC_API_KEY: 'sk-test-123',
        HTTP_PROXY: 'http://proxy:8080',
      });
    });

    it('should return null when no default version ID', async () => {
      vi.mocked(getDefaultVersionId).mockResolvedValue(null);

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toBeNull();
    });

    it('should return null when version has no API keys', async () => {
      vi.mocked(getDefaultVersionId).mockResolvedValue('v1');
      vi.mocked(getAllVersionsInternal).mockResolvedValue([
        {
          id: 'v1',
          name: 'No Keys',
          alias: 'nokeys',
          environmentVariables: {
            HTTP_PROXY: 'http://proxy:8080',
          },
        },
      ] as any);

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toBeNull();
    });

    it('should return null when default version not found in list', async () => {
      vi.mocked(getDefaultVersionId).mockResolvedValue('nonexistent');
      vi.mocked(getAllVersionsInternal).mockResolvedValue([]);

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      vi.mocked(getDefaultVersionId).mockRejectedValue(new Error('storage error'));

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toBeNull();
    });

    it('should recognize OPENAI_API_KEY as valid API key', async () => {
      vi.mocked(getDefaultVersionId).mockResolvedValue('v1');
      vi.mocked(getAllVersionsInternal).mockResolvedValue([
        {
          id: 'v1',
          name: 'OpenAI',
          alias: 'openai',
          environmentVariables: {
            OPENAI_API_KEY: 'sk-openai-test',
          },
        },
      ] as any);

      const result = await getDefaultClaudeVersionEnv();
      expect(result).toEqual({ OPENAI_API_KEY: 'sk-openai-test' });
    });
  });
});
