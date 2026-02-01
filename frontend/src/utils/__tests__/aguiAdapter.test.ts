/**
 * AGUI Adapter Unit Tests
 * Tests for SSE → AGUI event conversion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AGUIAdapter } from '../aguiAdapter';
import { AGUIEventType } from '../../types/aguiTypes';

describe('AGUIAdapter', () => {
    let adapter: AGUIAdapter;

    beforeEach(() => {
        adapter = new AGUIAdapter();
    });

    describe('convert', () => {
        it('should convert system init event to RUN_STARTED', () => {
            const sseEvent = {
                type: 'system',
                subtype: 'init',
                sessionId: 'session-123',
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.RUN_STARTED);
            expect((events[0] as any).threadId).toBe('session-123');
            expect((events[0] as any).runId).toBe('session-123');
        });

        it('should convert error event to RUN_ERROR', () => {
            const sseEvent = {
                type: 'error',
                error: 'Something went wrong',
                message: 'Error details',
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.RUN_ERROR);
            expect((events[0] as any).error).toBe('Something went wrong');
        });

        it('should convert result event to RUN_FINISHED', () => {
            // First init to set runId
            adapter.convert({ type: 'system', subtype: 'init', sessionId: 'session-123' });

            const sseEvent = { type: 'result' };
            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.RUN_FINISHED);
        });

        it('should skip sidechain events', () => {
            const sseEvent = {
                type: 'stream_event',
                isSidechain: true,
                parentToolUseId: 'tool-123',
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(0);
        });
    });

    describe('stream event conversion', () => {
        it('should convert message_start to TEXT_MESSAGE_START', () => {
            const sseEvent = {
                type: 'stream_event',
                event: {
                    type: 'message_start',
                    message: { id: 'msg-123', role: 'assistant', content: [] },
                },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_START);
            expect((events[0] as any).messageId).toBe('msg-123');
        });

        it('should convert content_block_start with thinking type to THINKING_START', () => {
            const sseEvent = {
                type: 'stream_event',
                event: {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'thinking' },
                },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.THINKING_START);
        });

        it('should convert content_block_start with tool_use to TOOL_CALL_START', () => {
            const sseEvent = {
                type: 'stream_event',
                event: {
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'tool_use', id: 'tool-123', name: 'test_tool' },
                },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.TOOL_CALL_START);
            expect((events[0] as any).toolId).toBe('tool-123');
            expect((events[0] as any).toolName).toBe('test_tool');
        });

        it('should convert text_delta to TEXT_MESSAGE_CONTENT', () => {
            const sseEvent = {
                type: 'stream_event',
                event: {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'text_delta', text: 'Hello, world!' },
                },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_CONTENT);
            expect((events[0] as any).content).toBe('Hello, world!');
        });

        it('should convert thinking_delta to THINKING_CONTENT', () => {
            const sseEvent = {
                type: 'stream_event',
                event: {
                    type: 'content_block_delta',
                    index: 0,
                    delta: { type: 'thinking_delta', thinking: 'Let me think...' },
                },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.THINKING_CONTENT);
            expect((events[0] as any).content).toBe('Let me think...');
        });

        it('should convert message_stop to TEXT_MESSAGE_END', () => {
            const sseEvent = {
                type: 'stream_event',
                event: { type: 'message_stop' },
            };

            const events = adapter.convert(sseEvent);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe(AGUIEventType.TEXT_MESSAGE_END);
        });
    });

    describe('convertHistoryMessages', () => {
        it('should convert message history to AGUI format', () => {
            const messages = [
                {
                    id: 'msg-1',
                    role: 'user' as const,
                    content: 'Hello',
                    messageParts: [{ type: 'text', content: 'Hello' }],
                },
                {
                    id: 'msg-2',
                    role: 'assistant' as const,
                    content: 'Hi there!',
                    messageParts: [
                        { type: 'text', content: 'Hi there!' },
                        { type: 'thinking', content: 'User said hello' },
                    ],
                },
            ];

            const aguiMessages = AGUIAdapter.convertHistoryMessages(messages);

            expect(aguiMessages).toHaveLength(2);
            expect(aguiMessages[0].role).toBe('user');
            expect(aguiMessages[0].parts).toHaveLength(1);
            expect(aguiMessages[1].role).toBe('assistant');
            expect(aguiMessages[1].parts).toHaveLength(2);
            expect(aguiMessages[1].parts![0].type).toBe('text');
            expect(aguiMessages[1].parts![1].type).toBe('thinking');
        });

        it('should convert tool parts correctly', () => {
            const messages = [
                {
                    id: 'msg-1',
                    role: 'assistant' as const,
                    content: '',
                    messageParts: [
                        {
                            type: 'tool',
                            toolData: {
                                id: 'tool-1',
                                toolName: 'read_file',
                                toolInput: { path: '/test.txt' },
                            },
                        },
                    ],
                },
            ];

            const aguiMessages = AGUIAdapter.convertHistoryMessages(messages);

            expect(aguiMessages[0].parts).toHaveLength(1);
            expect(aguiMessages[0].parts![0].type).toBe('tool_use');
            expect(aguiMessages[0].parts![0].toolName).toBe('read_file');
            expect(aguiMessages[0].parts![0].toolInput).toEqual({ path: '/test.txt' });
        });
    });
});
