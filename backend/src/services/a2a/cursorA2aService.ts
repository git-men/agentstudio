/**
 * Cursor A2A Service
 * 
 * Provides A2A protocol support for the Cursor engine.
 * This service bridges Cursor CLI's AGUI output to the A2A protocol,
 * enabling Cursor to participate in agent-to-agent communication.
 * 
 * Features:
 * - Synchronous message handling (message/send)
 * - Streaming message handling (message/stream)
 * - Task management for async operations
 * - Agent Card generation for Cursor capabilities
 */

import { v4 as uuidv4 } from 'uuid';
import { cursorEngine } from '../../engines/cursor/index.js';
import { 
  CursorA2AAdapter, 
  A2AStreamingResponse,
  A2ATask,
  A2AMessage,
  A2ATaskState,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
} from '../../engines/cursor/a2aAdapter.js';
import type { AGUIEvent, EngineConfig } from '../../engines/types.js';

// =============================================================================
// Types
// =============================================================================

export interface CursorA2AMessageParams {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    historyLength?: number;
    blocking?: boolean;
  };
  metadata?: Record<string, any>;
}

export interface CursorA2AConfig {
  workspace: string;
  model?: string;
  sessionId?: string;
  timeout?: number;
  requestId?: string | number;
  contextId?: string;
  taskId?: string;
}

export interface CursorA2AResult {
  task: A2ATask;
  responseText: string;
  sessionId: string;
}

// =============================================================================
// Cursor A2A Service
// =============================================================================

/**
 * Execute a Cursor request and return A2A-formatted response (non-streaming)
 */
export async function executeCursorA2AQuery(
  params: CursorA2AMessageParams,
  config: CursorA2AConfig
): Promise<CursorA2AResult> {
  const { message } = params;
  const { workspace, model, sessionId, timeout, requestId, contextId, taskId } = config;

  // Extract text from message parts
  const messageText = message.parts
    .filter(p => p.kind === 'text')
    .map(p => (p as any).text)
    .join('\n');

  if (!messageText) {
    throw new Error('Message must contain at least one text part');
  }

  // Create A2A adapter
  const adapter = new CursorA2AAdapter({
    taskId: taskId || message.taskId || uuidv4(),
    contextId: contextId || message.contextId || uuidv4(),
    requestId: requestId || uuidv4(),
  });

  // Collect all events
  const events: AGUIEvent[] = [];

  // Build engine config
  const engineConfig: EngineConfig = {
    type: 'cursor',
    workspace,
    model: model || 'auto',
    sessionId,
    timeout: timeout || 600000, // 10 minutes default
  };

  // Execute Cursor request
  const result = await cursorEngine.sendMessage(
    messageText,
    engineConfig,
    (event: AGUIEvent) => {
      events.push(event);
      // Convert in real-time for logging
      adapter.convertEvent(event);
    }
  );

  return {
    task: adapter.createTask(),
    responseText: adapter.getResponseText(),
    sessionId: result.sessionId,
  };
}

/**
 * Execute a Cursor request with A2A streaming output
 */
export async function executeCursorA2AStreaming(
  params: CursorA2AMessageParams,
  config: CursorA2AConfig,
  onResponse: (response: A2AStreamingResponse) => void
): Promise<{ taskId: string; contextId: string; sessionId: string }> {
  const { message } = params;
  const { workspace, model, sessionId, timeout, requestId, contextId, taskId } = config;

  // Extract text from message parts
  const messageText = message.parts
    .filter(p => p.kind === 'text')
    .map(p => (p as any).text)
    .join('\n');

  if (!messageText) {
    throw new Error('Message must contain at least one text part');
  }

  // Create A2A adapter
  const adapter = new CursorA2AAdapter({
    taskId: taskId || message.taskId || uuidv4(),
    contextId: contextId || message.contextId || uuidv4(),
    requestId: requestId || uuidv4(),
  });

  // Build engine config
  const engineConfig: EngineConfig = {
    type: 'cursor',
    workspace,
    model: model || 'auto',
    sessionId,
    timeout: timeout || 600000,
  };

  // Execute Cursor request with streaming conversion
  const result = await cursorEngine.sendMessage(
    messageText,
    engineConfig,
    (event: AGUIEvent) => {
      // Convert AGUI event to A2A and stream immediately
      const responses = adapter.convertEvent(event);
      for (const response of responses) {
        onResponse(response);
      }
    }
  );

  return {
    taskId: adapter.getTaskId(),
    contextId: adapter.getContextId(),
    sessionId: result.sessionId,
  };
}

/**
 * Create an A2A Message from user input
 */
export function createUserMessage(
  text: string,
  options?: {
    taskId?: string;
    contextId?: string;
    metadata?: Record<string, any>;
  }
): A2AMessage {
  return {
    kind: 'message',
    role: 'user',
    messageId: uuidv4(),
    taskId: options?.taskId,
    contextId: options?.contextId,
    parts: [{
      kind: 'text',
      text,
    }],
    metadata: options?.metadata,
  };
}

// =============================================================================
// Agent Card Generation for Cursor
// =============================================================================

export interface CursorAgentCardContext {
  a2aAgentId: string;
  projectId: string;
  projectName: string;
  workingDirectory: string;
  baseUrl: string;
}

/**
 * Generate an A2A Agent Card for Cursor engine
 */
export function generateCursorAgentCard(context: CursorAgentCardContext) {
  const models = cursorEngine.getSupportedModels();
  const capabilities = cursorEngine.capabilities;

  return {
    name: 'Cursor Agent',
    description: 'AI-powered coding assistant powered by Cursor CLI. Capable of code editing, file operations, terminal commands, and codebase navigation.',
    url: `${context.baseUrl}/a2a/${context.a2aAgentId}`,
    provider: {
      organization: 'Cursor',
      url: 'https://cursor.com',
    },
    version: '1.0.0',
    documentationUrl: 'https://cursor.com/docs',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
      },
    },
    security: [{ apiKey: [] }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: generateCursorSkills(capabilities),
    // AgentStudio-specific context
    context: {
      a2aAgentId: context.a2aAgentId,
      projectId: context.projectId,
      projectName: context.projectName,
      workingDirectory: context.workingDirectory,
      engineType: 'cursor',
      supportedModels: models.map(m => ({ id: m.id, name: m.name })),
    },
  };
}

/**
 * Generate skills list based on Cursor capabilities
 */
function generateCursorSkills(capabilities: typeof cursorEngine.capabilities) {
  const skills = [];

  // Code editing skill
  skills.push({
    id: 'code-editing',
    name: 'Code Editing',
    description: 'Read, write, and modify code files with intelligent context awareness',
    tags: ['code', 'editing', 'development'],
    examples: [
      'Fix the bug in the login function',
      'Add error handling to the API endpoint',
      'Refactor this class to use async/await',
    ],
    inputModes: ['text/plain'],
    outputModes: ['text/plain', 'application/json'],
  });

  // File operations skill
  skills.push({
    id: 'file-operations',
    name: 'File Operations',
    description: 'Read, write, create, and navigate files in the workspace',
    tags: ['files', 'filesystem', 'navigation'],
    examples: [
      'Show me the contents of package.json',
      'Create a new component file',
      'Find all TypeScript files in src/',
    ],
    inputModes: ['text/plain'],
    outputModes: ['text/plain', 'application/json'],
  });

  // Terminal execution skill
  if (capabilities.features.codeExecution) {
    skills.push({
      id: 'terminal-execution',
      name: 'Terminal Command Execution',
      description: 'Execute shell commands and scripts in the project context',
      tags: ['terminal', 'shell', 'commands'],
      examples: [
        'Run the test suite',
        'Install the missing dependencies',
        'Build the project',
      ],
      inputModes: ['text/plain'],
      outputModes: ['text/plain', 'application/json'],
    });
  }

  // Code search skill
  skills.push({
    id: 'code-search',
    name: 'Code Search & Navigation',
    description: 'Search for patterns, find definitions, and navigate the codebase',
    tags: ['search', 'navigation', 'codebase'],
    examples: [
      'Find all usages of the User class',
      'Search for TODO comments',
      'Where is the authentication logic?',
    ],
    inputModes: ['text/plain'],
    outputModes: ['application/json'],
  });

  // General assistant skill
  skills.push({
    id: 'coding-assistant',
    name: 'General Coding Assistant',
    description: 'Answer questions, explain code, and provide coding guidance',
    tags: ['assistant', 'explanation', 'guidance'],
    examples: [
      'Explain how this function works',
      'What\'s the best practice for handling errors here?',
      'How should I structure this feature?',
    ],
    inputModes: ['text/plain'],
    outputModes: ['text/plain'],
  });

  return skills;
}

// =============================================================================
// JSON-RPC Method Handlers
// =============================================================================

/**
 * Handle message/send JSON-RPC method
 */
export async function handleMessageSend(
  params: CursorA2AMessageParams,
  config: CursorA2AConfig
): Promise<A2ATask | A2AMessage> {
  const blocking = params.configuration?.blocking ?? true;

  if (blocking) {
    // Synchronous - wait for completion
    const result = await executeCursorA2AQuery(params, config);
    return result.task;
  } else {
    // Non-blocking - return immediately with task reference
    const adapter = new CursorA2AAdapter({
      taskId: config.taskId || uuidv4(),
      contextId: config.contextId || uuidv4(),
      requestId: config.requestId || uuidv4(),
    });

    // Start execution in background
    const taskId = adapter.getTaskId();
    const contextId = adapter.getContextId();

    // Schedule execution (don't await)
    executeCursorA2AQuery(params, {
      ...config,
      taskId,
      contextId,
    }).catch(error => {
      console.error(`[CursorA2A] Background task ${taskId} failed:`, error);
    });

    // Return initial task state
    return {
      id: taskId,
      contextId,
      status: {
        state: 'submitted',
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Handle message/stream JSON-RPC method
 * Returns an async generator for SSE streaming
 */
export async function* handleMessageStream(
  params: CursorA2AMessageParams,
  config: CursorA2AConfig
): AsyncGenerator<A2AStreamingResponse, void, unknown> {
  const responseQueue: A2AStreamingResponse[] = [];
  let done = false;
  let error: Error | null = null;

  // Start execution
  const executionPromise = executeCursorA2AStreaming(
    params,
    config,
    (response) => {
      responseQueue.push(response);
    }
  ).then(() => {
    done = true;
  }).catch((err) => {
    error = err;
    done = true;
  });

  // Yield responses as they come
  while (!done || responseQueue.length > 0) {
    if (responseQueue.length > 0) {
      yield responseQueue.shift()!;
    } else if (!done) {
      // Wait a bit for more responses
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  // Check for errors after loop completion
  const finalError = error as Error | null;
  if (finalError) {
    yield createA2AErrorResponse(
      finalError.message,
      A2A_ERROR_CODES.INTERNAL_ERROR,
      config.requestId || 'unknown'
    ) as any;
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  CursorA2AAdapter,
  A2AStreamingResponse,
  A2ATask,
  A2AMessage,
  A2ATaskState,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
} from '../../engines/cursor/a2aAdapter.js';
