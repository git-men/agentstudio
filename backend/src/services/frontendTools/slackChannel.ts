/**
 * Slack Notification Channel for Frontend Tools
 *
 * Sends frontend tool invocations to Slack as interactive Block Kit messages.
 */

import type { FrontendToolRequest, NotificationChannel, ChannelType } from './types.js';
import { SlackClient } from '../slackClient.js';

export class SlackNotificationChannel implements NotificationChannel {
  type: ChannelType = 'slack';
  channelId: string;
  sessionId: string;
  agentId: string;
  createdAt: number;

  private slackClient: SlackClient;
  private slackChannelId: string;
  private threadTs: string;
  private active = true;

  constructor(
    slackClient: SlackClient,
    slackChannelId: string,
    threadTs: string,
    sessionId: string,
    agentId: string,
  ) {
    this.slackClient = slackClient;
    this.slackChannelId = slackChannelId;
    this.threadTs = threadTs;
    this.channelId = `slack_${slackChannelId}_${threadTs}`;
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.createdAt = Date.now();
  }

  isActive(): boolean {
    return this.active;
  }

  async sendToolInvocation(request: FrontendToolRequest): Promise<boolean> {
    if (!this.isActive()) return false;

    try {
      const blocks = this.buildBlocks(request);
      await this.slackClient.postMessage({
        channel: this.slackChannelId,
        thread_ts: this.threadTs,
        text: `🎤 AI needs your input (${request.toolName})`,
        blocks,
      });
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.active = false;
  }

  private buildBlocks(request: FrontendToolRequest): any[] {
    let argsText = JSON.stringify(request.args, null, 2);
    const MAX_MRKDWN_LEN = 2900;
    const prefix = `Tool \`${request.toolName}\` needs your input.\n\nArguments:\n\`\`\``;
    const suffix = '```';
    const available = MAX_MRKDWN_LEN - prefix.length - suffix.length;
    if (argsText.length > available) {
      argsText = argsText.substring(0, available - 12) + '\n… truncated';
    }

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🎤 ${request.toolName}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${prefix}${argsText}${suffix}`,
        },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📝 Reply to this message with your response | Tool ID: \`${request.toolCallId}\``,
          },
        ],
      },
    ];
    return blocks;
  }
}

export function generateSlackChannelId(slackChannelId: string, threadTs: string): string {
  return `slack_${slackChannelId}_${threadTs}`;
}
