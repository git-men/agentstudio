/**
 * A2A Agent Executor
 *
 * Implements @a2a-js/sdk AgentExecutor interface to bridge standard A2A JSON-RPC
 * requests into AgentStudio's existing engine execution paths (Claude, AGUI engines).
 *
 * Publishes standard A2A events (Message, Task, TaskStatusUpdateEvent,
 * TaskArtifactUpdateEvent) onto the SDK's ExecutionEventBus.
 */

import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { Message, Task, TaskStatusUpdateEvent, TaskArtifactUpdateEvent, TaskState } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';
import { AgentStorage } from '../agentStorage.js';
import { executeA2AQuery, executeA2AQueryStreaming } from './a2aQueryService.js';
import {
  executeAguiA2AQuery,
  executeAguiA2AStreaming,
  type AguiA2AConfig,
} from './aguiA2aService.js';
import {
  createUserMessage,
} from './cursorA2aService.js';
import { CursorA2AAdapter } from '../../engines/cursor/a2aAdapter.js';
import { buildQueryOptions } from '../../utils/claudeUtils.js';
import { isCursorEngine, isCodexEngine, isCodexSdkEngine, isCodebuddyEngine } from '../../config/engineConfig.js';
import type { EngineType } from '../../engines/types.js';

const AGUI_ENGINE_TYPES = new Set<EngineType>(['cursor', 'codex', 'codex-sdk', 'codebuddy']);

function detectEngineType(agentType: string): EngineType {
  if (isCursorEngine()) return 'cursor';
  if (isCodexSdkEngine()) return 'codex-sdk';
  if (isCodexEngine()) return 'codex';
  if (isCodebuddyEngine()) return 'codebuddy';

  const lower = agentType.toLowerCase();
  const patterns: Array<{ engine: EngineType; match: (s: string) => boolean }> = [
    { engine: 'cursor', match: s => s === 'cursor' || s.startsWith('cursor-') || s.endsWith(':cursor') },
    { engine: 'codex-sdk', match: s => s === 'codex-sdk' || s.startsWith('codex-sdk-') || s.endsWith(':codex-sdk') },
    { engine: 'codex', match: s => s === 'codex' || s.startsWith('codex-') || s.endsWith(':codex') },
    { engine: 'codebuddy', match: s => s === 'codebuddy' || s.startsWith('codebuddy-') || s.endsWith(':codebuddy') },
  ];
  for (const { engine, match } of patterns) {
    if (match(lower)) return engine;
  }
  return 'claude';
}

export class A2AStandardAgentExecutor implements AgentExecutor {
  private agentType: string;
  private workingDirectory: string;
  private agentStorage: AgentStorage;
  private activeTasks = new Map<string, AbortController>();

  constructor(agentType: string, workingDirectory: string) {
    this.agentType = agentType;
    this.workingDirectory = workingDirectory;
    this.agentStorage = new AgentStorage();
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { userMessage, taskId, contextId } = requestContext;

    const messageText = this.extractText(userMessage);
    const engineType = detectEngineType(this.agentType);

    const abortController = new AbortController();
    this.activeTasks.set(taskId, abortController);

    try {
      // Publish initial status
      eventBus.publish(this.createStatusEvent(taskId, contextId, 'working'));

      if (AGUI_ENGINE_TYPES.has(engineType)) {
        await this.executeAgui(engineType, messageText, taskId, contextId, eventBus);
      } else {
        await this.executeClaude(messageText, taskId, contextId, eventBus);
      }

      // Publish final completed status
      eventBus.publish(this.createStatusEvent(taskId, contextId, 'completed', true));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      eventBus.publish(this.createStatusEvent(taskId, contextId, 'failed', true, errMsg));
    } finally {
      this.activeTasks.delete(taskId);
      eventBus.finished();
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    const controller = this.activeTasks.get(taskId);
    if (controller) {
      controller.abort();
      this.activeTasks.delete(taskId);
    }
    eventBus.publish(this.createStatusEvent(taskId, taskId, 'canceled', true));
    eventBus.finished();
  }

  private async executeAgui(
    engineType: EngineType,
    messageText: string,
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const a2aMessage = createUserMessage(messageText, { contextId });

    const aguiConfig: AguiA2AConfig = {
      engineType,
      workspace: this.workingDirectory,
      sessionId: contextId,
      timeout: 600000,
      requestId: `a2a-jsonrpc-${Date.now()}`,
      contextId,
      taskId,
    };

    await executeAguiA2AStreaming(
      { message: a2aMessage },
      aguiConfig,
      (response) => {
        // response is A2AStreamingResponse = { jsonrpc, id, result }
        // result contains the actual A2A event with `kind`
        const evt = response.result as any;
        if (!evt || !evt.kind) return;

        if (evt.kind === 'status-update') {
          const state = evt.status?.state;
          if (state && state !== 'completed' && state !== 'failed' && state !== 'canceled') {
            eventBus.publish(this.createStatusEvent(taskId, contextId, state as TaskState));
          }
        } else if (evt.kind === 'artifact-update') {
          const artifact = evt.artifact;
          if (artifact) {
            eventBus.publish({
              kind: 'artifact-update',
              taskId,
              contextId,
              artifact: {
                artifactId: artifact.artifactId || uuidv4(),
                parts: artifact.parts?.map((p: any) => ({
                  type: 'text',
                  text: p.text || '',
                })) || [],
              },
            } as unknown as TaskArtifactUpdateEvent);
          }
        } else if (evt.kind === 'message') {
          eventBus.publish({
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            taskId,
            contextId,
            parts: evt.parts?.map((p: any) => ({
              type: 'text',
              text: p.text || '',
            })) || [],
          } as unknown as Message);
        }
      }
    );
  }

  private async executeClaude(
    messageText: string,
    taskId: string,
    contextId: string,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const agentConfig = this.agentStorage.getAgent(this.agentType);
    if (!agentConfig) {
      throw new Error(`Agent '${this.agentType}' not found`);
    }

    const mcpTools = (agentConfig.allowedTools || [])
      .filter((tool: any) => tool.enabled && tool.name.startsWith('mcp__'))
      .map((tool: any) => tool.name);

    const { queryOptions } = await buildQueryOptions(
      {
        systemPrompt: agentConfig.systemPrompt || undefined,
        allowedTools: agentConfig.allowedTools || [],
        maxTurns: 30,
        workingDirectory: this.workingDirectory,
        permissionMode: 'default',
      },
      this.workingDirectory,
      mcpTools.length > 0 ? mcpTools : undefined,
    );
    queryOptions.includePartialMessages = false;

    let collectedText = '';

    await executeA2AQueryStreaming(
      messageText,
      undefined,
      queryOptions,
      (sdkMessage: any) => {
        if (sdkMessage.type === 'assistant' && sdkMessage.message?.content) {
          for (const block of sdkMessage.message.content) {
            if (block.type === 'text') {
              collectedText += block.text;

              // Publish artifact update with accumulated text
              eventBus.publish({
                kind: 'artifact-update',
                taskId,
                contextId,
                artifact: {
                  artifactId: `${taskId}-response`,
                  parts: [{ type: 'text', text: collectedText }],
                },
              } as unknown as TaskArtifactUpdateEvent);
            }
          }
        }
      }
    );

    // Publish final message
    if (collectedText) {
      eventBus.publish({
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        taskId,
        contextId,
        parts: [{ type: 'text', text: collectedText }],
      } as unknown as Message);
    }
  }

  private extractText(message: Message): string {
    if (!message.parts) return '';
    return message.parts
      .filter((p: any) => p.type === 'text' || p.kind === 'text')
      .map((p: any) => p.text || '')
      .join('');
  }

  private createStatusEvent(
    taskId: string,
    contextId: string,
    state: TaskState | string,
    final = false,
    errorMessage?: string,
  ): TaskStatusUpdateEvent {
    const event: any = {
      kind: 'status-update',
      taskId,
      contextId,
      status: {
        state,
        timestamp: new Date().toISOString(),
      },
      final,
    };
    if (errorMessage) {
      event.status.message = {
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        parts: [{ type: 'text', text: errorMessage }],
      };
    }
    return event as TaskStatusUpdateEvent;
  }
}
