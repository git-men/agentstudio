/**
 * Speech-to-Text Service Types
 * 语音转文字服务类型定义
 */

// 支持的语音服务供应商
export type SpeechProvider = 'openai' | 'groq' | 'aliyun' | 'tencent' | 'google';

// 代理配置
export interface ProxyConfig {
  // 是否启用代理
  enabled: boolean;
  // 代理类型: 'http' | 'https' | 'socks5' | 'env'
  // 'env' 表示使用环境变量 (https_proxy, http_proxy, all_proxy)
  type: 'http' | 'https' | 'socks5' | 'env';
  // 代理服务器地址 (当 type 不是 'env' 时需要)
  url?: string;
}

// 供应商配置
export interface SpeechProviderConfig {
  provider: SpeechProvider;
  apiKey?: string;
  baseUrl?: string;
  // 阿里云特有配置
  accessKeyId?: string;
  accessKeySecret?: string;
  appKey?: string;
  // 腾讯云特有配置
  secretId?: string;
  secretKey?: string;
  // 通用配置
  model?: string;
  language?: string;
  // 代理配置
  proxy?: ProxyConfig;
}

// 转写请求参数
export interface TranscribeRequest {
  // 音频数据 (base64 编码)
  audioData: string;
  // 音频格式 (如 'webm', 'wav', 'mp3')
  audioFormat: string;
  // 语言 (可选, 如 'zh-CN', 'en-US')
  language?: string;
  // 供应商覆盖 (可选)
  provider?: SpeechProvider;
}

// 转写响应
export interface TranscribeResponse {
  // 转写文本
  text: string;
  // 置信度 (0-1, 如果支持)
  confidence?: number;
  // 使用的供应商
  provider: SpeechProvider;
  // 处理时间 (毫秒)
  processingTime?: number;
  // 语言检测结果
  detectedLanguage?: string;
}

// 供应商接口
export interface SpeechToTextProvider {
  // 供应商名称
  name: SpeechProvider;
  // 检查配置是否有效
  validateConfig(): boolean;
  // 执行转写
  transcribe(request: TranscribeRequest): Promise<TranscribeResponse>;
}

// 服务配置
export interface SpeechToTextServiceConfig {
  // 默认供应商
  defaultProvider: SpeechProvider;
  // 各供应商配置
  providers: {
    openai?: SpeechProviderConfig;
    groq?: SpeechProviderConfig;
    aliyun?: SpeechProviderConfig;
    tencent?: SpeechProviderConfig;
    google?: SpeechProviderConfig;
  };
}

// 全局配置存储结构
export interface SpeechToTextSettings {
  enabled: boolean;
  defaultProvider: SpeechProvider;
  providers: {
    openai: {
      enabled: boolean;
      apiKey: string;
      baseUrl: string;
      model: string;
      // 代理配置
      proxy?: {
        enabled: boolean;
        type: 'http' | 'https' | 'socks5' | 'env';
        url?: string;
      };
    };
    groq: {
      enabled: boolean;
      apiKey: string;
      baseUrl: string;
      model: string;
      // 代理配置
      proxy?: {
        enabled: boolean;
        type: 'http' | 'https' | 'socks5' | 'env';
        url?: string;
      };
    };
    aliyun: {
      enabled: boolean;
      accessKeyId: string;
      accessKeySecret: string;
      appKey: string;
    };
    tencent: {
      enabled: boolean;
      secretId: string;
      secretKey: string;
      appId: string;
    };
    google: {
      enabled: boolean;
      apiKey: string;
      // 代理配置
      proxy?: {
        enabled: boolean;
        type: 'http' | 'https' | 'socks5' | 'env';
        url?: string;
      };
    };
  };
}

// 默认配置
export const DEFAULT_SPEECH_SETTINGS: SpeechToTextSettings = {
  enabled: false,
  defaultProvider: 'openai',
  providers: {
    openai: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'whisper-1',
    },
    groq: {
      enabled: false,
      apiKey: '',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3',
    },
    aliyun: {
      enabled: false,
      accessKeyId: '',
      accessKeySecret: '',
      appKey: '',
    },
    tencent: {
      enabled: false,
      secretId: '',
      secretKey: '',
      appId: '',
    },
    google: {
      enabled: false,
      apiKey: '',
    },
  },
};
