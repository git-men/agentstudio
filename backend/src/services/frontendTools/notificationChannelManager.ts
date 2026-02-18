/**
 * Notification Channel Manager
 *
 * Routes frontend tool invocations to the appropriate notification channels
 * (SSE, Slack, WeChat, etc.) based on session affinity.
 *
 * Carried over from the original askUserQuestion module with the interface
 * generalized from UserInputRequest to FrontendToolRequest.
 */

import { EventEmitter } from 'events';
import type { FrontendToolRequest, NotificationChannel } from './types.js';

class NotificationChannelManager extends EventEmitter {
  private channels: Map<string, NotificationChannel[]> = new Map();

  registerChannel(channel: NotificationChannel): void {
    const { sessionId } = channel;
    if (!this.channels.has(sessionId)) {
      this.channels.set(sessionId, []);
    }
    const list = this.channels.get(sessionId)!;
    if (!list.find(c => c.channelId === channel.channelId)) {
      list.push(channel);
    }
  }

  unregisterChannel(channelId: string): void {
    for (const [sessionId, channels] of this.channels.entries()) {
      const idx = channels.findIndex(c => c.channelId === channelId);
      if (idx !== -1) {
        channels.splice(idx, 1);
        if (channels.length === 0) this.channels.delete(sessionId);
        return;
      }
    }
  }

  updateChannelSession(channelId: string, newSessionId: string): void {
    for (const [sessionId, channels] of this.channels.entries()) {
      const channel = channels.find(c => c.channelId === channelId);
      if (channel) {
        const idx = channels.indexOf(channel);
        channels.splice(idx, 1);
        if (channels.length === 0) this.channels.delete(sessionId);

        (channel as any).sessionId = newSessionId;

        if (!this.channels.has(newSessionId)) {
          this.channels.set(newSessionId, []);
        }
        this.channels.get(newSessionId)!.push(channel);
        return;
      }
    }
  }

  async sendToolInvocation(request: FrontendToolRequest): Promise<boolean> {
    const { sessionId } = request;
    const channels = this.channels.get(sessionId);
    if (!channels || channels.length === 0) return false;

    const active = channels.filter(c => c.isActive());
    if (active.length !== channels.length) {
      this.channels.set(sessionId, active);
    }
    if (active.length === 0) return false;

    let any = false;
    for (const ch of active) {
      try {
        if (await ch.sendToolInvocation(request)) any = true;
      } catch { /* swallow per-channel errors */ }
    }
    return any;
  }

  getChannelsForSession(sessionId: string): NotificationChannel[] {
    return this.channels.get(sessionId) || [];
  }

  hasActiveChannel(sessionId: string): boolean {
    const channels = this.channels.get(sessionId);
    return !!channels && channels.some(c => c.isActive());
  }

  getStats(): { totalSessions: number; totalChannels: number } {
    let total = 0;
    for (const chs of this.channels.values()) total += chs.length;
    return { totalSessions: this.channels.size, totalChannels: total };
  }
}

export const notificationChannelManager = new NotificationChannelManager();
