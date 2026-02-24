import type { EventTypeInfo, HookEvent } from '../../types/platformHooks.js';

const EVENT_TYPES: EventTypeInfo[] = [
  // ─── Before Events (interceptable, phase 0) ───────────────────────────────
  {
    type: 'message.pre_send',
    description: 'Before user message is sent to the AI engine (interceptable)',
    category: 'message',
    phase: 0,
    dataSchema: {
      message: 'string',
      images: 'ImageData[]?',
      sender: 'string',
      channel: 'string?',
    },
    blocking: true,
  },
  {
    type: 'tool.pre_use',
    description: 'Before a tool call is executed (interceptable)',
    category: 'tool',
    phase: 0,
    dataSchema: {
      toolName: 'string',
      toolInput: 'Record<string,unknown>?',
      toolId: 'string?',
    },
    blocking: true,
  },
  {
    type: 'run.pre_start',
    description: 'Before a new agent session begins (interceptable)',
    category: 'run',
    phase: 0,
    dataSchema: {
      engine: 'string',
      agentId: 'string?',
      projectId: 'string?',
    },
    blocking: true,
  },
  // ─── After Events (observational, phase 1+) ───────────────────────────────
  {
    type: 'run.start',
    description: 'Agent execution started',
    category: 'run',
    phase: 1,
    dataSchema: { engine: 'string', prompt: 'string?' },
  },
  {
    type: 'run.end',
    description: 'Agent execution completed successfully',
    category: 'run',
    phase: 1,
    dataSchema: { engine: 'string', durationMs: 'number', messageCount: 'number?' },
  },
  {
    type: 'run.error',
    description: 'Agent execution encountered an error',
    category: 'run',
    phase: 1,
    dataSchema: { engine: 'string', error: 'string', code: 'string?' },
  },
  {
    type: 'message.user_submit',
    description: 'User or caller submitted a message',
    category: 'message',
    phase: 1,
    dataSchema: { content: 'string', sender: 'string' },
  },
  {
    type: 'message.agent_reply',
    description: 'Agent completed a reply',
    category: 'message',
    phase: 1,
    dataSchema: { contentLength: 'number', toolCalls: 'number?' },
  },
  {
    type: 'tool.call_start',
    description: 'Tool execution started',
    category: 'tool',
    phase: 4,
    dataSchema: { toolName: 'string', toolId: 'string?' },
  },
  {
    type: 'tool.call_end',
    description: 'Tool execution completed',
    category: 'tool',
    phase: 4,
    dataSchema: { toolName: 'string', success: 'boolean', toolId: 'string?' },
  },
  {
    type: 'task.submit',
    description: 'Async task submitted',
    category: 'task',
    phase: 4,
    dataSchema: { taskId: 'string', taskType: 'string' },
  },
  {
    type: 'task.complete',
    description: 'Async task completed',
    category: 'task',
    phase: 4,
    dataSchema: { taskId: 'string', durationMs: 'number' },
  },
  {
    type: 'task.fail',
    description: 'Async task failed',
    category: 'task',
    phase: 4,
    dataSchema: { taskId: 'string', error: 'string' },
  },
  {
    type: 'schedule.trigger',
    description: 'Scheduled task triggered',
    category: 'schedule',
    phase: 4,
    dataSchema: { scheduleId: 'string', scheduleName: 'string' },
  },
  {
    type: 'schedule.complete',
    description: 'Scheduled task completed',
    category: 'schedule',
    phase: 4,
    dataSchema: { scheduleId: 'string', durationMs: 'number' },
  },
  {
    type: 'system.tunnel.connect',
    description: 'Tunnel connection established',
    category: 'system',
    phase: 4,
    dataSchema: { tunnelUrl: 'string' },
  },
  {
    type: 'system.tunnel.disconnect',
    description: 'Tunnel connection lost',
    category: 'system',
    phase: 4,
    dataSchema: { reason: 'string?' },
  },
];

const eventTypeMap = new Map(EVENT_TYPES.map(e => [e.type, e]));

export function getEventTypes(): EventTypeInfo[] {
  return [...EVENT_TYPES];
}

export function isValidEventType(type: string): boolean {
  return eventTypeMap.has(type);
}

export function getEventTypeInfo(type: string): EventTypeInfo | undefined {
  return eventTypeMap.get(type);
}

export function isBeforeEvent(type: string): boolean {
  const info = eventTypeMap.get(type);
  return info?.blocking === true;
}

/**
 * Generate a synthetic event for testing purposes.
 * Fills data fields with placeholder values matching the event's schema.
 */
export function getSyntheticEvent(type: string): HookEvent | null {
  const info = eventTypeMap.get(type);
  if (!info) return null;

  const data: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(info.dataSchema)) {
    const isOptional = schema.endsWith('?');
    const baseType = isOptional ? schema.slice(0, -1) : schema;
    switch (baseType) {
      case 'string':
        data[key] = `test-${key}`;
        break;
      case 'number':
        data[key] = 0;
        break;
      case 'boolean':
        data[key] = true;
        break;
    }
  }

  return {
    type,
    timestamp: new Date().toISOString(),
    source: 'HookTestRunner',
    data,
    sessionId: 'test-session',
    projectId: 'test-project',
  };
}
