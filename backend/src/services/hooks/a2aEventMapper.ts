import { AGUIEventType, type AGUIEvent } from '../../engines/types.js';
import type { HookEvent } from '../../types/platformHooks.js';
import type { AguiMappingContext, AguiSessionCounters } from './aguiEventMapper.js';
export { createSessionCounters } from './aguiEventMapper.js';
export type { AguiMappingContext, AguiSessionCounters };

/**
 * Pure mapping function: AGUI event (from A2A adapter) → HookEvent (or null).
 * Identical mapping logic as aguiEventMapper but with source: 'a2a-adapter',
 * satisfying Protocol Agnostic — Principle 2.
 */
export function mapA2AEventToHookEvent(
  event: AGUIEvent,
  context: AguiMappingContext,
  counters: AguiSessionCounters
): HookEvent | null {
  const base = {
    timestamp: new Date().toISOString(),
    source: 'a2a-adapter' as const,
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
          data: { content: '', sender: 'user' },
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
