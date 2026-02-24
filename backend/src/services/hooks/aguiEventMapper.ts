import { AGUIEventType, type AGUIEvent } from '../../engines/types.js';
import type { HookEvent } from '../../types/platformHooks.js';

export interface AguiMappingContext {
  sessionId: string;
  projectId?: string;
  agentId?: string;
  engine: string;
}

/**
 * Tracks accumulated counters within a single AGUI session for enriching
 * run.end and message.agent_reply events.
 */
export interface AguiSessionCounters {
  startTime: number;
  messageCount: number;
  contentLength: number;
  toolCallCount: number;
  lastUserMessage: string;
  currentToolName: string;
}

export function createSessionCounters(): AguiSessionCounters {
  return {
    startTime: Date.now(),
    messageCount: 0,
    contentLength: 0,
    toolCallCount: 0,
    lastUserMessage: '',
    currentToolName: '',
  };
}

/**
 * Pure mapping function: AGUI event → HookEvent (or null if unmapped).
 * Updates counters in place as a side effect for accumulative fields.
 */
export function mapAguiEventToHookEvent(
  event: AGUIEvent,
  context: AguiMappingContext,
  counters: AguiSessionCounters
): HookEvent | null {
  const base = {
    timestamp: new Date().toISOString(),
    source: 'agui-route' as const,
    sessionId: context.sessionId,
    projectId: context.projectId,
    agentId: context.agentId,
  };

  switch (event.type) {
    case AGUIEventType.RUN_STARTED:
      counters.startTime = Date.now();
      return {
        ...base,
        type: 'run.start',
        data: { engine: context.engine },
      };

    case AGUIEventType.RUN_FINISHED:
      return {
        ...base,
        type: 'run.end',
        data: {
          engine: context.engine,
          durationMs: Date.now() - counters.startTime,
          messageCount: counters.messageCount,
        },
      };

    case AGUIEventType.RUN_ERROR:
      return {
        ...base,
        type: 'run.error',
        data: {
          engine: context.engine,
          error: 'error' in event ? (event as any).error : 'Unknown error',
          code: 'code' in event ? (event as any).code : undefined,
        },
      };

    case AGUIEventType.TEXT_MESSAGE_START: {
      const role = 'role' in event ? (event as any).role : undefined;
      if (role === 'user') {
        counters.messageCount++;
        return {
          ...base,
          type: 'message.user_submit',
          data: {
            content: counters.lastUserMessage || '',
            sender: 'user',
          },
        };
      }
      return null;
    }

    case AGUIEventType.TEXT_MESSAGE_CONTENT: {
      const content = 'content' in event ? (event as any).content : '';
      counters.contentLength += (typeof content === 'string' ? content.length : 0);
      return null;
    }

    case AGUIEventType.TEXT_MESSAGE_END: {
      counters.messageCount++;
      return {
        ...base,
        type: 'message.agent_reply',
        data: {
          contentLength: counters.contentLength,
          toolCalls: counters.toolCallCount,
        },
      };
    }

    case AGUIEventType.TOOL_CALL_START: {
      counters.toolCallCount++;
      const toolName = 'toolName' in event ? (event as any).toolName : 'unknown';
      const toolId = 'toolCallId' in event ? (event as any).toolCallId : undefined;
      counters.currentToolName = toolName;
      return {
        ...base,
        type: 'tool.call_start',
        data: { toolName, toolId },
      };
    }

    case AGUIEventType.TOOL_CALL_END: {
      const toolId = 'toolCallId' in event ? (event as any).toolCallId : undefined;
      return {
        ...base,
        type: 'tool.call_end',
        data: {
          toolName: counters.currentToolName || 'unknown',
          success: true,
          toolId,
        },
      };
    }

    default:
      return null;
  }
}
