/**
 * Unit tests for Speech-to-Text Service
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock file system
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

describe('SpeechToText Types', () => {
  describe('DEFAULT_SPEECH_SETTINGS', () => {
    it('should have correct default values', async () => {
      const { DEFAULT_SPEECH_SETTINGS } = await import('../types');

      expect(DEFAULT_SPEECH_SETTINGS.enabled).toBe(false);
      expect(DEFAULT_SPEECH_SETTINGS.defaultProvider).toBe('openai');
      expect(DEFAULT_SPEECH_SETTINGS.providers.openai.enabled).toBe(false);
      expect(DEFAULT_SPEECH_SETTINGS.providers.groq.enabled).toBe(false);
      expect(DEFAULT_SPEECH_SETTINGS.providers.aliyun.enabled).toBe(false);
      expect(DEFAULT_SPEECH_SETTINGS.providers.tencent.enabled).toBe(false);
    });

    it('should have correct OpenAI defaults', async () => {
      const { DEFAULT_SPEECH_SETTINGS } = await import('../types');

      expect(DEFAULT_SPEECH_SETTINGS.providers.openai.baseUrl).toBe(
        'https://api.openai.com/v1'
      );
      expect(DEFAULT_SPEECH_SETTINGS.providers.openai.model).toBe('whisper-1');
    });

    it('should have correct Groq defaults', async () => {
      const { DEFAULT_SPEECH_SETTINGS } = await import('../types');

      expect(DEFAULT_SPEECH_SETTINGS.providers.groq.baseUrl).toBe(
        'https://api.groq.com/openai/v1'
      );
      expect(DEFAULT_SPEECH_SETTINGS.providers.groq.model).toBe(
        'whisper-large-v3'
      );
    });
  });
});

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create OpenAI provider with correct defaults', async () => {
      const { createOpenAIProvider } = await import(
        '../providers/openaiCompatible'
      );

      const provider = createOpenAIProvider({
        provider: 'openai',
        apiKey: 'test-key',
      });

      expect(provider.name).toBe('openai');
    });

    it('should create Groq provider with correct defaults', async () => {
      const { createGroqProvider } = await import(
        '../providers/openaiCompatible'
      );

      const provider = createGroqProvider({
        provider: 'groq',
        apiKey: 'test-key',
      });

      expect(provider.name).toBe('groq');
    });
  });

  describe('validateConfig', () => {
    it('should return false when apiKey is empty', async () => {
      const { createOpenAIProvider } = await import(
        '../providers/openaiCompatible'
      );

      const provider = createOpenAIProvider({
        provider: 'openai',
        apiKey: '',
      });

      expect(provider.validateConfig()).toBe(false);
    });

    it('should return true when apiKey is provided', async () => {
      const { createOpenAIProvider } = await import(
        '../providers/openaiCompatible'
      );

      const provider = createOpenAIProvider({
        provider: 'openai',
        apiKey: 'sk-test-key',
      });

      expect(provider.validateConfig()).toBe(true);
    });
  });

  describe('transcribe', () => {
    it('should throw error when config is invalid', async () => {
      const { createOpenAIProvider } = await import(
        '../providers/openaiCompatible'
      );

      const provider = createOpenAIProvider({
        provider: 'openai',
        apiKey: '',
      });

      await expect(
        provider.transcribe({
          audioData: 'base64data',
          audioFormat: 'webm',
        })
      ).rejects.toThrow('openai provider is not configured properly');
    });

    it('should call API with correct parameters', async () => {
      const { createOpenAIProvider } = await import(
        '../providers/openaiCompatible'
      );

      // Mock fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'Hello, world!' }),
      });
      global.fetch = mockFetch;

      const provider = createOpenAIProvider({
        provider: 'openai',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        model: 'whisper-1',
      });

      const result = await provider.transcribe({
        audioData: Buffer.from('test audio').toString('base64'),
        audioFormat: 'webm',
      });

      expect(result.text).toBe('Hello, world!');
      expect(result.provider).toBe('openai');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key',
          }),
        })
      );
    });
  });
});

describe('AliyunProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('should return false when credentials are empty', async () => {
      const { createAliyunProvider } = await import('../providers/aliyun');

      const provider = createAliyunProvider({
        provider: 'aliyun',
        accessKeyId: '',
        accessKeySecret: '',
        appKey: '',
      });

      expect(provider.validateConfig()).toBe(false);
    });

    it('should return true when all credentials are provided', async () => {
      const { createAliyunProvider } = await import('../providers/aliyun');

      const provider = createAliyunProvider({
        provider: 'aliyun',
        accessKeyId: 'test-id',
        accessKeySecret: 'test-secret',
        appKey: 'test-app-key',
      });

      expect(provider.validateConfig()).toBe(true);
    });
  });
});

describe('TencentProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateConfig', () => {
    it('should return false when credentials are empty', async () => {
      const { createTencentProvider } = await import('../providers/tencent');

      const provider = createTencentProvider({
        provider: 'tencent',
        secretId: '',
        secretKey: '',
      });

      expect(provider.validateConfig()).toBe(false);
    });

    it('should return true when credentials are provided', async () => {
      const { createTencentProvider } = await import('../providers/tencent');

      const provider = createTencentProvider({
        provider: 'tencent',
        secretId: 'test-id',
        secretKey: 'test-secret',
      });

      expect(provider.validateConfig()).toBe(true);
    });
  });
});
