/**
 * Mock SDK Query - Drop-in replacement for Claude Agent SDK's query() function
 * 
 * When MOCK_SDK=true, this replaces the real `query()` from @anthropic-ai/claude-agent-sdk.
 * The returned object matches the SDK's interface:
 *   - AsyncIterable<SDKMessage> (for iterating over messages)
 *   - interrupt() method
 *   - supportedModels() method
 * 
 * Scenarios are loaded from JSONL files in testing/scenarios/.
 * Message content determines which scenario is used.
 * 
 * Usage:
 *   import { createMockQuery, isMockEnabled } from '../testing/mockSdkQuery.js';
 *   
 *   const q = isMockEnabled()
 *     ? createMockQuery({ prompt: messageQueue, options: queryOptions })
 *     : query({ prompt: messageQueue, options: queryOptions });
 */

import { getScenarioLoader } from './scenarioLoader.js';

// Re-export the check function
export function isMockEnabled(): boolean {
  return process.env.MOCK_SDK === 'true';
}

export function isRecordEnabled(): boolean {
  return process.env.MOCK_SDK === 'record';
}

/**
 * Mock query result type - matches the SDK's query() return type.
 * 
 * SDK's query() returns an object that is:
 *   1. AsyncIterable<SDKMessage>
 *   2. Has .interrupt() method
 *   3. Has .supportedModels() method
 */
export interface MockQueryResult {
  [Symbol.asyncIterator](): AsyncIterator<Record<string, any>>;
  interrupt: () => Promise<void>;
  supportedModels: () => Promise<Array<{ value: string; displayName: string; description?: string }>>;
}

/**
 * Create a mock query that replays scenarios based on input messages.
 * 
 * The `prompt` parameter is an AsyncIterable that yields user messages.
 * For each message, we match a scenario and replay its SDK messages.
 */
export function createMockQuery(params: {
  prompt: AsyncIterable<string | object>;
  options: Record<string, any>;
}): MockQueryResult {
  const loader = getScenarioLoader();
  const sessionId = `mock-session-${Date.now()}`;
  let aborted = false;
  let currentReplay: AsyncGenerator<Record<string, any>> | null = null;

  const generator = async function* (): AsyncGenerator<Record<string, any>> {
    console.log(`[MockSDK] Mock query started, sessionId: ${sessionId}`);
    console.log(`[MockSDK] Options:`, {
      cwd: params.options.cwd,
      model: params.options.model,
      permissionMode: params.options.permissionMode,
    });

    // Iterate over incoming user messages
    for await (const input of params.prompt) {
      if (aborted) {
        console.log(`[MockSDK] Aborted, stopping`);
        return;
      }

      // Extract text content from various input formats
      const message = extractMessageText(input);
      console.log(`[MockSDK] Received message: "${message}"`);

      // Match scenario
      const scenario = loader.matchScenario(message);
      if (!scenario) {
        console.warn(`[MockSDK] No scenario matched, using inline fallback`);
        yield* inlineFallbackScenario(sessionId);
        continue;
      }

      // Replay the matched scenario
      console.log(`[MockSDK] Replaying scenario: "${scenario.meta.name}"`);
      currentReplay = loader.replay(scenario, sessionId);

      for await (const msg of currentReplay) {
        if (aborted) {
          console.log(`[MockSDK] Aborted during replay`);
          return;
        }
        yield msg;
      }

      currentReplay = null;
    }

    console.log(`[MockSDK] Mock query completed (input stream ended)`);
  };

  const iterable = generator();

  return {
    [Symbol.asyncIterator]() {
      return iterable[Symbol.asyncIterator]();
    },
    interrupt: async () => {
      console.log(`[MockSDK] Interrupt requested`);
      aborted = true;
    },
    supportedModels: async () => {
      return [
        { value: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4 (Mock)', description: 'Mock model for testing' },
        { value: 'claude-opus-4-20250514', displayName: 'Claude Opus 4 (Mock)', description: 'Mock model for testing' },
      ];
    },
  };
}

/**
 * Extract plain text from various message input formats.
 * The SDK accepts different input types through the prompt AsyncIterable.
 */
function extractMessageText(input: string | object): string {
  if (typeof input === 'string') {
    return input;
  }

  // Handle Anthropic-style message objects: { content: [{ type: 'text', text: '...' }] }
  const inputObj = input as Record<string, any>;
  
  if (Array.isArray(inputObj.content)) {
    const textBlock = inputObj.content.find((block: any) => block.type === 'text');
    if (textBlock?.text) return textBlock.text;
  }

  if (typeof inputObj.content === 'string') {
    return inputObj.content;
  }

  if (typeof inputObj.text === 'string') {
    return inputObj.text;
  }

  if (typeof inputObj.message === 'string') {
    return inputObj.message;
  }

  // Last resort: stringify
  return JSON.stringify(input).slice(0, 200);
}

/**
 * Inline fallback scenario when no JSONL file matches.
 * Returns a minimal valid conversation.
 */
async function* inlineFallbackScenario(sessionId: string): AsyncGenerator<Record<string, any>> {
  yield {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: ['Read', 'Write'],
    mcp_servers: [],
    model: 'claude-sonnet-4-20250514',
    permissionMode: 'bypassPermissions',
  };

  const text = '[Mock] 这是一个模拟响应。要触发特定场景，请使用以下关键词：auto-compact, /compact, use-tool';

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'message_start',
      message: { id: `msg_fallback_${Date.now()}`, role: 'assistant', content: [] },
    },
  };

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    },
  };

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    },
  };

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: { type: 'content_block_stop', index: 0 },
  };

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  };

  yield {
    type: 'stream_event',
    session_id: sessionId,
    event: { type: 'message_stop' },
  };

  yield {
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: `msg_fallback_${Date.now()}`,
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
    parent_tool_use_id: null,
  };

  yield {
    type: 'result',
    subtype: 'success',
    session_id: sessionId,
    duration_ms: 500,
    duration_api_ms: 300,
    is_error: false,
    num_turns: 1,
    result: 'Mock fallback completed.',
    total_cost_usd: 0,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
