import { describe, it, expect } from 'vitest';
import {
  CreateAgentSchema,
  UpdateAgentSchema,
  ChatRequestSchema,
  FrontendToolResultSchema,
  ImageSchema,
} from '../agentSchemas';

describe('agentSchemas', () => {
  describe('CreateAgentSchema', () => {
    const validAgent = {
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      systemPrompt: 'You are a helpful assistant.',
      allowedTools: [{ name: 'Read', enabled: true }],
      ui: {
        headerTitle: 'Test',
        headerDescription: 'Test description',
      },
      author: 'tester',
    };

    it('should accept valid agent data', () => {
      const result = CreateAgentSchema.safeParse(validAgent);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const result = CreateAgentSchema.safeParse(validAgent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBe(25);
        expect(result.data.permissionMode).toBe('acceptEdits');
        expect(result.data.model).toBe('sonnet');
        expect(result.data.enabled).toBe(true);
        expect(result.data.tags).toEqual([]);
        expect(result.data.ui.icon).toBe('🤖');
      }
    });

    it('should reject invalid agent ID format', () => {
      const result = CreateAgentSchema.safeParse({ ...validAgent, id: 'Invalid ID!' });
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = CreateAgentSchema.safeParse({ ...validAgent, name: '' });
      expect(result.success).toBe(false);
    });

    it('should accept preset system prompt', () => {
      const result = CreateAgentSchema.safeParse({
        ...validAgent,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: 'extra instructions' },
      });
      expect(result.success).toBe(true);
    });

    it('should accept maxTurns as null (unlimited)', () => {
      const result = CreateAgentSchema.safeParse({ ...validAgent, maxTurns: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxTurns).toBeNull();
      }
    });

    it('should reject maxTurns > 100', () => {
      const result = CreateAgentSchema.safeParse({ ...validAgent, maxTurns: 200 });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateAgentSchema', () => {
    it('should accept partial updates', () => {
      const result = UpdateAgentSchema.safeParse({ name: 'Updated Name' });
      expect(result.success).toBe(true);
    });

    it('should accept empty object', () => {
      const result = UpdateAgentSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('ChatRequestSchema', () => {
    it('should accept valid chat request', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Hello',
        agentId: 'test-agent',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty message without images', () => {
      const result = ChatRequestSchema.safeParse({
        message: '   ',
        agentId: 'test-agent',
      });
      expect(result.success).toBe(false);
    });

    it('should accept empty message with images', () => {
      const result = ChatRequestSchema.safeParse({
        message: '',
        agentId: 'test-agent',
        images: [{
          id: 'img-1',
          data: 'base64data',
          mediaType: 'image/png',
        }],
      });
      expect(result.success).toBe(true);
    });

    it('should apply default channel and outputFormat', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Hello',
        agentId: 'test-agent',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.channel).toBe('web');
        expect(result.data.outputFormat).toBe('default');
      }
    });

    it('should accept agui output format', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Hello',
        agentId: 'test-agent',
        outputFormat: 'agui',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('FrontendToolResultSchema', () => {
    it('should accept valid tool result', () => {
      const result = FrontendToolResultSchema.safeParse({
        toolCallId: 'call-123',
        result: 'success',
        sessionId: 'session-1',
        agentId: 'agent-1',
      });
      expect(result.success).toBe(true);
    });

    it('should accept object result', () => {
      const result = FrontendToolResultSchema.safeParse({
        toolCallId: 'call-123',
        result: { status: 'ok', data: [1, 2, 3] },
        sessionId: 'session-1',
        agentId: 'agent-1',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = FrontendToolResultSchema.safeParse({
        toolCallId: 'call-123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ImageSchema', () => {
    it('should accept valid image', () => {
      const result = ImageSchema.safeParse({
        id: 'img-1',
        data: 'base64data',
        mediaType: 'image/png',
      });
      expect(result.success).toBe(true);
    });

    it('should reject unsupported media type', () => {
      const result = ImageSchema.safeParse({
        id: 'img-1',
        data: 'base64data',
        mediaType: 'image/bmp',
      });
      expect(result.success).toBe(false);
    });
  });
});
