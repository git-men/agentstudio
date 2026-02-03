/**
 * Speech-to-Text Service
 * 语音转文字服务主入口
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  SpeechToTextProvider,
  SpeechProvider,
  TranscribeRequest,
  TranscribeResponse,
  SpeechToTextSettings,
  DEFAULT_SPEECH_SETTINGS,
  SpeechProviderConfig,
} from './types';
import {
  OpenAICompatibleProvider,
  createOpenAIProvider,
  createGroqProvider,
} from './providers/openaiCompatible';
import { createAliyunProvider } from './providers/aliyun';
import { createTencentProvider } from './providers/tencent';
import { createGoogleProvider } from './providers/google';

// 配置文件路径
const CONFIG_DIR = join(homedir(), '.agentstudio');
const CONFIG_FILE = join(CONFIG_DIR, 'speech-to-text.json');

// 单例实例
let serviceInstance: SpeechToTextService | null = null;

export class SpeechToTextService {
  private settings: SpeechToTextSettings;
  private providers: Map<SpeechProvider, SpeechToTextProvider> = new Map();

  private constructor(settings: SpeechToTextSettings) {
    this.settings = settings;
    this.initializeProviders();
  }

  // 获取单例实例
  static async getInstance(): Promise<SpeechToTextService> {
    if (!serviceInstance) {
      const settings = await loadSettings();
      serviceInstance = new SpeechToTextService(settings);
    }
    return serviceInstance;
  }

  // 重新加载配置
  static async reloadInstance(): Promise<SpeechToTextService> {
    const settings = await loadSettings();
    serviceInstance = new SpeechToTextService(settings);
    return serviceInstance;
  }

  // 初始化供应商
  private initializeProviders(): void {
    this.providers.clear();

    const { providers } = this.settings;

    // OpenAI
    if (providers.openai?.enabled && providers.openai.apiKey) {
      const config: SpeechProviderConfig = {
        provider: 'openai',
        apiKey: providers.openai.apiKey,
        baseUrl: providers.openai.baseUrl,
        model: providers.openai.model,
        proxy: providers.openai.proxy,
      };
      this.providers.set('openai', createOpenAIProvider(config));
    }

    // Groq
    if (providers.groq?.enabled && providers.groq.apiKey) {
      const config: SpeechProviderConfig = {
        provider: 'groq',
        apiKey: providers.groq.apiKey,
        baseUrl: providers.groq.baseUrl,
        model: providers.groq.model,
        proxy: providers.groq.proxy,
      };
      this.providers.set('groq', createGroqProvider(config));
    }

    // Aliyun
    if (
      providers.aliyun?.enabled &&
      providers.aliyun.accessKeyId &&
      providers.aliyun.accessKeySecret
    ) {
      const config: SpeechProviderConfig = {
        provider: 'aliyun',
        accessKeyId: providers.aliyun.accessKeyId,
        accessKeySecret: providers.aliyun.accessKeySecret,
        appKey: providers.aliyun.appKey,
      };
      this.providers.set('aliyun', createAliyunProvider(config));
    }

    // Tencent
    if (
      providers.tencent?.enabled &&
      providers.tencent.secretId &&
      providers.tencent.secretKey
    ) {
      const config: SpeechProviderConfig = {
        provider: 'tencent',
        secretId: providers.tencent.secretId,
        secretKey: providers.tencent.secretKey,
        appKey: providers.tencent.appId,
      };
      this.providers.set('tencent', createTencentProvider(config));
    }

    // Google
    if (providers.google?.enabled && providers.google.apiKey) {
      const config: SpeechProviderConfig = {
        provider: 'google',
        apiKey: providers.google.apiKey,
        proxy: providers.google.proxy,
      };
      this.providers.set('google', createGoogleProvider(config));
    }
  }

  // 获取设置
  getSettings(): SpeechToTextSettings {
    return { ...this.settings };
  }

  // 更新设置
  async updateSettings(
    newSettings: Partial<SpeechToTextSettings>
  ): Promise<void> {
    this.settings = {
      ...this.settings,
      ...newSettings,
      providers: {
        ...this.settings.providers,
        ...(newSettings.providers || {}),
      },
    };

    // 保存到文件
    await saveSettings(this.settings);

    // 重新初始化供应商
    this.initializeProviders();
  }

  // 检查服务是否启用
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  // 获取可用的供应商列表
  getAvailableProviders(): SpeechProvider[] {
    return Array.from(this.providers.keys());
  }

  // 获取默认供应商
  getDefaultProvider(): SpeechProvider | null {
    if (this.providers.has(this.settings.defaultProvider)) {
      return this.settings.defaultProvider;
    }
    // 如果默认供应商不可用，返回第一个可用的
    const availableProviders = this.getAvailableProviders();
    return availableProviders.length > 0 ? availableProviders[0] : null;
  }

  // 执行语音转文字
  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    if (!this.settings.enabled) {
      throw new Error('Speech-to-text service is not enabled');
    }

    // 确定使用哪个供应商
    const providerName = request.provider || this.getDefaultProvider();
    if (!providerName) {
      throw new Error('No speech-to-text provider available');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider '${providerName}' is not configured`);
    }

    return provider.transcribe(request);
  }
}

// 加载配置
async function loadSettings(): Promise<SpeechToTextSettings> {
  try {
    // 确保配置目录存在
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }

    // 检查配置文件是否存在
    if (!existsSync(CONFIG_FILE)) {
      // 创建默认配置
      await saveSettings(DEFAULT_SPEECH_SETTINGS);
      return DEFAULT_SPEECH_SETTINGS;
    }

    // 读取配置
    const content = await readFile(CONFIG_FILE, 'utf-8');
    const settings = JSON.parse(content) as SpeechToTextSettings;

    // 合并默认值以确保新字段存在
    return {
      ...DEFAULT_SPEECH_SETTINGS,
      ...settings,
      providers: {
        ...DEFAULT_SPEECH_SETTINGS.providers,
        ...settings.providers,
      },
    };
  } catch (error) {
    console.error('Failed to load speech-to-text settings:', error);
    return DEFAULT_SPEECH_SETTINGS;
  }
}

// 保存配置
async function saveSettings(settings: SpeechToTextSettings): Promise<void> {
  try {
    // 确保配置目录存在
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }

    await writeFile(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save speech-to-text settings:', error);
    throw error;
  }
}

// 导出类型
export * from './types';

// 导出供应商创建函数（用于测试）
export { createOpenAIProvider, createGroqProvider } from './providers/openaiCompatible';
export { createAliyunProvider } from './providers/aliyun';
export { createTencentProvider } from './providers/tencent';
export { createGoogleProvider } from './providers/google';
