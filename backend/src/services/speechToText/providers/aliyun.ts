/**
 * Aliyun (阿里云) Speech-to-Text Provider
 * 使用阿里云智能语音交互服务 - 录音文件识别
 * 文档: https://help.aliyun.com/document_detail/84435.html
 */

import * as crypto from 'crypto';
import {
  SpeechToTextProvider,
  TranscribeRequest,
  TranscribeResponse,
  SpeechProviderConfig,
} from '../types';

export class AliyunProvider implements SpeechToTextProvider {
  name: 'aliyun' = 'aliyun';
  private accessKeyId: string;
  private accessKeySecret: string;
  private appKey: string;

  // 阿里云语音识别 API 端点
  private static readonly API_ENDPOINT =
    'https://nls-gateway-cn-shanghai.aliyuncs.com';

  constructor(config: SpeechProviderConfig) {
    this.accessKeyId = config.accessKeyId || '';
    this.accessKeySecret = config.accessKeySecret || '';
    this.appKey = config.appKey || '';
  }

  validateConfig(): boolean {
    return !!this.accessKeyId && !!this.accessKeySecret && !!this.appKey;
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResponse> {
    const startTime = Date.now();

    if (!this.validateConfig()) {
      throw new Error('Aliyun provider is not configured properly');
    }

    // 将 base64 数据转换为 Buffer
    const audioBuffer = Buffer.from(request.audioData, 'base64');

    // 获取 Token
    const token = await this.getToken();

    // 一句话识别 API (适用于 60 秒以内的音频)
    const url = `${AliyunProvider.API_ENDPOINT}/stream/v1/asr`;

    // 构建请求参数
    const format = this.getAudioFormat(request.audioFormat);
    const sampleRate = this.getSampleRate(request.audioFormat);

    const queryParams = new URLSearchParams({
      appkey: this.appKey,
      format: format,
      sample_rate: sampleRate.toString(),
    });

    // 如果指定了语言
    if (request.language) {
      // 阿里云不需要单独设置语言，默认支持中英文混合识别
    }

    const response = await fetch(`${url}?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': `application/octet-stream`,
        'X-NLS-Token': token,
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Aliyun API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const processingTime = Date.now() - startTime;

    // 检查识别结果
    if (result.status !== 20000000) {
      throw new Error(
        `Aliyun recognition failed: ${result.message || 'Unknown error'}`
      );
    }

    return {
      text: result.result || '',
      provider: 'aliyun',
      processingTime,
      confidence: result.confidence,
    };
  }

  // 获取访问 Token
  private async getToken(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const nonce = crypto.randomUUID();

    // 构建规范化请求
    const params = new Map([
      ['AccessKeyId', this.accessKeyId],
      ['Action', 'CreateToken'],
      ['Format', 'JSON'],
      ['RegionId', 'cn-shanghai'],
      ['SignatureMethod', 'HMAC-SHA1'],
      ['SignatureNonce', nonce],
      ['SignatureVersion', '1.0'],
      ['Timestamp', timestamp],
      ['Version', '2019-02-28'],
    ]);

    // 按字母顺序排序参数
    const sortedParams = Array.from(params.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );

    // 构建规范化查询字符串
    const canonicalQueryString = sortedParams
      .map(
        ([key, value]) =>
          `${this.percentEncode(key)}=${this.percentEncode(value)}`
      )
      .join('&');

    // 构建待签名字符串
    const stringToSign = `GET&${this.percentEncode('/')}&${this.percentEncode(canonicalQueryString)}`;

    // 计算签名
    const signature = crypto
      .createHmac('sha1', `${this.accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');

    // 构建最终 URL
    const finalParams = new URLSearchParams();
    sortedParams.forEach(([key, value]) => finalParams.append(key, value));
    finalParams.append('Signature', signature);

    const tokenUrl = `https://nls-meta.cn-shanghai.aliyuncs.com/?${finalParams.toString()}`;

    const response = await fetch(tokenUrl);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get Aliyun token (${response.status}): ${errorText}`
      );
    }

    const result = await response.json();

    if (!result.Token?.Id) {
      throw new Error('Invalid token response from Aliyun');
    }

    return result.Token.Id;
  }

  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/~/g, '%7E');
  }

  private getAudioFormat(format: string): string {
    const formatMap: Record<string, string> = {
      webm: 'opus',
      'audio/webm': 'opus',
      wav: 'pcm',
      'audio/wav': 'pcm',
      mp3: 'mp3',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      ogg: 'ogg',
      'audio/ogg': 'ogg',
    };
    return formatMap[format.toLowerCase()] || 'pcm';
  }

  private getSampleRate(format: string): number {
    // WebM/Opus 通常是 48000Hz，其他格式默认 16000Hz
    if (format.includes('webm') || format.includes('opus')) {
      return 16000; // 阿里云支持 8000 或 16000
    }
    return 16000;
  }
}

// 工厂函数
export function createAliyunProvider(
  config: SpeechProviderConfig
): AliyunProvider {
  return new AliyunProvider(config);
}
