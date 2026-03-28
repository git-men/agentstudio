/**
 * WeChat Work HITL Client
 *
 * Communicates with hitl.woa.com to send/receive messages from 企业微信
 */

import type {
  HitlSendPayload,
  HitlSendResponse,
  HitlPollResponse,
  HitlReply,
  WecomConfig,
} from '../types/wecom.js';

export class WecomHitlClient {
  private serviceUrl: string;
  private defaultChatId: string;
  private defaultTimeout: number;
  private projectName: string;

  constructor(config: WecomConfig) {
    this.serviceUrl = config.serviceUrl;
    this.defaultChatId = config.chatId;
    this.defaultTimeout = config.timeout;
    this.projectName = config.projectName;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.serviceUrl}${path}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HITL ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async sendMessage(
    message: string,
    opts: {
      chatId?: string;
      waitReply?: boolean;
      images?: string[];
      timeout?: number;
    } = {},
  ): Promise<HitlSendResponse> {
    const payload: HitlSendPayload = {
      message,
      chat_type: 'group',
      chat_id: opts.chatId || this.defaultChatId,
      wait_reply: opts.waitReply ?? false,
      images: opts.images,
      project_name: this.projectName,
      timeout: opts.timeout || this.defaultTimeout,
    };

    return this.request<HitlSendResponse>('/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async pollReply(sessionId: string): Promise<HitlPollResponse> {
    return this.request<HitlPollResponse>(`/poll/${sessionId}`);
  }

  async markTimeout(sessionId: string): Promise<void> {
    await this.request(`/session/${sessionId}/timeout`, { method: 'POST' }).catch(() => {});
  }

  /**
   * Send a message and poll until a reply is received or timeout
   */
  async sendAndWaitReply(
    message: string,
    pollIntervalMs: number,
    timeoutSec: number,
    opts: { chatId?: string } = {},
  ): Promise<HitlReply | null> {
    const resp = await this.sendMessage(message, {
      ...opts,
      waitReply: true,
      timeout: timeoutSec,
    });

    if (!resp.success || !resp.session_id) {
      throw new Error(`sendAndWaitReply failed: ${resp.error || 'no session_id'}`);
    }

    const deadline = Date.now() + timeoutSec * 1000;

    while (Date.now() < deadline) {
      await this.sleep(pollIntervalMs);
      try {
        const poll = await this.pollReply(resp.session_id);
        if (poll.has_reply && poll.replies.length > 0) {
          return poll.replies[0];
        }
      } catch (err: any) {
        if (err.message?.includes('404')) return null;
        console.error('[wecom-hitl] poll error:', err.message);
      }
    }

    await this.markTimeout(resp.session_id);
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
