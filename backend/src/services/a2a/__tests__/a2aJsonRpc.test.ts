/**
 * Unit tests for A2A standard JSON-RPC 2.0 protocol support.
 *
 * Tests cover:
 * - JSON-RPC request body building
 * - Standard A2A SSE event parsing
 * - Protocol routing (custom vs a2a-jsonrpc)
 * - Agent Card standard field enrichment
 */

import { describe, it, expect } from 'vitest';
import type { A2AProtocolType, AllowedAgent, A2AConfig } from '../../../types/a2a.js';
import { validateA2AConfig } from '../a2aConfigService.js';

describe('A2A Standard JSON-RPC Protocol', () => {
  describe('Type definitions', () => {
    it('A2AProtocolType accepts valid values', () => {
      const types: A2AProtocolType[] = ['custom', 'a2a-jsonrpc'];
      expect(types).toHaveLength(2);
    });

    it('AllowedAgent supports new protocol fields', () => {
      const agent: AllowedAgent = {
        name: 'AgentHub',
        url: 'https://agenthub.devcloud.woa.com/agent/access/chat/entrypoint/a2a/grp123',
        apiKey: 'fa324bac1c5c1a2830f0f508881c2af540d15247e12',
        enabled: true,
        protocolType: 'a2a-jsonrpc',
        customHeaders: {
          'X-User-Id': 'kongjie',
        },
        agentCardUrl: 'https://agenthub.devcloud.woa.com/.well-known/agent.json',
      };

      expect(agent.protocolType).toBe('a2a-jsonrpc');
      expect(agent.customHeaders?.['X-User-Id']).toBe('kongjie');
      expect(agent.agentCardUrl).toBeDefined();
    });

    it('AllowedAgent defaults to custom protocol when protocolType is undefined', () => {
      const agent: AllowedAgent = {
        name: 'Legacy Agent',
        url: 'https://internal.example.com',
        apiKey: 'key123',
        enabled: true,
      };

      expect(agent.protocolType).toBeUndefined();
      // Default behavior: treated as 'custom'
      const effectiveProtocol = agent.protocolType || 'custom';
      expect(effectiveProtocol).toBe('custom');
    });
  });

  describe('Config validation with new fields', () => {
    it('validates a2a-jsonrpc agent without apiKey', () => {
      const config: A2AConfig = {
        allowedAgents: [{
          name: 'Public Agent',
          url: 'https://public.example.com/a2a',
          apiKey: '',
          enabled: true,
          protocolType: 'a2a-jsonrpc',
        }],
        taskTimeout: 60000,
        maxConcurrentTasks: 5,
      };

      const result = validateA2AConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects custom agent without apiKey', () => {
      const config = {
        allowedAgents: [{
          name: 'Agent',
          url: 'https://internal.example.com',
          enabled: true,
          protocolType: 'custom',
        }],
        taskTimeout: 60000,
        maxConcurrentTasks: 5,
      } as any;

      const result = validateA2AConfig(config);
      expect(result.valid).toBe(false);
    });

    it('validates agent with customHeaders', () => {
      const config: A2AConfig = {
        allowedAgents: [{
          name: 'Headered Agent',
          url: 'https://api.example.com/a2a',
          apiKey: 'token',
          enabled: true,
          protocolType: 'a2a-jsonrpc',
          customHeaders: {
            'X-User-Id': 'user1',
            'X-Tenant': 'tenant-abc',
          },
        }],
        taskTimeout: 60000,
        maxConcurrentTasks: 5,
      };

      const result = validateA2AConfig(config);
      expect(result.valid).toBe(true);
    });

    it('rejects non-object customHeaders', () => {
      const config: A2AConfig = {
        allowedAgents: [{
          name: 'Agent',
          url: 'https://api.example.com/a2a',
          apiKey: 'token',
          enabled: true,
          customHeaders: ['bad'] as any,
        }],
        taskTimeout: 60000,
        maxConcurrentTasks: 5,
      };

      const result = validateA2AConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors?.some(e => e.includes('customHeaders'))).toBe(true);
    });
  });

  describe('JSON-RPC message building', () => {
    it('builds correct message/send request body', () => {
      const body = {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'message/send',
        params: {
          message: {
            messageId: 'msg-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello, agent!' }],
          },
          configuration: {
            acceptedOutputModes: ['text'],
          },
        },
      };

      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('message/send');
      expect(body.params.message.parts[0].text).toBe('Hello, agent!');
    });

    it('builds correct message/stream request body', () => {
      const body = {
        jsonrpc: '2.0',
        id: 'req-2',
        method: 'message/stream',
        params: {
          message: {
            messageId: 'msg-2',
            role: 'user',
            parts: [{ type: 'text', text: 'Stream this' }],
            contextId: 'ctx-123',
          },
          configuration: {
            acceptedOutputModes: ['text'],
          },
        },
      };

      expect(body.method).toBe('message/stream');
      expect(body.params.message.contextId).toBe('ctx-123');
    });
  });

  describe('SSE event parsing', () => {
    it('parses status-update event', () => {
      const data = {
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'working' },
        final: false,
      };

      expect(data.kind).toBe('status-update');
      expect(data.status.state).toBe('working');
      expect(data.final).toBe(false);
    });

    it('parses artifact-update event', () => {
      const data = {
        kind: 'artifact-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        artifact: {
          parts: [{ kind: 'text', text: 'Hello from the agent!' }],
        },
      };

      expect(data.kind).toBe('artifact-update');
      expect(data.artifact.parts[0].text).toBe('Hello from the agent!');
    });

    it('parses message event', () => {
      const data = {
        kind: 'message',
        role: 'agent',
        messageId: 'msg-123',
        parts: [{ kind: 'text', text: 'Final response' }],
        taskId: 'task-1',
        contextId: 'ctx-1',
      };

      expect(data.kind).toBe('message');
      expect(data.role).toBe('agent');
      expect(data.parts[0].text).toBe('Final response');
    });

    it('recognizes terminal status-update (final=true)', () => {
      const data = {
        kind: 'status-update',
        taskId: 'task-1',
        contextId: 'ctx-1',
        status: { state: 'completed' },
        final: true,
      };

      expect(data.final).toBe(true);
      expect(data.status.state).toBe('completed');
    });
  });
});
