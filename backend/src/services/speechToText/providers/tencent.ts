/**
 * Tencent Cloud (腾讯云) Speech-to-Text Provider
 * 使用腾讯云语音识别服务 - 一句话识别
 * 文档: https://cloud.tencent.com/document/product/1093
 */

import * as crypto from 'crypto';
import {
  SpeechToTextProvider,
  TranscribeRequest,
  TranscribeResponse,
  SpeechProviderConfig,
} from '../types';

export class TencentProvider implements SpeechToTextProvider {
  name: 'tencent' = 'tencent';
  private secretId: string;
  private secretKey: string;
  private appId: string;

  // 腾讯云语音识别 API 端点
  private static readonly API_HOST = 'asr.tencentcloudapi.com';
  private static readonly API_VERSION = '2019-06-14';
  private static readonly REGION = 'ap-shanghai';

  constructor(config: SpeechProviderConfig) {
    this.secretId = config.secretId || '';
    this.secretKey = config.secretKey || '';
    // appId 在腾讯云中通常是 ProjectId，但一句话识别不需要
    this.appId = config.appKey || '';
  }

  validateConfig(): boolean {
    return !!this.secretId && !!this.secretKey;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const startTime = Date.now();

    if (!this.validateConfig()) {
      throw new Error('Tencent provider is not configured properly');
    }

    // 构建请求体
    const requestBody = {
      // 引擎类型: 16k_zh (中文), 16k_en (英文), 16k_zh_en (中英混合)
      EngineModelType: this.getEngineType(request.language),
      // 音频格式
      VoiceFormat: this.getVoiceFormat(request.audioFormat),
      // 音频数据 (base64)
      Data: request.audioData,
      // 数据长度
      DataLen: Buffer.from(request.audioData, 'base64').length,
      // 来源 0:URL, 1:音频数据
      SourceType: 1,
    };

    // 生成签名并发送请求
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = this.generateHeaders(
      'SentenceRecognition',
      requestBody,
      timestamp
    );

    const response = await fetch(`https://${TencentProvider.API_HOST}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tencent API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const processingTime = Date.now() - startTime;

    // 检查是否有错误
    if (result.Response?.Error) {
      throw new Error(
        `Tencent recognition failed: ${result.Response.Error.Message}`
      );
    }

    return {
      text: result.Response?.Result || '',
      provider: 'tencent',
      processingTime,
      // 腾讯云返回的是置信度列表，我们取第一个
      confidence: result.Response?.WordList?.[0]?.Confidence,
    };
  }

  private generateHeaders(
    action: string,
    payload: object,
    timestamp: number
  ): Record<string, string> {
    const date = new Date(timestamp * 1000).toISOString().split('T')[0];
    const service = 'asr';

    // 1. 构建规范请求串
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const payloadStr = JSON.stringify(payload);
    const hashedPayload = crypto
      .createHash('sha256')
      .update(payloadStr)
      .digest('hex');

    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\n` +
      `host:${TencentProvider.API_HOST}\n` +
      `x-tc-action:${action.toLowerCase()}\n`;

    const signedHeaders = 'content-type;host;x-tc-action';

    const canonicalRequest = [
      httpRequestMethod,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedPayload,
    ].join('\n');

    // 2. 构建待签名字符串
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    const stringToSign = [
      algorithm,
      timestamp,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    // 3. 计算签名
    const secretDate = crypto
      .createHmac('sha256', `TC3${this.secretKey}`)
      .update(date)
      .digest();
    const secretService = crypto
      .createHmac('sha256', secretDate)
      .update(service)
      .digest();
    const secretSigning = crypto
      .createHmac('sha256', secretService)
      .update('tc3_request')
      .digest();
    const signature = crypto
      .createHmac('sha256', secretSigning)
      .update(stringToSign)
      .digest('hex');

    // 4. 构建 Authorization
    const authorization = `${algorithm} Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      'Content-Type': 'application/json; charset=utf-8',
      Host: TencentProvider.API_HOST,
      'X-TC-Action': action,
      'X-TC-Version': TencentProvider.API_VERSION,
      'X-TC-Timestamp': timestamp.toString(),
      'X-TC-Region': TencentProvider.REGION,
      Authorization: authorization,
    };
  }

  private getEngineType(language?: string): string {
    if (!language) {
      return '16k_zh_en'; // 默认中英混合
    }

    const engineMap: Record<string, string> = {
      'zh-CN': '16k_zh',
      'zh-TW': '16k_zh',
      zh: '16k_zh',
      'en-US': '16k_en',
      'en-GB': '16k_en',
      en: '16k_en',
      'ja-JP': '16k_ja',
      ja: '16k_ja',
      'ko-KR': '16k_ko',
      ko: '16k_ko',
    };

    return engineMap[language] || '16k_zh_en';
  }

  private getVoiceFormat(format: string): string {
    // 腾讯云支持的格式: wav, pcm, ogg-opus, speex, silk, mp3, m4a, aac, amr
    const formatMap: Record<string, string> = {
      webm: 'ogg-opus',
      'audio/webm': 'ogg-opus',
      wav: 'wav',
      'audio/wav': 'wav',
      mp3: 'mp3',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      ogg: 'ogg-opus',
      'audio/ogg': 'ogg-opus',
      m4a: 'm4a',
      'audio/m4a': 'm4a',
      aac: 'aac',
      'audio/aac': 'aac',
    };
    return formatMap[format.toLowerCase()] || 'wav';
  }
}

// 工厂函数
export function createTencentProvider(
  config: SpeechProviderConfig
): TencentProvider {
  return new TencentProvider(config);
}
