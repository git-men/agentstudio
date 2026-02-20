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
      const now = Date.now();

      // Emit standard AG-UI TOOL_CALL events so the frontend can handle
      // frontend tools identically to backend tools — distinguished only
      // by checking the local tool registry at the client side.
      const start = { type: 'TOOL_CALL_START', toolCallId: request.toolCallId, toolCallName: request.toolName, timestamp: now };
      const args  = { type: 'TOOL_CALL_ARGS',  toolCallId: request.toolCallId, delta: JSON.stringify(request.args), timestamp: now };
      const end   = { type: 'TOOL_CALL_END',   toolCallId: request.toolCallId, timestamp: now };

      this.res.write(`data: ${JSON.stringify(start)}\n\n`);
      this.res.write(`data: ${JSON.stringify(args)}\n\n`);
      this.res.write(`data: ${JSON.stringify(end)}\n\n`);
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
