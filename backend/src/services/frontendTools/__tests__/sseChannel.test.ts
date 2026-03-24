import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSENotificationChannel, generateSSEChannelId } from '../sseChannel.js';
import type { FrontendToolRequest } from '../types.js';

function createMockResponse() {
  const chunks: string[] = [];
  const res: any = {
    destroyed: false,
    writableEnded: false,
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(() => { res.writableEnded = true; }),
    on: vi.fn(),
  };
  return { res, chunks };
}

describe('SSENotificationChannel', () => {
  describe('sendToolInvocation — no-op (frontend reads from main event stream)', () => {
    it('should return true for active channel without writing SSE events', async () => {
      const { res } = createMockResponse();
      const channel = new SSENotificationChannel('ch-1', 'sess-1', 'agent-1', res);

      const request: FrontendToolRequest = {
        toolCallId: 'ft_abc123',
        toolName: 'rate_response',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        args: { question: 'How was the answer?', maxRating: 5 },
        createdAt: Date.now(),
      };

      const ok = await channel.sendToolInvocation(request);
      expect(ok).toBe(true);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('should return false when channel is closed', async () => {
      const { res } = createMockResponse();
      const channel = new SSENotificationChannel('ch-2', 'sess-1', 'agent-1', res);
      channel.close();

      const ok = await channel.sendToolInvocation({
        toolCallId: 'ft_closed',
        toolName: 'test',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        args: {},
        createdAt: Date.now(),
      });
      expect(ok).toBe(false);
      expect(res.write).not.toHaveBeenCalled();
    });

    it('should return true even when res.write would throw (no write occurs)', async () => {
      const { res } = createMockResponse();
      res.write.mockImplementation(() => { throw new Error('connection gone'); });
      const channel = new SSENotificationChannel('ch-3', 'sess-1', 'agent-1', res);

      const ok = await channel.sendToolInvocation({
        toolCallId: 'ft_err',
        toolName: 'test',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        args: { key: 'value' },
        createdAt: Date.now(),
      });
      expect(ok).toBe(true);
    });
  });

  describe('generateSSEChannelId', () => {
    it('should generate unique IDs with sse_ prefix', () => {
      const a = generateSSEChannelId();
      const b = generateSSEChannelId();
      expect(a).toMatch(/^sse_/);
      expect(b).toMatch(/^sse_/);
      expect(a).not.toBe(b);
    });
  });
});
