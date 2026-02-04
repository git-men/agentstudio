/**
 * Google Cloud Speech-to-Text Provider
 * 使用 Google Cloud Speech-to-Text API v1
 * 文档: https://cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/recognize
 */

import {
  SpeechToTextProvider,
  TranscribeRequest,
  TranscribeResponse,
  SpeechProviderConfig,
  ProxyConfig,
} from '../types';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class GoogleProvider implements SpeechToTextProvider {
  name: 'google' = 'google';
  private apiKey: string;
  private proxy?: ProxyConfig;

  // Google Cloud Speech-to-Text API 端点
  private static readonly API_ENDPOINT =
    'https://speech.googleapis.com/v1/speech:recognize';

  constructor(config: SpeechProviderConfig) {
    this.apiKey = config.apiKey || '';
    this.proxy = config.proxy;
  }

  validateConfig(): boolean {
    return !!this.apiKey;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const startTime = Date.now();

    if (!this.validateConfig()) {
      throw new Error('Google provider is not configured properly');
    }

    // 构建请求体
    const requestBody = {
      config: {
        // 音频编码格式
        encoding: this.getEncoding(request.audioFormat),
        // 采样率 - 对于 WebM/OGG_OPUS 格式，设置为 48000 Hz
        sampleRateHertz: this.getSampleRate(request.audioFormat),
        // 语言代码
        languageCode: this.getLanguageCode(request.language),
        // 启用自动标点
        enableAutomaticPunctuation: true,
        // 返回多个候选结果
        maxAlternatives: 1,
        // 模型选择 - 使用 latest_long 或 latest_short
        model: 'latest_short',
      },
      audio: {
        // Base64 编码的音频内容
        content: request.audioData,
      },
    };

    // 构建请求 URL（带 API Key）
    const url = `${GoogleProvider.API_ENDPOINT}?key=${this.apiKey}`;

    // 配置 fetch 选项
    const fetchOptions: RequestInit & { agent?: unknown } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    };

    // 配置代理
    const agent = this.createProxyAgent();
    if (agent) {
      fetchOptions.agent = agent;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Google API error (${response.status}): ${errorText}`;

      // 尝试解析 JSON 错误
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message) {
          errorMessage = `Google API error: ${errorJson.error.message}`;
        }
      } catch {
        // 使用原始错误信息
      }

      throw new Error(errorMessage);
    }

    const result = (await response.json()) as GoogleRecognizeResponse;
    const processingTime = Date.now() - startTime;

    // 提取转写结果
    const transcript = this.extractTranscript(result);
    const confidence = this.extractConfidence(result);
    const detectedLanguage = this.extractLanguage(result);

    return {
      text: transcript,
      provider: 'google',
      processingTime,
      confidence,
      detectedLanguage,
    };
  }

  private createProxyAgent(): HttpsProxyAgent<string> | SocksProxyAgent | undefined {
    if (!this.proxy?.enabled) {
      return undefined;
    }

    if (this.proxy.type === 'env') {
      // 使用环境变量中的代理
      const proxyUrl =
        process.env.https_proxy ||
        process.env.HTTPS_PROXY ||
        process.env.http_proxy ||
        process.env.HTTP_PROXY ||
        process.env.all_proxy ||
        process.env.ALL_PROXY;

      if (proxyUrl) {
        if (proxyUrl.startsWith('socks')) {
          return new SocksProxyAgent(proxyUrl);
        }
        return new HttpsProxyAgent(proxyUrl);
      }
      return undefined;
    }

    if (!this.proxy.url) {
      return undefined;
    }

    if (this.proxy.type === 'socks5') {
      return new SocksProxyAgent(this.proxy.url);
    }

    return new HttpsProxyAgent(this.proxy.url);
  }

  private getEncoding(
    format: string
  ): 'WEBM_OPUS' | 'OGG_OPUS' | 'LINEAR16' | 'MP3' | 'ENCODING_UNSPECIFIED' {
    // Google Cloud Speech-to-Text 支持的编码格式
    const formatMap: Record<
      string,
      'WEBM_OPUS' | 'OGG_OPUS' | 'LINEAR16' | 'MP3' | 'ENCODING_UNSPECIFIED'
    > = {
      webm: 'WEBM_OPUS',
      'audio/webm': 'WEBM_OPUS',
      'audio/webm;codecs=opus': 'WEBM_OPUS',
      ogg: 'OGG_OPUS',
      'audio/ogg': 'OGG_OPUS',
      wav: 'LINEAR16',
      'audio/wav': 'LINEAR16',
      mp3: 'MP3',
      'audio/mp3': 'MP3',
      'audio/mpeg': 'MP3',
    };
    return formatMap[format.toLowerCase()] || 'ENCODING_UNSPECIFIED';
  }

  private getSampleRate(format: string): number {
    // WebM/OGG OPUS 通常使用 48000 Hz
    const formatLower = format.toLowerCase();
    if (
      formatLower.includes('webm') ||
      formatLower.includes('ogg') ||
      formatLower.includes('opus')
    ) {
      return 48000;
    }
    // 其他格式使用 16000 Hz（语音识别常用采样率）
    return 16000;
  }

  private getLanguageCode(language?: string): string {
    if (!language) {
      return 'zh-CN'; // 默认中文
    }

    // 直接使用传入的语言代码（如果是 BCP-47 格式）
    if (language.includes('-')) {
      return language;
    }

    // 简写映射
    const languageMap: Record<string, string> = {
      zh: 'zh-CN',
      en: 'en-US',
      ja: 'ja-JP',
      ko: 'ko-KR',
      es: 'es-ES',
      fr: 'fr-FR',
      de: 'de-DE',
      pt: 'pt-BR',
      ru: 'ru-RU',
      ar: 'ar-SA',
      hi: 'hi-IN',
      it: 'it-IT',
    };

    return languageMap[language] || 'zh-CN';
  }

  private extractTranscript(result: GoogleRecognizeResponse): string {
    if (!result.results || result.results.length === 0) {
      return '';
    }

    // 合并所有结果的 transcript
    return result.results
      .map((r) => r.alternatives?.[0]?.transcript || '')
      .join(' ')
      .trim();
  }

  private extractConfidence(result: GoogleRecognizeResponse): number | undefined {
    if (!result.results || result.results.length === 0) {
      return undefined;
    }

    const confidence = result.results[0]?.alternatives?.[0]?.confidence;
    return confidence !== undefined ? confidence : undefined;
  }

  private extractLanguage(result: GoogleRecognizeResponse): string | undefined {
    if (!result.results || result.results.length === 0) {
      return undefined;
    }

    return result.results[0]?.languageCode;
  }
}

// Google API 响应类型
interface GoogleRecognizeResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{
        word?: string;
        startTime?: string;
        endTime?: string;
        confidence?: number;
      }>;
    }>;
    channelTag?: number;
    resultEndTime?: string;
    languageCode?: string;
  }>;
  totalBilledTime?: string;
  speechAdaptationInfo?: {
    adaptationTimeout?: boolean;
    timeoutMessage?: string;
  };
  requestId?: string;
}

// 工厂函数
export function createGoogleProvider(
  config: SpeechProviderConfig
): GoogleProvider {
  return new GoogleProvider(config);
}
