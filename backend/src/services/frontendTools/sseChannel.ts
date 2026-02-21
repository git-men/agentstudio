/**
 * SSE Notification Channel for Frontend Tools
 *
 * Sends frontend tool invocations to the browser via Server-Sent Events.
 */

import type { Response } from 'express';
import type { FrontendToolRequest, NotificationChannel, ChannelType } from './types.js';

export class SSENotificationChannel implements NotificationChannel {
  type: ChannelType = 'sse';
  channelId: string;
  sessionId: string;
  agentId: string;
  createdAt: number;

  private res: Response;
  private closed = false;
  private onCloseCallback?: () => void;

  constructor(
    channelId: string,
    sessionId: string,
    agentId: string,
    res: Response,
    onClose?: () => void,
  ) {
    this.channelId = channelId;
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.res = res;
    this.createdAt = Date.now();
    this.onCloseCallback = onClose;

    res.on('close', () => {
      this.closed = true;
      try { this.onCloseCallback?.(); } catch { /* ignore */ }
    });
  }

  isActive(): boolean {
    return !this.closed && !this.res.destroyed;
  }

  async sendToolInvocation(_request: FrontendToolRequest): Promise<boolean> {
    // No-op: the frontend now identifies frontend tools directly from the
    // main AGUI / SDK event stream (by tool name), so a separate notification
    // channel event is no longer needed. The channel is still kept alive for
    // session lifecycle management (close → cancel pending bridge calls).
    return this.isActive();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (!this.res.writableEnded) this.res.end();
    } catch { /* ignore — connection may already be gone */ }
  }
}

export function generateSSEChannelId(): string {
  return `sse_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
