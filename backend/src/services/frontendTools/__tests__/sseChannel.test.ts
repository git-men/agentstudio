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
  describe('sendToolInvocation — standard TOOL_CALL events', () => {
    it('should emit TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END in order', async () => {
      const { res, chunks } = createMockResponse();
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
      expect(res.write).toHaveBeenCalledTimes(3);

      const events = chunks.map(chunk => JSON.parse(chunk.replace('data: ', '').trim()));

      expect(events[0].type).toBe('TOOL_CALL_START');
      expect(events[0].toolCallId).toBe('ft_abc123');
      expect(events[0].toolCallName).toBe('rate_response');
      expect(events[0].timestamp).toBeTypeOf('number');

      expect(events[1].type).toBe('TOOL_CALL_ARGS');
      expect(events[1].toolCallId).toBe('ft_abc123');
      const parsedArgs = JSON.parse(events[1].delta);
      expect(parsedArgs).toEqual({ question: 'How was the answer?', maxRating: 5 });

      expect(events[2].type).toBe('TOOL_CALL_END');
      expect(events[2].toolCallId).toBe('ft_abc123');
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

    it('should return false when res.write throws', async () => {
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
      expect(ok).toBe(false);
    });

    it('should use consistent timestamps across all three events', async () => {
      const { res, chunks } = createMockResponse();
      const channel = new SSENotificationChannel('ch-4', 'sess-1', 'agent-1', res);

      await channel.sendToolInvocation({
        toolCallId: 'ft_ts',
        toolName: 'tool',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        args: {},
        createdAt: Date.now(),
      });

      const events = chunks.map(c => JSON.parse(c.replace('data: ', '').trim()));
      const ts = events[0].timestamp;
      expect(events[1].timestamp).toBe(ts);
      expect(events[2].timestamp).toBe(ts);
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
