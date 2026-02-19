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

  async sendToolInvocation(request: FrontendToolRequest): Promise<boolean> {
    if (!this.isActive()) return false;

    try {
      const event = {
        type: 'frontend_tool_call',
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        args: request.args,
        agentId: request.agentId,
        sessionId: request.sessionId,
        timestamp: Date.now(),
      };
      this.res.write(`data: ${JSON.stringify(event)}\n\n`);
      return true;
    } catch {
      return false;
    }
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
