/**
 * AGUI Adapter - Converts SSE stream events to AGUI protocol format
 * 
 * This adapter bridges the existing backend SSE events to the standardized
 * AGUI protocol format that TDesign Chat components expect.
 * 
 * @see https://ag-ui.com/concepts/architecture
 */

import {
    AGUIEventType,
    type AGUIEvent,
    type AGUIMessage,
    type AGUIMessagePart,
} from '../types/aguiTypes';

/** Existing SSE event type from backend */
export interface SSEEvent {
    type: string;
    subtype?: string;
    sessionId?: string;
    session_id?: string;
    message?: {
        content?: unknown[];
        role?: string;
    } | string;
    event?: {
        type: string;
        index?: number;
        content_block?: {
            type: string;
            text?: string;
            thinking?: string;
            id?: string;
            name?: string;
        };
        delta?: {
            type: string;
            text?: string;
            thinking?: string;
            partial_json?: string;
        };
        message?: {
            id: string;
            role: string;
            content: unknown[];
        };
    };
    error?: string;
    isSidechain?: boolean;
    agentId?: string;
    parentToolUseId?: string;
}

/** Conversion state to track streaming contexts */
interface ConversionState {
    currentMessageId: string | null;
    currentRunId: string | null;
    activeBlocks: Map<number, {
        type: 'text' | 'thinking' | 'tool_use';
        id: string;
    }>;
}

/**
 * AGUI Adapter class for converting SSE events to AGUI format
 */
export class AGUIAdapter {
    private state: ConversionState = {
        currentMessageId: null,
        currentRunId: null,
        activeBlocks: new Map(),
    };

    /**
     * Reset adapter state for a new session
     */
    public reset(): void {
        this.state = {
            currentMessageId: null,
            currentRunId: null,
            activeBlocks: new Map(),
        };
    }

    /**
     * Convert an SSE event to AGUI event(s)
     * May return multiple events for complex SSE events
     */
    public convert(sseEvent: SSEEvent): AGUIEvent[] {
        const events: AGUIEvent[] = [];
        const timestamp = Date.now();

        // Skip sidechain events (handled separately for sub-agents)
        if (sseEvent.isSidechain && sseEvent.parentToolUseId) {
            return events;
        }

        // Handle system init event -> RUN_STARTED
        if (sseEvent.type === 'system' && sseEvent.subtype === 'init') {
            const sessionId = sseEvent.sessionId || sseEvent.session_id || '';
            this.state.currentRunId = sessionId;
            events.push({
                type: AGUIEventType.RUN_STARTED,
                threadId: sessionId,
                runId: sessionId,
                timestamp,
            });
            return events;
        }

        // Handle stream_event type (nested events)
        if (sseEvent.type === 'stream_event' && sseEvent.event) {
            return this.convertStreamEvent(sseEvent.event, timestamp);
        }

        // Handle assistant message type
        if (sseEvent.type === 'assistant' && sseEvent.message) {
            return this.convertAssistantMessage(sseEvent.message, timestamp);
        }

        // Handle error events -> RUN_ERROR
        if (sseEvent.type === 'error') {
            events.push({
                type: AGUIEventType.RUN_ERROR,
                error: sseEvent.error || 'Unknown error',
                message: typeof sseEvent.message === 'string' ? sseEvent.message : undefined,
                timestamp,
            });
            return events;
        }

        // Handle result events -> RUN_FINISHED
        if (sseEvent.type === 'result') {
            events.push({
                type: AGUIEventType.RUN_FINISHED,
                threadId: this.state.currentRunId || '',
                runId: this.state.currentRunId || '',
                timestamp,
            });
            return events;
        }

        return events;
    }

    /**
     * Convert nested stream_event to AGUI events
     */
    private convertStreamEvent(event: NonNullable<SSEEvent['event']>, timestamp: number): AGUIEvent[] {
        const events: AGUIEvent[] = [];

        switch (event.type) {
            case 'message_start':
                // Generate message ID
                this.state.currentMessageId = event.message?.id || `msg-${Date.now()}`;
                events.push({
                    type: AGUIEventType.TEXT_MESSAGE_START,
                    messageId: this.state.currentMessageId,
                    timestamp,
                });
                break;

            case 'content_block_start':
                if (event.content_block) {
                    const blockIndex = event.index ?? 0;
                    const block = event.content_block;
                    const blockId = block.id || `block-${blockIndex}-${Date.now()}`;

                    if (block.type === 'text') {
                        this.state.activeBlocks.set(blockIndex, { type: 'text', id: blockId });
                        // Text block start is implicit in TEXT_MESSAGE_START
                    } else if (block.type === 'thinking') {
                        this.state.activeBlocks.set(blockIndex, { type: 'thinking', id: blockId });
                        events.push({
                            type: AGUIEventType.THINKING_START,
                            messageId: this.state.currentMessageId || '',
                            timestamp,
                        });
                    } else if (block.type === 'tool_use') {
                        this.state.activeBlocks.set(blockIndex, { type: 'tool_use', id: block.id || blockId });
                        events.push({
                            type: AGUIEventType.TOOL_CALL_START,
                            toolId: block.id || blockId,
                            toolName: block.name || 'unknown',
                            timestamp,
                        });
                    }
                }
                break;

            case 'content_block_delta':
                if (event.delta) {
                    const blockIndex = event.index ?? 0;
                    const activeBlock = this.state.activeBlocks.get(blockIndex);

                    if (event.delta.type === 'text_delta' && event.delta.text) {
                        events.push({
                            type: AGUIEventType.TEXT_MESSAGE_CONTENT,
                            messageId: this.state.currentMessageId || '',
                            content: event.delta.text,
                            timestamp,
                        });
                    } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
                        events.push({
                            type: AGUIEventType.THINKING_CONTENT,
                            messageId: this.state.currentMessageId || '',
                            content: event.delta.thinking,
                            timestamp,
                        });
                    } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json && activeBlock) {
                        events.push({
                            type: AGUIEventType.TOOL_CALL_ARGS,
                            toolId: activeBlock.id,
                            args: event.delta.partial_json,
                            timestamp,
                        });
                    }
                }
                break;

            case 'content_block_stop':
                {
                    const blockIndex = event.index ?? 0;
                    const activeBlock = this.state.activeBlocks.get(blockIndex);

                    if (activeBlock) {
                        if (activeBlock.type === 'thinking') {
                            events.push({
                                type: AGUIEventType.THINKING_END,
                                messageId: this.state.currentMessageId || '',
                                timestamp,
                            });
                        } else if (activeBlock.type === 'tool_use') {
                            events.push({
                                type: AGUIEventType.TOOL_CALL_END,
                                toolId: activeBlock.id,
                                timestamp,
                            });
                        }
                        this.state.activeBlocks.delete(blockIndex);
                    }
                }
                break;

            case 'message_stop':
                events.push({
                    type: AGUIEventType.TEXT_MESSAGE_END,
                    messageId: this.state.currentMessageId || '',
                    timestamp,
                });
                this.state.currentMessageId = null;
                this.state.activeBlocks.clear();
                break;
        }

        return events;
    }

    /**
     * Convert assistant message to AGUI events
     */
    private convertAssistantMessage(
        message: NonNullable<SSEEvent['message']>,
        timestamp: number
    ): AGUIEvent[] {
        const events: AGUIEvent[] = [];

        if (typeof message === 'string') {
            // Simple string message
            const messageId = `msg-${Date.now()}`;
            events.push(
                { type: AGUIEventType.TEXT_MESSAGE_START, messageId, timestamp },
                { type: AGUIEventType.TEXT_MESSAGE_CONTENT, messageId, content: message, timestamp },
                { type: AGUIEventType.TEXT_MESSAGE_END, messageId, timestamp }
            );
            return events;
        }

        // Complex message with content array
        if (message.content && Array.isArray(message.content)) {
            const messageId = `msg-${Date.now()}`;

            for (const block of message.content) {
                const b = block as {
                    type: string;
                    text?: string;
                    thinking?: string;
                    id?: string;
                    name?: string;
                    input?: Record<string, unknown>;
                };

                if (b.type === 'text' && b.text) {
                    events.push({
                        type: AGUIEventType.TEXT_MESSAGE_CONTENT,
                        messageId,
                        content: b.text,
                        timestamp,
                    });
                } else if (b.type === 'thinking' && b.thinking) {
                    events.push(
                        { type: AGUIEventType.THINKING_START, messageId, timestamp },
                        { type: AGUIEventType.THINKING_CONTENT, messageId, content: b.thinking, timestamp },
                        { type: AGUIEventType.THINKING_END, messageId, timestamp }
                    );
                } else if (b.type === 'tool_use') {
                    const toolId = b.id || `tool-${Date.now()}`;
                    events.push(
                        { type: AGUIEventType.TOOL_CALL_START, toolId, toolName: b.name || 'unknown', timestamp },
                        { type: AGUIEventType.TOOL_CALL_ARGS, toolId, args: JSON.stringify(b.input || {}), timestamp },
                        { type: AGUIEventType.TOOL_CALL_END, toolId, timestamp }
                    );
                }
            }
        }

        return events;
    }

    /**
     * Convert historical messages to AGUI format
     * Used for backfilling conversation history
     */
    public static convertHistoryMessages(messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        messageParts?: Array<{
            type: string;
            content?: string;
            toolData?: {
                id?: string;
                toolName?: string;
                toolInput?: Record<string, unknown>;
                toolResult?: unknown;
                isError?: boolean;
            };
        }>;
    }>): AGUIMessage[] {
        return messages.map((msg) => {
            const aguiMessage: AGUIMessage = {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                parts: [],
            };

            if (msg.messageParts) {
                aguiMessage.parts = msg.messageParts.map((part): AGUIMessagePart => {
                    if (part.type === 'text') {
                        return { type: 'text', content: part.content };
                    } else if (part.type === 'thinking') {
                        return { type: 'thinking', content: part.content };
                    } else if (part.type === 'tool' && part.toolData) {
                        return {
                            type: 'tool_use',
                            toolId: part.toolData.id,
                            toolName: part.toolData.toolName,
                            toolInput: part.toolData.toolInput,
                        };
                    }
                    return { type: 'text', content: part.content };
                });
            }

            return aguiMessage;
        });
    }
}

// Export singleton instance
export const aguiAdapter = new AGUIAdapter();
