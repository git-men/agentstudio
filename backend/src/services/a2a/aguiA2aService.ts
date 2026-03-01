/**
 * Generic AGUI A2A Service
 *
 * Provides A2A protocol support for ANY AGUI-based engine (Cursor, Codex,
 * Codex-SDK, CodeBuddy, etc.) via the unified engineManager interface.
 *
 * This replaces the need for engine-specific A2A service files —
 * all AGUI engines share the same IAgentEngine.sendMessage() contract,
 * so A2A handling is identical apart from the engine type passed in.
 */

import { v4 as uuidv4 } from 'uuid';
import { engineManager } from '../../engines/index.js';
import {
  CursorA2AAdapter,
  type A2AStreamingResponse,
  type A2ATask,
  type A2AMessage,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
} from '../../engines/cursor/a2aAdapter.js';
import type { AGUIEvent, EngineConfig, EngineType } from '../../engines/types.js';

// =============================================================================
// Types
// =============================================================================

export interface AguiA2AMessageParams {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    historyLength?: number;
    blocking?: boolean;
  };
  metadata?: Record<string, any>;
}

export interface AguiA2AConfig {
  engineType: EngineType;
  workspace: string;
  model?: string;
  sessionId?: string;
  timeout?: number;
  requestId?: string | number;
  contextId?: string;
  taskId?: string;
  permissionMode?: string;
  envVars?: Record<string, string>;
}

export interface AguiA2AResult {
  task: A2ATask;
  responseText: string;
  sessionId: string;
}

// =============================================================================
// Generic AGUI A2A Service
// =============================================================================

/**
 * Execute an AGUI engine request and return A2A-formatted response (non-streaming)
 */
export async function executeAguiA2AQuery(
  params: AguiA2AMessageParams,
  config: AguiA2AConfig
): Promise<AguiA2AResult> {
  const { message } = params;
  const {
    engineType, workspace, model, sessionId, timeout,
    requestId, contextId, taskId, permissionMode, envVars,
  } = config;

  const messageText = extractMessageText(message);

  const adapter = new CursorA2AAdapter({
    taskId: taskId || message.taskId || uuidv4(),
    contextId: contextId || message.contextId || uuidv4(),
    requestId: requestId || uuidv4(),
  });

  const engineConfig: EngineConfig = {
    type: engineType,
    workspace,
    model,
    sessionId,
    timeout: timeout || 600000,
    permissionMode: permissionMode as EngineConfig['permissionMode'],
    envVars,
  };

  const result = await engineManager.sendMessage(
    engineType,
    messageText,
    engineConfig,
    (event: AGUIEvent) => {
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
 * Execute an AGUI engine request with A2A streaming output
 */
export async function executeAguiA2AStreaming(
  params: AguiA2AMessageParams,
  config: AguiA2AConfig,
  onResponse: (response: A2AStreamingResponse) => void
): Promise<{ taskId: string; contextId: string; sessionId: string }> {
  const { message } = params;
  const {
    engineType, workspace, model, sessionId, timeout,
    requestId, contextId, taskId, permissionMode, envVars,
  } = config;

  const messageText = extractMessageText(message);

  const adapter = new CursorA2AAdapter({
    taskId: taskId || message.taskId || uuidv4(),
    contextId: contextId || message.contextId || uuidv4(),
    requestId: requestId || uuidv4(),
  });

  const engineConfig: EngineConfig = {
    type: engineType,
    workspace,
    model,
    sessionId,
    timeout: timeout || 600000,
    permissionMode: permissionMode as EngineConfig['permissionMode'],
    envVars,
  };

  const result = await engineManager.sendMessage(
    engineType,
    messageText,
    engineConfig,
    (event: AGUIEvent) => {
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
 * Generate an A2A Agent Card for any AGUI engine
 */
export async function generateAguiAgentCard(
  engineType: EngineType,
  context: {
    a2aAgentId: string;
    projectId: string;
    projectName: string;
    workingDirectory: string;
    baseUrl: string;
  }
) {
  const engine = engineManager.getEngine(engineType);
  const models = await engine.getSupportedModels();
  const capabilities = engine.capabilities;

  const engineLabels: Record<string, { name: string; org: string; url: string }> = {
    cursor: { name: 'Cursor Agent', org: 'Cursor', url: 'https://cursor.com' },
    codex: { name: 'Codex Agent', org: 'OpenAI', url: 'https://openai.com' },
    'codex-sdk': { name: 'Codex Agent', org: 'OpenAI', url: 'https://openai.com' },
    codebuddy: { name: 'CodeBuddy Agent', org: 'Tencent', url: 'https://cloud.tencent.com' },
    claude: { name: 'Claude Agent', org: 'Anthropic', url: 'https://anthropic.com' },
  };

  const label = engineLabels[engineType] || engineLabels.claude;

  return {
    name: label.name,
    description: `AI-powered coding assistant powered by ${label.org}. Capable of code editing, file operations, terminal commands, and codebase navigation.`,
    url: `${context.baseUrl}/a2a/${context.a2aAgentId}`,
    provider: {
      organization: label.org,
      url: label.url,
    },
    version: '1.0.0',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
    },
    security: [{ apiKey: [] }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: generateGenericSkills(capabilities),
    context: {
      a2aAgentId: context.a2aAgentId,
      projectId: context.projectId,
      projectName: context.projectName,
      workingDirectory: context.workingDirectory,
      engineType,
      supportedModels: models.map(m => ({ id: m.id, name: m.name })),
    },
  };
}

// =============================================================================
// Helpers
// =============================================================================

function extractMessageText(message: A2AMessage): string {
  const text = message.parts
    .filter(p => p.kind === 'text')
    .map(p => (p as any).text)
    .join('\n');

  if (!text) {
    throw new Error('Message must contain at least one text part');
  }
  return text;
}

function generateGenericSkills(capabilities: any) {
  const skills = [
    {
      id: 'code-editing',
      name: 'Code Editing',
      description: 'Read, write, and modify code files with intelligent context awareness',
      tags: ['code', 'editing', 'development'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain', 'application/json'],
    },
    {
      id: 'file-operations',
      name: 'File Operations',
      description: 'Read, write, create, and navigate files in the workspace',
      tags: ['files', 'filesystem', 'navigation'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain', 'application/json'],
    },
  ];

  if (capabilities?.features?.codeExecution) {
    skills.push({
      id: 'terminal-execution',
      name: 'Terminal Command Execution',
      description: 'Execute shell commands and scripts in the project context',
      tags: ['terminal', 'shell', 'commands'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain', 'application/json'],
    });
  }

  skills.push(
    {
      id: 'code-search',
      name: 'Code Search & Navigation',
      description: 'Search for patterns, find definitions, and navigate the codebase',
      tags: ['search', 'navigation', 'codebase'],
      inputModes: ['text/plain'],
      outputModes: ['application/json'],
    },
    {
      id: 'coding-assistant',
      name: 'General Coding Assistant',
      description: 'Answer questions, explain code, and provide coding guidance',
      tags: ['assistant', 'explanation', 'guidance'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
  );

  return skills;
}

// Re-export adapter types for convenience
export {
  CursorA2AAdapter as AguiA2AAdapter,
  type A2AStreamingResponse,
  type A2ATask,
  type A2AMessage,
  createA2AErrorResponse,
  A2A_ERROR_CODES,
} from '../../engines/cursor/a2aAdapter.js';
