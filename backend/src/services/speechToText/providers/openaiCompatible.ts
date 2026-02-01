/**
 * OpenAI Compatible Speech-to-Text Provider
 * 支持 OpenAI Whisper API 和兼容接口 (如 Groq)
 */

import FormData from 'form-data';
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  SpeechToTextProvider,
  SpeechProvider,
  TranscribeRequest,
  TranscribeResponse,
  SpeechProviderConfig,
  ProxyConfig,
} from '../types';

export class OpenAICompatibleProvider implements SpeechToTextProvider {
  name: SpeechProvider;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private proxy?: ProxyConfig;

  constructor(config: SpeechProviderConfig) {
    this.name = config.provider;
    this.apiKey = config.apiKey || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.model = config.model || 'whisper-1';
    this.proxy = config.proxy;
  }

  validateConfig(): boolean {
    return !!this.apiKey && !!this.baseUrl;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const startTime = Date.now();

    if (!this.validateConfig()) {
      throw new Error(`${this.name} provider is not configured properly`);
    }

    // 将 base64 数据转换为 Buffer
    const audioBuffer = Buffer.from(request.audioData, 'base64');

    // 确定文件扩展名
    const extension = this.getFileExtension(request.audioFormat);
    const mimeType = this.getMimeType(request.audioFormat);

    // 创建 FormData (使用 form-data 包，兼容性更好)
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: `audio.${extension}`,
      contentType: mimeType,
    });
    formData.append('model', this.model);

    // 如果指定了语言，添加语言参数
    if (request.language) {
      formData.append('language', this.normalizeLanguage(request.language));
    }

    // 解析 URL
    const url = new URL(`${this.baseUrl}/audio/transcriptions`);

    // 获取代理 agent
    const agent = this.getProxyAgent();

    // 使用 https 模块发送请求 (支持代理)
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...formData.getHeaders(),
        },
      };

      // 如果有代理，添加 agent
      if (agent) {
        options.agent = agent;
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const processingTime = Date.now() - startTime;

          if (res.statusCode !== 200) {
            reject(
              new Error(`${this.name} API error (${res.statusCode}): ${data}`)
            );
            return;
          }

          try {
            const result = JSON.parse(data);
            resolve({
              text: result.text || '',
              provider: this.name,
              processingTime,
              detectedLanguage: result.language,
            });
          } catch (e) {
            reject(new Error(`Failed to parse ${this.name} API response: ${data}`));
          }
        });
      });

      req.on('error', (e) => {
        reject(new Error(`${this.name} API request failed: ${e.message}`));
      });

      // 使用 form-data 的 pipe 方法发送数据
      formData.pipe(req);
    });
  }

  // 获取代理 agent
  private getProxyAgent(): https.Agent | undefined {
    if (!this.proxy?.enabled) {
      return undefined;
    }

    let proxyUrl: string | undefined;

    if (this.proxy.type === 'env') {
      // 从环境变量获取代理
      proxyUrl =
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY;
    } else if (this.proxy.url) {
      proxyUrl = this.proxy.url;
    }

    if (!proxyUrl) {
      return undefined;
    }

    // 根据代理类型创建 agent
    if (this.proxy.type === 'socks5' || proxyUrl.startsWith('socks')) {
      return new SocksProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(proxyUrl);
    }
  }

  private getFileExtension(format: string): string {
    const formatMap: Record<string, string> = {
      webm: 'webm',
      'audio/webm': 'webm',
      wav: 'wav',
      'audio/wav': 'wav',
      mp3: 'mp3',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      m4a: 'm4a',
      'audio/m4a': 'm4a',
      ogg: 'ogg',
      'audio/ogg': 'ogg',
      flac: 'flac',
      'audio/flac': 'flac',
    };
    return formatMap[format.toLowerCase()] || 'webm';
  }

  private getMimeType(format: string): string {
    const mimeMap: Record<string, string> = {
      webm: 'audio/webm',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      m4a: 'audio/m4a',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };

    // 如果已经是 MIME 类型，直接返回
    if (format.includes('/')) {
      return format;
    }

    return mimeMap[format.toLowerCase()] || 'audio/webm';
  }

  private normalizeLanguage(language: string): string {
    // OpenAI Whisper 使用 ISO-639-1 语言代码
    const languageMap: Record<string, string> = {
      'zh-CN': 'zh',
      'zh-TW': 'zh',
      'en-US': 'en',
      'en-GB': 'en',
      'ja-JP': 'ja',
      'ko-KR': 'ko',
    };
    return languageMap[language] || language.split('-')[0];
  }
}

// 工厂函数
export function createOpenAIProvider(
  config: SpeechProviderConfig
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    ...config,
    provider: 'openai',
    baseUrl: config.baseUrl || 'https://api.openai.com/v1',
    model: config.model || 'whisper-1',
  });
}

export function createGroqProvider(
  config: SpeechProviderConfig
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    ...config,
    provider: 'groq',
    baseUrl: config.baseUrl || 'https://api.groq.com/openai/v1',
    model: config.model || 'whisper-large-v3',
  });
}
