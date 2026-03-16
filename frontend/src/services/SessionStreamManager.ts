import type { StoreApi } from 'zustand';
import type { SessionState, SessionActions } from '../stores/createSessionStore';
import type { StreamingState } from '../hooks/agentChat/useAIStreamHandler';
import type { StreamingBlock } from '../types/index.js';
import { isFrontendToolName, extractFrontendToolShortName } from './frontendToolRegistry';

type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Decoupled SSE processing class — no React dependency.
 *
 * Each instance is bound to exactly one session store.
 * All state reads/writes go through `this.store.getState()` / `this.store.setState()`.
 *
 * Preserves the exact same event-handling logic from useAIStreamHandler,
 * including RAF throttling, JSON accumulation with `+=`, and all content_block types.
 */
export class SessionStreamManager {
  private store: StoreApi<SessionState & SessionActions>;
  private abortController: AbortController | null = null;
  private aiMessageId: string | null = null;
  private subAgentStreamBlocks = new Map<string, string>();
  private translateFn: TranslateFn = (key) => key;

  private streamingState: StreamingState = {
    activeBlocks: new Map(),
    currentMessageId: null,
    isStreaming: false,
    wasStreamProcessed: false,
    pendingUpdate: null,
    rafId: null,
  };

  constructor(store: StoreApi<SessionState & SessionActions>) {
    this.store = store;
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /** Returns the bound session store for identity checks. */
  getStore(): StoreApi<SessionState & SessionActions> {
    return this.store;
  }

  setTranslateFn(fn: TranslateFn): void {
    this.translateFn = fn;
  }

  setAbortController(controller: AbortController): void {
    this.abortController = controller;
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  resetMessageId(): void {
    this.aiMessageId = null;
    this.streamingState.wasStreamProcessed = false;
    this.streamingState.isStreaming = false;
    this.streamingState.currentMessageId = null;
  }

  dispose(): void {
    this.abort();
    if (this.streamingState.rafId !== null) {
      cancelAnimationFrame(this.streamingState.rafId);
      this.streamingState.rafId = null;
    }
    this.streamingState.activeBlocks.clear();
    this.streamingState.pendingUpdate = null;
    this.streamingState.isStreaming = false;
    this.streamingState.currentMessageId = null;
    this.subAgentStreamBlocks.clear();
    this.aiMessageId = null;
  }

  // -------------------------------------------------------------------
  // Store helpers
  // -------------------------------------------------------------------

  private get state() {
    return this.store.getState();
  }

  private get actions() {
    return this.store.getState();
  }

  // -------------------------------------------------------------------
  // RAF-throttled update (preserves 60 fps throttling)
  // -------------------------------------------------------------------

  private scheduleUpdate(blockId: string, content: string, type: 'text' | 'thinking'): void {
    const ss = this.streamingState;
    ss.pendingUpdate = { blockId, content, type };

    if (ss.rafId !== null) return;

    ss.rafId = requestAnimationFrame(() => {
      const pending = ss.pendingUpdate;
      const messageId = this.aiMessageId;
      if (!pending || !messageId) {
        ss.rafId = null;
        return;
      }

      const streamingBlock = ss.activeBlocks.get(pending.blockId);
      if (!streamingBlock?.partId) {
        ss.rafId = null;
        return;
      }

      if (pending.type === 'text') {
        this.actions.updateTextPartInMessage(messageId, streamingBlock.partId, pending.content);
      } else if (pending.type === 'thinking') {
        this.actions.updateThinkingPartInMessage(messageId, streamingBlock.partId, pending.content);
      }

      ss.pendingUpdate = null;
      ss.rafId = null;
    });
  }

  // -------------------------------------------------------------------
  // Ensure AI message exists
  // -------------------------------------------------------------------

  private ensureAiMessage(): string {
    if (this.aiMessageId) return this.aiMessageId;

    this.actions.addMessage({ content: '', role: 'assistant' as const });
    const messages = this.state.messages;
    this.aiMessageId = messages[messages.length - 1].id;
    this.streamingState.currentMessageId = this.aiMessageId;
    this.streamingState.isStreaming = true;
    return this.aiMessageId;
  }

  // -------------------------------------------------------------------
  // handleStreamMessage
  // -------------------------------------------------------------------

  handleStreamMessage(data: unknown): void {
    try {
      const eventData = data as {
        type: string;
        sessionId?: string;
        session_id?: string;
        subtype?: string;
        message?: { content: unknown[]; role?: string } | string;
        permission_denials?: Array<{ tool_name: string; tool_input: Record<string, unknown> }>;
        error?: string;
        event?: any;
        isSidechain?: boolean;
        agentId?: string;
      };

      const sessionId = this.state.sessionId;
      const t = this.translateFn;

      // ---------------------------------------------------------------
      // Sidechain interception
      // ---------------------------------------------------------------
      const isSidechain = eventData.isSidechain === true;
      const parentToolUseId = (eventData as any).parentToolUseId;

      if (isSidechain && parentToolUseId) {
        this.handleSidechainMessage(eventData, parentToolUseId);
        return;
      }

      // ---------------------------------------------------------------
      // stream_event (partial message streaming)
      // ---------------------------------------------------------------
      if (eventData.type === 'stream_event' && eventData.event) {
        this.streamingState.wasStreamProcessed = true;
        this.handleStreamEvent(eventData.event, eventData);
        return;
      }

      // ---------------------------------------------------------------
      // error
      // ---------------------------------------------------------------
      if (eventData.type === 'error') {
        this.handleErrorEvent(eventData);
        return;
      }

      // ---------------------------------------------------------------
      // system init
      // ---------------------------------------------------------------
      if (eventData.type === 'system' && eventData.subtype === 'init') {
        return;
      }

      // ---------------------------------------------------------------
      // MCP status / error
      // ---------------------------------------------------------------
      if (eventData.type === 'mcp_status') {
        this.handleMcpStatus(eventData);
        return;
      }
      if (eventData.type === 'mcp_error') {
        this.handleMcpError(eventData);
        return;
      }

      // ---------------------------------------------------------------
      // auto_compact
      // ---------------------------------------------------------------
      if (eventData.type === 'auto_compact') {
        this.handleAutoCompact(eventData);
        return;
      }

      // ---------------------------------------------------------------
      // A2A stream events
      // ---------------------------------------------------------------
      if (eventData.type === 'a2a_stream_start') {
        const d = eventData as any;
        this.actions.setA2AStreamStart(d.agentUrl, d.sessionId, d.message);
        return;
      }
      if (eventData.type === 'a2a_stream_data') {
        const d = eventData as any;
        if (d.agentUrl) {
          this.actions.addA2AStreamEvent(d.agentUrl, {
            type: d.event?.type || 'unknown',
            sessionId: d.event?.sessionId,
            message: d.event?.message,
            timestamp: d.timestamp,
          });
        }
        return;
      }
      if (eventData.type === 'a2a_stream_end') {
        const d = eventData as any;
        const streams = this.state.activeA2AStreams;
        for (const [agentUrl, stream] of Object.entries(streams)) {
          if (stream.sessionId === d.sessionId) {
            this.actions.setA2AStreamEnd(agentUrl);
            break;
          }
        }
        return;
      }

      // ---------------------------------------------------------------
      // assistant message (non-streaming fallback)
      // ---------------------------------------------------------------
      if (eventData.type === 'assistant') {
        if (this.streamingState.wasStreamProcessed) return;
        this.handleAssistantMessage(eventData);
        return;
      }

      // ---------------------------------------------------------------
      // user message (tool results)
      // ---------------------------------------------------------------
      if (eventData.type === 'user') {
        this.handleUserMessage(eventData);
        return;
      }

      // ---------------------------------------------------------------
      // result
      // ---------------------------------------------------------------
      if (eventData.type === 'result') {
        this.handleResultEvent(eventData);
        return;
      }
    } catch (error) {
      console.error('❌ [SessionStreamManager] Error in handleStreamMessage:', error);

      try {
        if (this.aiMessageId) {
          this.actions.addTextPartToMessage(
            this.aiMessageId,
            `\n\n❌ **Streaming Error**: ${error instanceof Error ? error.message : String(error)}\n\nPlease refresh the page and try again.`,
          );
        } else {
          this.actions.addMessage({
            content: `❌ **Streaming Error**: ${error instanceof Error ? error.message : String(error)}\n\nPlease refresh the page and try again.`,
            role: 'assistant',
          });
        }
      } catch {
        // Swallow secondary error
      }

      this.actions.setAiTyping(false);
    }
  }

  // -------------------------------------------------------------------
  // handleStreamError
  // -------------------------------------------------------------------

  handleStreamError(error: unknown): void {
    const t = this.translateFn;

    this.actions.setAiTyping(false);
    this.abortController = null;

    if (error instanceof DOMException && error.name === 'AbortError') return;

    this.actions.setStatus('error');

    let errorMessage = t('agentChat.genericError');

    if (error instanceof Error) {
      if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = t('agentChatPanel.errors.networkError');
      } else if (error.message.includes('timeout')) {
        errorMessage = t('agentChatPanel.errors.requestTimeout');
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = t('agentChatPanel.errors.rateLimit');
      } else if (error.message.includes('unauthorized') || error.message.includes('401')) {
        errorMessage = t('agentChatPanel.errors.unauthorized');
      } else if (error.message.startsWith('hook_block:')) {
        const reason = error.message.slice('hook_block:'.length);
        errorMessage = `🛡️ **${t('agentChatPanel.errors.contentBlocked')}**\n\n${reason}`;
      } else if (error.message.includes('forbidden') || error.message.includes('403')) {
        errorMessage = t('agentChatPanel.errors.forbidden');
      } else if (error.message.includes('500') || error.message.includes('internal server')) {
        errorMessage = t('agentChatPanel.errors.internalServerError');
      } else {
        errorMessage = `❌ **${t('agentChatPanel.errors.processingError')}**\n\n${error.message || t('agentChatPanel.errors.unknownErrorRetry')}`;
      }
    }

    if (!this.aiMessageId) {
      this.actions.addMessage({ content: errorMessage, role: 'assistant' });
    } else {
      this.actions.addTextPartToMessage(this.aiMessageId, '\n\n' + errorMessage);
    }
  }

  // ===================================================================
  // Private handlers
  // ===================================================================

  // -------------------------------------------------------------------
  // stream_event dispatcher
  // -------------------------------------------------------------------

  private handleStreamEvent(streamEvent: any, eventData: any): void {
    if (streamEvent.type === 'message_start') {
      this.ensureAiMessage();
      return;
    }

    if (streamEvent.type === 'content_block_start') {
      this.handleContentBlockStart(streamEvent, eventData);
      return;
    }

    if (streamEvent.type === 'content_block_delta' && this.aiMessageId) {
      this.handleContentBlockDelta(streamEvent, eventData);
      return;
    }

    if (streamEvent.type === 'content_block_stop' && this.aiMessageId) {
      this.handleContentBlockStop(streamEvent, eventData);
      return;
    }

    if (streamEvent.type === 'message_delta') {
      return;
    }

    if (streamEvent.type === 'message_stop') {
      this.handleMessageStop();
      return;
    }
  }

  // -------------------------------------------------------------------
  // content_block_start
  // -------------------------------------------------------------------

  private handleContentBlockStart(streamEvent: any, eventData: any): void {
    const msgId = this.ensureAiMessage();
    const blockIndex = streamEvent.index;
    const contentBlock = streamEvent.content_block;
    const blockId = `block-${msgId}-${blockIndex}`;
    const now = Date.now();

    if (this.streamingState.activeBlocks.has(blockId)) return;

    if (contentBlock.type === 'text') {
      this.actions.addTextPartToMessage(msgId, '');
      const partId = this.getLatestPartId(msgId);
      const block: StreamingBlock = {
        blockId, type: 'text', content: '', isComplete: false,
        messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
      };
      this.streamingState.activeBlocks.set(blockId, block);
    } else if (contentBlock.type === 'thinking') {
      this.actions.addThinkingPartToMessage(msgId, '');
      const partId = this.getLatestPartId(msgId);
      const block: StreamingBlock = {
        blockId, type: 'thinking', content: '', isComplete: false,
        messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
      };
      this.streamingState.activeBlocks.set(blockId, block);
    } else if (contentBlock.type === 'tool_use') {
      if (contentBlock.name === 'Task') {
        const sid = this.state.sessionId || (eventData.sessionId as string) || (eventData.session_id as string);
        if (sid && contentBlock.id) {
          this.actions.registerTaskTool(contentBlock.id, sid);
        }
      }

      this.actions.addToolPartToMessage(msgId, {
        toolName: contentBlock.name,
        toolInput: {},
        isExecuting: true,
        claudeId: contentBlock.id,
      });

      const messages = this.state.messages;
      const msg = messages.find((m) => m.id === msgId);
      const latestPart = msg?.messageParts?.[msg.messageParts.length - 1] as any;
      const partId = latestPart?.toolData?.id;

      const block: StreamingBlock = {
        blockId, type: 'tool_use', content: '', isComplete: false,
        messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
        toolName: contentBlock.name, claudeId: contentBlock.id,
      };
      this.streamingState.activeBlocks.set(blockId, block);
    }
  }

  // -------------------------------------------------------------------
  // content_block_delta
  // -------------------------------------------------------------------

  private handleContentBlockDelta(streamEvent: any, _eventData: any): void {
    const blockIndex = streamEvent.index;
    const delta = streamEvent.delta;
    const msgId = this.aiMessageId!;
    const blockId = `block-${msgId}-${blockIndex}`;
    const now = Date.now();

    if (delta.type === 'text_delta' && delta.text !== undefined) {
      let block = this.streamingState.activeBlocks.get(blockId);
      if (!block) {
        this.actions.addTextPartToMessage(msgId, '');
        const partId = this.getLatestPartId(msgId);
        block = {
          blockId, type: 'text', content: delta.text, isComplete: false,
          messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
        };
        this.streamingState.activeBlocks.set(blockId, block);
      } else {
        block.content += delta.text;
        block.lastUpdatedAt = now;
      }
      this.scheduleUpdate(blockId, block.content, 'text');

    } else if (delta.type === 'thinking_delta' && delta.thinking !== undefined) {
      let block = this.streamingState.activeBlocks.get(blockId);
      if (!block) {
        this.actions.addThinkingPartToMessage(msgId, '');
        const partId = this.getLatestPartId(msgId);
        block = {
          blockId, type: 'thinking', content: delta.thinking, isComplete: false,
          messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
        };
        this.streamingState.activeBlocks.set(blockId, block);
      } else {
        block.content += delta.thinking;
        block.lastUpdatedAt = now;
      }
      this.scheduleUpdate(blockId, block.content, 'thinking');

    } else if (delta.type === 'input_json_delta') {
      const fragment = delta.partial_json || '';
      let block = this.streamingState.activeBlocks.get(blockId);

      if (!block) {
        if (!streamEvent.content_block || streamEvent.content_block.type !== 'tool_use') return;
        const toolName = streamEvent.content_block.name;
        const claudeId = streamEvent.content_block.id;
        this.actions.addToolPartToMessage(msgId, {
          toolName, toolInput: {}, isExecuting: true, claudeId,
        });
        const messages = this.state.messages;
        const msg = messages.find((m) => m.id === msgId);
        const latestPart = msg?.messageParts?.[msg.messageParts.length - 1] as any;
        const partId = latestPart?.toolData?.id;
        block = {
          blockId, type: 'tool_use', content: fragment, isComplete: false,
          messageId: msgId, partId, startedAt: now, lastUpdatedAt: now,
        };
        this.streamingState.activeBlocks.set(blockId, block);
      } else {
        // CRITICAL: accumulate with +=
        block.content += fragment;
        block.lastUpdatedAt = now;

        const trimmed = block.content.trim();
        if (block.partId && trimmed.endsWith('}')) {
          try {
            const toolInput = JSON.parse(block.content);
            this.actions.updateToolPartInMessage(msgId, block.partId, { toolInput });
          } catch {
            // JSON not yet complete — normal during streaming
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // content_block_stop
  // -------------------------------------------------------------------

  private handleContentBlockStop(streamEvent: any, eventData: any): void {
    const blockIndex = streamEvent.index;
    const msgId = this.aiMessageId!;
    const blockId = `block-${msgId}-${blockIndex}`;
    const block = this.streamingState.activeBlocks.get(blockId);

    if (!block) return;

    block.isComplete = true;
    const ss = this.streamingState;

    // Flush pending RAF for THIS block
    if (ss.pendingUpdate?.blockId === blockId) {
      if (ss.rafId !== null) {
        cancelAnimationFrame(ss.rafId);
        ss.rafId = null;
      }
      const pending = ss.pendingUpdate;
      if (block.partId) {
        if (pending.type === 'text') {
          this.actions.updateTextPartInMessage(msgId, block.partId, pending.content);
        } else if (pending.type === 'thinking') {
          this.actions.updateThinkingPartInMessage(msgId, block.partId, pending.content);
        }
      }
      ss.pendingUpdate = null;
    } else if ((block.type === 'text' || block.type === 'thinking') && block.partId) {
      if (block.type === 'text') {
        this.actions.updateTextPartInMessage(msgId, block.partId, block.content);
      } else {
        this.actions.updateThinkingPartInMessage(msgId, block.partId, block.content);
      }
    } else if (block.type === 'tool_use' && block.partId && block.content) {
      try {
        const toolInput = JSON.parse(block.content);
        this.actions.updateToolPartInMessage(msgId, block.partId, { toolInput });

        if (block.toolName && block.claudeId && isFrontendToolName(block.toolName)) {
          const shortName = extractFrontendToolShortName(block.toolName);
          this.actions.addPendingFrontendTool({
            toolCallId: block.claudeId,
            toolName: shortName,
            args: toolInput,
            sessionId: (eventData.sessionId as string) ?? (eventData.session_id as string) ?? '',
            agentId: (eventData.agentId as string) ?? '',
            timestamp: Date.now(),
          });
        }
      } catch {
        // JSON parse failed at content_block_stop
      }
    }

    ss.activeBlocks.delete(blockId);
  }

  // -------------------------------------------------------------------
  // message_stop
  // -------------------------------------------------------------------

  private handleMessageStop(): void {
    const ss = this.streamingState;
    if (!ss.isStreaming) return;

    const msgId = this.aiMessageId;

    if (ss.pendingUpdate && ss.rafId !== null) {
      cancelAnimationFrame(ss.rafId);
      ss.rafId = null;
      const pending = ss.pendingUpdate;
      const blk = ss.activeBlocks.get(pending.blockId);
      if (blk?.partId && msgId) {
        if (pending.type === 'text') {
          this.actions.updateTextPartInMessage(msgId, blk.partId, pending.content);
        } else if (pending.type === 'thinking') {
          this.actions.updateThinkingPartInMessage(msgId, blk.partId, pending.content);
        }
      }
      ss.pendingUpdate = null;
    }

    if (msgId) {
      ss.activeBlocks.forEach((blk) => {
        blk.isComplete = true;
        if ((blk.type === 'text' || blk.type === 'thinking') && blk.partId) {
          if (blk.type === 'text') {
            this.actions.updateTextPartInMessage(msgId, blk.partId, blk.content);
          } else {
            this.actions.updateThinkingPartInMessage(msgId, blk.partId, blk.content);
          }
        }
      });
    }

    ss.isStreaming = false;
    ss.currentMessageId = null;
    ss.activeBlocks.clear();
  }

  // -------------------------------------------------------------------
  // Sidechain (sub-agent)
  // -------------------------------------------------------------------

  private handleSidechainMessage(eventData: any, parentToolUseId: string): void {
    const subAgentId = parentToolUseId;
    const msgSessionId = eventData.sessionId || eventData.session_id;

    if (msgSessionId) {
      this.actions.activateSubAgent(subAgentId, msgSessionId);
    }

    if (eventData.type === 'stream_event' && eventData.event) {
      const streamEvent = eventData.event;

      if (streamEvent.type === 'content_block_start' && streamEvent.content_block) {
        const blockIndex = streamEvent.index;
        const cb = streamEvent.content_block;

        if (cb.type === 'text') {
          const partId = `part_${subAgentId}_text_${blockIndex}_${Date.now()}`;
          this.actions.addSubAgentMessagePart(subAgentId, { id: partId, type: 'text', content: '', order: blockIndex });
          this.subAgentStreamBlocks.set(`${subAgentId}-${blockIndex}`, partId);
        } else if (cb.type === 'thinking') {
          const partId = `part_${subAgentId}_thinking_${blockIndex}_${Date.now()}`;
          this.actions.addSubAgentMessagePart(subAgentId, { id: partId, type: 'thinking', content: '', order: blockIndex });
          this.subAgentStreamBlocks.set(`${subAgentId}-${blockIndex}`, partId);
        } else if (cb.type === 'tool_use') {
          const partId = `part_${subAgentId}_tool_${blockIndex}_${Date.now()}`;
          this.actions.addSubAgentMessagePart(subAgentId, {
            id: partId, type: 'tool', order: blockIndex,
            toolData: { id: cb.id, toolName: cb.name, toolInput: {}, isError: false },
          });
          this.subAgentStreamBlocks.set(`${subAgentId}-${blockIndex}`, partId);
        }
      }

      if (streamEvent.type === 'content_block_delta' && streamEvent.delta) {
        const blockIndex = streamEvent.index;
        const delta = streamEvent.delta;
        const partId = this.subAgentStreamBlocks.get(`${subAgentId}-${blockIndex}`);

        if (partId) {
          const task = this.state.subAgentTasks.get(subAgentId);
          if (task) {
            for (const msg of task.messageFlow) {
              const part = msg.messageParts.find((p) => p.id === partId);
              if (part) {
                if (delta.type === 'text_delta' && delta.text) {
                  this.actions.addSubAgentMessagePart(subAgentId, {
                    ...part, content: (part.content || '') + delta.text,
                  });
                } else if (delta.type === 'thinking_delta' && delta.thinking) {
                  this.actions.addSubAgentMessagePart(subAgentId, {
                    ...part, content: (part.content || '') + delta.thinking,
                  });
                }
                break;
              }
            }
          }
        }
      }
    }

    if (eventData.type === 'assistant' && eventData.message) {
      const message = eventData.message as { content?: unknown[] };
      if (message.content && Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const blk = message.content[i] as any;
          if (blk.type === 'text' && blk.text) {
            this.actions.addSubAgentMessagePart(subAgentId, {
              id: `part_${subAgentId}_text_${i}_${Date.now()}`, type: 'text', content: blk.text, order: i,
            });
          } else if (blk.type === 'thinking' && blk.thinking) {
            this.actions.addSubAgentMessagePart(subAgentId, {
              id: `part_${subAgentId}_thinking_${i}_${Date.now()}`, type: 'thinking', content: blk.thinking, order: i,
            });
          } else if (blk.type === 'tool_use') {
            this.actions.addSubAgentMessagePart(subAgentId, {
              id: `part_${subAgentId}_tool_${i}_${Date.now()}`, type: 'tool', order: i,
              toolData: { id: blk.id, toolName: blk.name, toolInput: blk.input || {}, isError: false },
            });
          }
        }
      }
    }

    if (eventData.type === 'user' && eventData.message) {
      const message = eventData.message as { content?: unknown[] };
      if (message.content && Array.isArray(message.content)) {
        for (const blk of message.content) {
          const b = blk as any;
          if (b.type === 'text') continue;
          // tool_result is handled at history load — skip for now
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Error event
  // -------------------------------------------------------------------

  private handleErrorEvent(eventData: any): void {
    const t = this.translateFn;
    this.actions.setAiTyping(false);
    this.abortController = null;

    let errorMessage = '';

    if (eventData.subtype && eventData.message) {
      const errorTitles: Record<string, string> = {
        error_during_execution: t('agentChat.executionError'),
        error_max_turns: t('agentChat.maxTurnsReached'),
        error_max_budget_usd: t('agentChat.maxBudgetReached'),
        error_max_structured_output_retries: t('agentChat.maxRetriesReached'),
      };
      const errorTitle = errorTitles[eventData.subtype] || t('agentChat.processingError');
      errorMessage = `❌ **${errorTitle}**\n\n${eventData.message}`;
      errorMessage += `\n\n**${t('agentChatPanel.errors.suggestedActions')}**\n`;
      if (eventData.subtype === 'error_max_budget_usd') {
        errorMessage += `- ${t('agentChatPanel.errors.checkBudget')}\n`;
      } else if (eventData.subtype === 'error_max_turns') {
        errorMessage += `- ${t('agentChatPanel.errors.increaseMaxTurns')}\n`;
      }
      errorMessage += `- ${t('agentChatPanel.errors.resendMessage')}\n`;
      errorMessage += `- ${t('agentChatPanel.errors.refreshPage')}`;
    } else if (eventData.error === 'Claude Code SDK failed' && typeof eventData.message === 'string') {
      errorMessage = `${t('agentChat.errorMessages.claudeCodeSDKError')}\n\n`;
      if (eventData.message.includes('not valid JSON')) {
        errorMessage += t('agentChatPanel.errors.jsonParseError');
      } else if (eventData.message.includes('timeout')) {
        errorMessage += t('agentChatPanel.errors.timeoutError');
      } else if (eventData.message.includes('context window') || eventData.message.includes('context_window')) {
        errorMessage += t('agentChatPanel.errors.contextWindowError');
      } else {
        errorMessage += `${eventData.message}\n\n**${t('agentChatPanel.errors.suggestedActions')}**\n- ${t('agentChatPanel.errors.resendMessage')}\n- ${t('agentChatPanel.errors.refreshPage')}`;
      }
    } else {
      errorMessage = `${t('agentChat.errorMessages.claudeCodeSDKError')}\n\n`;
      errorMessage += `${eventData.message || eventData.error || t('agentChatPanel.errors.unknownError')}\n\n**${t('agentChatPanel.errors.suggestedActions')}**\n- ${t('agentChatPanel.errors.resendMessage')}\n- ${t('agentChatPanel.errors.refreshPage')}`;
    }

    if (!this.aiMessageId) {
      this.actions.addMessage({ content: errorMessage, role: 'assistant' });
    } else {
      this.actions.addTextPartToMessage(this.aiMessageId, '\n\n' + errorMessage);
    }
  }

  // -------------------------------------------------------------------
  // MCP status / error
  // -------------------------------------------------------------------

  private handleMcpStatus(eventData: any): void {
    if (eventData.subtype === 'connection_failed') {
      const failedServers = eventData.failedServers || [];
      this.actions.updateMcpStatus({
        hasError: true,
        connectionErrors: failedServers,
        lastError: `${t('mcpStatus.connectionFailed')}: ${failedServers.map((s: any) => s.name).join(', ')}`,
      });
    } else if (eventData.subtype === 'connection_success') {
      const connectedServers = eventData.connectedServers || [];
      this.actions.updateMcpStatus({
        hasError: false,
        connectedServers,
        connectionErrors: [],
        lastError: null,
      });
    }
  }

  private handleMcpError(eventData: any): void {
    if (eventData.subtype === 'execution_failed') {
      const toolName = eventData.tool || t('mcpStatus.unknownTool');
      const errorMessage = eventData.error || t('mcpStatus.executionFailed');
      const details = eventData.details || '';
      this.actions.updateMcpStatus({
        hasError: true,
        lastError: `${t('mcpStatus.toolExecutionFailed')}: ${toolName} - ${errorMessage}`,
        lastErrorDetails: details,
      });
    }
  }

  // -------------------------------------------------------------------
  // auto_compact
  // -------------------------------------------------------------------

  private handleAutoCompact(eventData: any): void {
    const t = this.translateFn;
    const msgId = this.ensureAiMessage();
    const preTokens = eventData.preTokens || 0;
    const tokenInfo = preTokens > 0
      ? t('compactSummary.autoCompactWithTokens', { tokens: preTokens.toLocaleString() })
      : t('compactSummary.autoCompact');
    this.actions.addCompactSummaryPartToMessage(msgId, tokenInfo);
  }

  // -------------------------------------------------------------------
  // assistant (non-streaming)
  // -------------------------------------------------------------------

  private handleAssistantMessage(eventData: any): void {
    const msgId = this.ensureAiMessage();

    if (eventData.message && typeof eventData.message === 'object' && 'content' in eventData.message && eventData.message.content) {
      for (const block of eventData.message.content as Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string }>) {
        if (block.type === 'text' && block.text) {
          this.actions.addTextPartToMessage(msgId, block.text);
        } else if (block.type === 'thinking' && block.thinking) {
          this.actions.addThinkingPartToMessage(msgId, block.thinking);
        } else if (block.type === 'tool_use' && block.name) {
          this.actions.addToolPartToMessage(msgId, {
            toolName: block.name,
            toolInput: (block.input as Record<string, unknown>) || {},
            isExecuting: true,
            claudeId: block.id,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // user (tool results)
  // -------------------------------------------------------------------

  private handleUserMessage(eventData: any): void {
    if (!eventData.message || typeof eventData.message !== 'object') return;
    const msg = eventData.message as { content?: unknown[] };
    if (!msg.content || !this.aiMessageId) return;

    for (const block of msg.content as Array<{ type: string; content?: unknown; is_error?: boolean; tool_use_id?: string }>) {
      if (block.type !== 'tool_result' || !block.tool_use_id) continue;

      const messages = this.state.messages;
      let targetTool: any = null;
      let targetMessageId: string | null = null;

      for (const m of messages) {
        if (m.messageParts) {
          const found = m.messageParts.find(
            (p: any) => p.type === 'tool' && p.toolData?.claudeId === block.tool_use_id,
          );
          if (found) {
            targetTool = found;
            targetMessageId = m.id;
            break;
          }
        }
      }

      if (targetTool?.toolData && targetMessageId) {
        const toolResult = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as Array<{ text?: string }>).map((c) => c.text || String(c)).join('')
            : JSON.stringify(block.content);

        if (targetTool.toolData.toolName === 'Task' && targetTool.toolData.claudeId) {
          const taskClaudeId = targetTool.toolData.claudeId;
          if (toolResult && typeof toolResult === 'string' && toolResult.trim()) {
            this.actions.addSubAgentMessagePart(taskClaudeId, {
              id: `part_${taskClaudeId}_result_${Date.now()}`,
              type: 'text',
              content: toolResult,
              order: 9999,
            });
          }
        }

        this.actions.updateToolPartInMessage(targetMessageId, targetTool.toolData.id, {
          toolResult,
          isError: block.is_error || false,
          isExecuting: false,
        });

        if (targetTool.toolData.toolName) {
          this.actions.notifyToolExecution(targetTool.toolData.toolName);
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // result
  // -------------------------------------------------------------------

  private handleResultEvent(eventData: any): void {
    const t = this.translateFn;
    const isSideChain = eventData.isSideChain;

    if (!isSideChain) {
      // Finalize streaming
      if (this.streamingState.isStreaming) {
        this.streamingState.activeBlocks.forEach((blk) => { blk.isComplete = true; });
        this.streamingState.isStreaming = false;
        this.streamingState.currentMessageId = null;
        if (this.streamingState.rafId !== null) {
          cancelAnimationFrame(this.streamingState.rafId);
          this.streamingState.rafId = null;
        }
        this.streamingState.activeBlocks.clear();
      }

      this.abortController = null;
      this.actions.setAiTyping(false);

      if (eventData.subtype === 'success') {
        this.actions.setStatus('completed');
      } else {
        this.actions.setStatus('error');
      }

      // Create fallback message if none exists
      if (!this.aiMessageId && eventData.subtype === 'success') {
        const resultContent = eventData.result;
        if (resultContent && typeof resultContent === 'string') {
          this.actions.addMessage({ content: '', role: 'assistant' as const });
          const msgs = this.state.messages;
          this.aiMessageId = msgs[msgs.length - 1].id;
          if (this.aiMessageId) {
            this.actions.addTextPartToMessage(this.aiMessageId, resultContent);
          }
        } else {
          this.actions.addMessage({ content: t('agentChat.taskComplete'), role: 'assistant' as const });
          const msgs = this.state.messages;
          this.aiMessageId = msgs[msgs.length - 1].id;
        }
      }

      // Force-complete all executing tools
      if (this.aiMessageId) {
        const messages = this.state.messages;
        const currentMsg = messages.find((m) => m.id === this.aiMessageId);
        if (currentMsg?.messageParts) {
          currentMsg.messageParts.forEach((part: any) => {
            if (part.type === 'tool' && part.toolData?.isExecuting) {
              this.actions.updateToolPartInMessage(this.aiMessageId!, part.toolData.id, {
                isExecuting: false,
                toolResult: part.toolData.toolResult || t('agentChat.executionCompleted'),
              });
            }
          });
        }
      }

      // Append final message text for non-success subtypes
      let finalMessage = '';
      if (eventData.subtype === 'success') {
        finalMessage = '';
      } else if (eventData.subtype === 'error_max_turns') {
        finalMessage = `\n\n${t('agentChat.maxTurnsReached')}`;
        if (eventData.permission_denials?.length > 0) {
          finalMessage += `\n\n${t('agentChat.permissionDenials')}`;
          eventData.permission_denials.forEach((d: any, i: number) => {
            finalMessage += `\n${i + 1}. ${d.tool_name}: \`${d.tool_input.command || d.tool_input.description || JSON.stringify(d.tool_input)}\``;
          });
          finalMessage += `\n\n${t('agentChat.permissionNote')}`;
        }
      } else if (eventData.subtype === 'error_during_execution') {
        finalMessage = `\n\n${t('agentChat.executionError')}`;
        if (eventData.errors?.length) finalMessage += `\n\n${eventData.errors.join('\n')}`;
      } else if (eventData.subtype === 'error_max_budget_usd') {
        finalMessage = `\n\n${t('agentChat.maxBudgetReached')}`;
        if (eventData.errors?.length) finalMessage += `\n\n${eventData.errors.join('\n')}`;
      } else if (eventData.subtype === 'error_max_structured_output_retries') {
        finalMessage = `\n\n${t('agentChat.maxRetriesReached')}`;
        if (eventData.errors?.length) finalMessage += `\n\n${eventData.errors.join('\n')}`;
      } else if (eventData.subtype === 'error') {
        finalMessage = `\n\n${t('agentChat.processingError')}`;
        if (eventData.errors?.length) finalMessage += `\n\n${eventData.errors.join('\n')}`;
      } else {
        finalMessage = `\n\n${t('agentChat.processingComplete')}`;
      }

      if (this.aiMessageId && finalMessage) {
        this.actions.addTextPartToMessage(this.aiMessageId, finalMessage);
      }
    }
  }

  // -------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------

  private getLatestPartId(messageId: string): string | undefined {
    const messages = this.state.messages;
    const msg = messages.find((m) => m.id === messageId);
    const latest = msg?.messageParts?.[msg.messageParts.length - 1];
    return latest?.id;
  }
}
