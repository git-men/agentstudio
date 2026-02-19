import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentStore } from '../../stores/useAgentStore';
import { useSubAgentStore } from '../../stores/useSubAgentStore';
import { tabManager } from '../../utils/tabManager';
import { eventBus, EVENTS } from '../../utils/eventBus';
import type { StreamingBlock } from '../../types/index.js';

/**
 * Container for managing streaming state
 * Stored in React ref for performance (no re-renders on fragment updates)
 */
export interface StreamingState {
  /**
   * Map of active streaming blocks by block ID
   * Key: blockId, Value: StreamingBlock
   */
  activeBlocks: Map<string, StreamingBlock>;

  /**
   * Current AI message ID being streamed
   * Null if no active streaming
   */
  currentMessageId: string | null;

  /**
   * Whether streaming is currently active
   * Used for auto-scroll and UI indicators
   */
  isStreaming: boolean;

  /**
   * Whether this message was processed via stream_event
   * Set to true when first stream_event arrives, never cleared
   * Used to prevent duplicate processing from final assistant message
   */
  wasStreamProcessed: boolean;

  /**
   * Pending UI update (throttling)
   * Accumulated updates applied at next RAF
   */
  pendingUpdate: {
    blockId: string;
    content: string;
    type: 'text' | 'thinking';
  } | null;

  /**
   * Request animation frame ID
   * For canceling pending updates
   */
  rafId: number | null;
}

export interface UseAIStreamHandlerProps {
  agentId: string;
  currentSessionId: string | null;
  projectPath?: string;
  isCompactCommand?: boolean;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  onSessionChange?: (sessionId: string | null) => void;
  setIsInitializingSession: (init: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setIsNewSession: (isNew: boolean) => void;
  setAiTyping: (typing: boolean) => void;
  setHasSuccessfulResponse: (success: boolean) => void;
}

export const useAIStreamHandler = ({
  agentId,
  currentSessionId,
  projectPath,
  isCompactCommand = false,
  abortControllerRef,
  onSessionChange,
  setIsInitializingSession,
  setCurrentSessionId,
  setIsNewSession,
  setAiTyping,
  setHasSuccessfulResponse,
}: UseAIStreamHandlerProps) => {
  const { t } = useTranslation('components');
  const queryClient = useQueryClient();
  const {
    addMessage,
    addTextPartToMessage,
    addThinkingPartToMessage,
    updateTextPartInMessage,
    updateThinkingPartInMessage,
    addCompactSummaryPartToMessage,
    addToolPartToMessage,
    updateToolPartInMessage,
    updateMcpStatus,
    addPendingFrontendTool,
    setA2AStreamStart,
    setA2AStreamEnd,
    addA2AStreamEvent,
  } = useAgentStore();

  // Track current AI message ID
  const aiMessageIdRef = useRef<string | null>(null);

  // 🎯 Track sub-agent stream block IDs for delta updates
  const subAgentStreamBlocksRef = useRef<Map<string, string>>(new Map());

  // T023: Track active streaming blocks (character-by-character streaming)
  const streamingStateRef = useRef<StreamingState>({
    activeBlocks: new Map(),
    currentMessageId: null,
    isStreaming: false,
    wasStreamProcessed: false,
    pendingUpdate: null,
    rafId: null,
  });

  // T027: Schedule UI update with requestAnimationFrame for 60fps throttling
  const scheduleUpdate = useCallback((blockId: string, content: string, type: 'text' | 'thinking') => {
    const state = streamingStateRef.current;

    // Store pending update
    state.pendingUpdate = { blockId, content, type };

    // If RAF already scheduled, return (batch updates)
    if (state.rafId !== null) {
      return;
    }

    // Schedule RAF
    state.rafId = requestAnimationFrame(() => {
      const pending = state.pendingUpdate;
      const messageId = aiMessageIdRef.current;
      if (!pending || !messageId) {
        state.rafId = null;
        return;
      }

      // Get the streaming block to find the part ID
      const streamingBlock = state.activeBlocks.get(pending.blockId);
      if (!streamingBlock || !streamingBlock.partId) {
        console.warn('🌊 [STREAMING] No partId found for block:', pending.blockId);
        state.rafId = null;
        return;
      }

      // Apply the update (UPDATE existing part, not add new)
      if (pending.type === 'text') {
        updateTextPartInMessage(messageId, streamingBlock.partId, pending.content);
      } else if (pending.type === 'thinking') {
        updateThinkingPartInMessage(messageId, streamingBlock.partId, pending.content);
      }

      // Clear state
      state.pendingUpdate = null;
      state.rafId = null;
    });
  }, [updateTextPartInMessage, updateThinkingPartInMessage]);

  // T026: Generate block ID for blocks without SDK-provided IDs
  const generateBlockId = useCallback((type: string, index: number): string => {
    return `${type}-${Date.now()}-${index}`;
  }, []);

  // 获取子Agent Store的方法
  const { registerTaskTool, activateSubAgent, addSubAgentMessagePart } = useSubAgentStore.getState();

  const handleStreamMessage = useCallback((data: any) => {
    try {
      const eventData = data as {
        type: string;
        sessionId?: string;
        session_id?: string;
        subtype?: string;
        message?: { content: unknown[]; role?: string } | string;
        permission_denials?: Array<{ tool_name: string; tool_input: Record<string, unknown> }>;
        error?: string;
        event?: any; // Nested event object for stream_event type
        isSidechain?: boolean;
        agentId?: string;
      };

      // 🔧 首先处理系统初始化消息，不管是否是sidechain
      // 这确保会话状态被正确更新
      if (eventData.type === 'system' && eventData.subtype === 'init') {
        console.log('📋 [INIT] Received system init message, not intercepting');
        // 不要在这里return，让消息继续往下处理
      }

      // 🎯 检查是否是子Agent的sidechain消息（通过 isSidechain 和 parentToolUseId 字段）
      const isSidechain = eventData.isSidechain === true;
      const parentToolUseId = (eventData as any).parentToolUseId;

      // 🎯 拦截所有sidechain消息，不让它们进入主Agent的处理流程
      // 注意：系统消息（如init）不应该有isSidechain标记，所以会正常通过
      if (isSidechain && parentToolUseId) {
        console.log('🎯 [SIDECHAIN] Intercepted sub-agent message, parentToolUseId:', parentToolUseId, 'type:', eventData.type);
        
        const subAgentId = parentToolUseId;
        const msgSessionId = eventData.sessionId || eventData.session_id;
        
        // 激活子Agent
        if (msgSessionId) {
          activateSubAgent(subAgentId, msgSessionId);
        }
        
        // 处理stream_event类型的sidechain消息
        if (eventData.type === 'stream_event' && eventData.event) {
          const streamEvent = eventData.event;
          
          // 处理content_block_start - 初始化块
          if (streamEvent.type === 'content_block_start' && streamEvent.content_block) {
            const blockIndex = streamEvent.index;
            const contentBlock = streamEvent.content_block;
            
            if (contentBlock.type === 'text') {
              const partId = `part_${subAgentId}_text_${blockIndex}_${Date.now()}`;
              addSubAgentMessagePart(subAgentId, {
                id: partId,
                type: 'text',
                content: '',
                order: blockIndex,
              });
              // 存储partId以便delta更新
              subAgentStreamBlocksRef.current.set(`${subAgentId}-${blockIndex}`, partId);
              console.log('🎯 [SIDECHAIN] Started text block:', partId);
            } else if (contentBlock.type === 'thinking') {
              const partId = `part_${subAgentId}_thinking_${blockIndex}_${Date.now()}`;
              addSubAgentMessagePart(subAgentId, {
                id: partId,
                type: 'thinking',
                content: '',
                order: blockIndex,
              });
              subAgentStreamBlocksRef.current.set(`${subAgentId}-${blockIndex}`, partId);
            } else if (contentBlock.type === 'tool_use') {
              const partId = `part_${subAgentId}_tool_${blockIndex}_${Date.now()}`;
              addSubAgentMessagePart(subAgentId, {
                id: partId,
                type: 'tool',
                toolData: {
                  id: contentBlock.id,
                  toolName: contentBlock.name,
                  toolInput: {},
                  isError: false,
                },
                order: blockIndex,
              });
              subAgentStreamBlocksRef.current.set(`${subAgentId}-${blockIndex}`, partId);
              console.log('🎯 [SIDECHAIN] Added tool_use to sub-agent:', contentBlock.name);
            }
          }
          
          // 处理content_block_delta - 累积内容
          if (streamEvent.type === 'content_block_delta' && streamEvent.delta) {
            const blockIndex = streamEvent.index;
            const delta = streamEvent.delta;
            const partId = subAgentStreamBlocksRef.current.get(`${subAgentId}-${blockIndex}`);
            
            if (partId) {
              // 获取当前store中的消息流来找到对应的part
              const store = useSubAgentStore.getState();
              const task = store.activeTasks.get(subAgentId);
              if (task) {
                for (const msg of task.messageFlow) {
                  const part = msg.messageParts.find(p => p.id === partId);
                  if (part) {
                    if (delta.type === 'text_delta' && delta.text) {
                      const newContent = (part.content || '') + delta.text;
                      addSubAgentMessagePart(subAgentId, {
                        ...part,
                        content: newContent,
                      });
                      // 只在有实际内容时打印日志
                      if (newContent.length % 100 < 10) {
                        console.log('🎯 [SIDECHAIN] Text accumulated:', newContent.length, 'chars');
                      }
                    } else if (delta.type === 'thinking_delta' && delta.thinking) {
                      const newContent = (part.content || '') + delta.thinking;
                      addSubAgentMessagePart(subAgentId, {
                        ...part,
                        content: newContent,
                      });
                    }
                    break;
                  }
                }
              }
            }
          }
        }
        
        // 处理assistant类型的sidechain消息（包含tool_use）
        if (eventData.type === 'assistant' && eventData.message) {
          const message = eventData.message as { content?: unknown[]; role?: string };
          console.log('🎯 [SIDECHAIN] Processing assistant message, blocks:', message.content?.length || 0);
          
          if (message.content && Array.isArray(message.content)) {
            for (let i = 0; i < message.content.length; i++) {
              const block = message.content[i] as any;
              
              if (block.type === 'text' && block.text) {
                console.log('🎯 [SIDECHAIN] Adding text from assistant:', block.text.substring(0, 50));
                addSubAgentMessagePart(subAgentId, {
                  id: `part_${subAgentId}_text_${i}_${Date.now()}`,
                  type: 'text',
                  content: block.text,
                  order: i,
                });
              } else if (block.type === 'thinking' && block.thinking) {
                addSubAgentMessagePart(subAgentId, {
                  id: `part_${subAgentId}_thinking_${i}_${Date.now()}`,
                  type: 'thinking',
                  content: block.thinking,
                  order: i,
                });
              } else if (block.type === 'tool_use') {
                addSubAgentMessagePart(subAgentId, {
                  id: `part_${subAgentId}_tool_${i}_${Date.now()}`,
                  type: 'tool',
                  toolData: {
                    id: block.id,
                    toolName: block.name,
                    toolInput: block.input || {},
                    isError: false,
                  },
                  order: i,
                });
                console.log('🎯 [SIDECHAIN] Added tool_use from assistant:', block.name);
              }
            }
          }
        }
        
        // 处理user类型的sidechain消息
        // 注意：跳过用户输入文本（任务提示），只处理tool_result
        if (eventData.type === 'user' && eventData.message) {
          const message = eventData.message as { content?: unknown[]; role?: string };
          
          if (message.content && Array.isArray(message.content)) {
            for (const block of message.content) {
              const b = block as any;
              
              // 跳过用户文本输入（任务提示），因为TaskTool已经显示了
              if (b.type === 'text') {
                console.log('🎯 [SIDECHAIN] Skipping user text (task prompt already shown)');
                continue;
              }
              
              // 处理tool_result - 更新对应工具的结果
              if (b.type === 'tool_result' && b.tool_use_id) {
                console.log('🎯 [SIDECHAIN] Tool result for:', b.tool_use_id, 'error:', b.is_error);
                // 工具结果会在历史加载时完整显示，这里暂时跳过
              }
            }
          }
        }
        
        // 所有sidechain消息处理完毕，不继续处理主Agent的逻辑
        return;
      }

      // T024: Detect partial message streaming (SDKPartialAssistantMessage)
      // New format: eventData.type === 'stream_event' with nested eventData.event
      if (eventData.type === 'stream_event' && eventData.event) {
        const streamEvent = eventData.event;
        console.log('🌊 [STREAMING] Detected stream_event:', streamEvent.type, 'Full event:', JSON.stringify(eventData).substring(0, 200));
        
        // ⚡ Mark that this message is being processed via streaming
        // This flag persists even after message_stop to prevent duplicate processing from assistant message
        streamingStateRef.current.wasStreamProcessed = true;

      // Handle message_start: Initialize AI message
      if (streamEvent.type === 'message_start') {
        if (!aiMessageIdRef.current) {
          const message = {
            content: '',
            role: 'assistant' as const,
          };
          addMessage(message);
          const state = useAgentStore.getState();
          aiMessageIdRef.current = state.messages[state.messages.length - 1].id;
          streamingStateRef.current.currentMessageId = aiMessageIdRef.current;
          streamingStateRef.current.isStreaming = true;
          console.log('🌊 [STREAMING] message_start: Created new AI message with ID:', aiMessageIdRef.current);
        } else {
          console.log('🌊 [STREAMING] message_start: AI message already exists, skipping:', aiMessageIdRef.current);
        }
        return;
      }

      // Handle content_block_start: Prepare for new content block
      if (streamEvent.type === 'content_block_start') {
        const blockIndex = streamEvent.index;
        const contentBlock = streamEvent.content_block;
        
        if (!aiMessageIdRef.current) {
          // Create AI message if not exists
          const message = {
            content: '',
            role: 'assistant' as const,
          };
          addMessage(message);
          const state = useAgentStore.getState();
          aiMessageIdRef.current = state.messages[state.messages.length - 1].id;
          streamingStateRef.current.currentMessageId = aiMessageIdRef.current;
          streamingStateRef.current.isStreaming = true;
        }

        // Initialize streaming block for this content block
        const blockId = `block-${aiMessageIdRef.current}-${blockIndex}`;
        const currentTime = Date.now();
        
        // ⚡ CRITICAL: Check if block already exists to prevent duplicates
        if (streamingStateRef.current.activeBlocks.has(blockId)) {
          console.warn('🌊 [STREAMING] content_block_start: Block already exists, skipping:', blockId);
          return;
        }
        
        if (contentBlock.type === 'text') {
          // Create initial text part with empty content
          addTextPartToMessage(aiMessageIdRef.current, '');
          
          // Get the part ID of the newly created part
          const state = useAgentStore.getState();
          const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
          const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
          const partId = latestPart?.id;
          
          const streamingBlock: StreamingBlock = {
            blockId,
            type: 'text',
            content: '',
            isComplete: false,
            messageId: aiMessageIdRef.current,
            partId, // Store the part ID for updates
            startedAt: currentTime,
            lastUpdatedAt: currentTime,
          };
          streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
          console.log('🌊 [STREAMING] content_block_start: Initialized text block', blockId, 'partId:', partId);
        } else if (contentBlock.type === 'thinking') {
          // Create initial thinking part with empty content
          addThinkingPartToMessage(aiMessageIdRef.current, '');
          
          // Get the part ID of the newly created part
          const state = useAgentStore.getState();
          const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
          const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
          const partId = latestPart?.id;
          
          const streamingBlock: StreamingBlock = {
            blockId,
            type: 'thinking',
            content: '',
            isComplete: false,
            messageId: aiMessageIdRef.current,
            partId, // Store the part ID for updates
            startedAt: currentTime,
            lastUpdatedAt: currentTime,
          };
          streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
          console.log('🤔 [STREAMING] content_block_start: Initialized thinking block', blockId, 'partId:', partId);
        } else if (contentBlock.type === 'tool_use') {
          // Initialize tool use block with empty/initial input
          console.log('🔧 [STREAMING] content_block_start: Processing tool_use', {
            toolName: contentBlock.name,
            claudeId: contentBlock.id,
            blockId,
            messageId: aiMessageIdRef.current
          });
          
          // 🎯 如果是Task工具，注册它以便后续关联子Agent
          if (contentBlock.name === 'Task') {
            const taskSessionId = currentSessionId || eventData.sessionId || eventData.session_id;
            if (taskSessionId && contentBlock.id) {
              console.log('🎯 [TASK] Registering Task tool for sub-agent tracking:', contentBlock.id);
              registerTaskTool(contentBlock.id, taskSessionId);
            }
          }
          
          const toolData = {
            toolName: contentBlock.name,
            toolInput: {},  // Start with empty input, will be updated by deltas
            isExecuting: true,
            claudeId: contentBlock.id,
          };
          
          try {
            addToolPartToMessage(aiMessageIdRef.current, toolData);
            console.log('🔧 [STREAMING] content_block_start: addToolPartToMessage completed');
            
            // Get the part ID of the newly created tool part
            const state = useAgentStore.getState();
            console.log('🔧 [STREAMING] content_block_start: Got store state, messages count:', state.messages.length);
            
            const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
            console.log('🔧 [STREAMING] content_block_start: Found current message:', !!currentMessage, 'parts count:', currentMessage?.messageParts?.length);
            
            const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
            console.log('🔧 [STREAMING] content_block_start: Latest part:', {
              exists: !!latestPart,
              type: latestPart?.type,
              hasToolData: !!latestPart?.toolData,
              toolDataId: latestPart?.toolData?.id
            });
            
            const partId = latestPart?.toolData?.id;  // Tool part stores ID in toolData
            
            if (!partId) {
              console.error('🔧 [STREAMING] content_block_start: ⚠️ partId is undefined! Latest part:', latestPart);
            }
            
            const streamingBlock: StreamingBlock = {
              blockId,
              type: 'tool_use',
              content: '',  // Will store partial JSON string
              isComplete: false,
              messageId: aiMessageIdRef.current,
              partId,  // Store the tool part ID for updates
              startedAt: currentTime,
              lastUpdatedAt: currentTime,
            };
            streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
            console.log('🔧 [STREAMING] content_block_start: ✅ Initialized tool_use block', contentBlock.name, 'blockId:', blockId, 'partId:', partId, 'claudeId:', contentBlock.id);
          } catch (toolError) {
            console.error('🔧 [STREAMING] content_block_start: ❌ Error processing tool_use:', toolError);
            throw toolError;  // Re-throw to be caught by outer try-catch
          }
        }
        return;
      }

      // Handle content_block_delta: Accumulate content deltas
      if (streamEvent.type === 'content_block_delta' && aiMessageIdRef.current) {
        const blockIndex = streamEvent.index;
        const delta = streamEvent.delta;
        const blockId = `block-${aiMessageIdRef.current}-${blockIndex}`;
        const currentTime = Date.now();

        if (delta.type === 'text_delta' && delta.text !== undefined) {
          // T025: Partial text block handling
          let streamingBlock = streamingStateRef.current.activeBlocks.get(blockId);

          if (!streamingBlock) {
            // Create new streaming block if not exists (fallback - missed content_block_start)
            console.warn(`🌊 [STREAMING] content_block_delta: Missing content_block_start for text block, creating fallback`);
            
            // Create initial text part with empty content
            addTextPartToMessage(aiMessageIdRef.current, '');
            
            // Get the part ID of the newly created part
            const state = useAgentStore.getState();
            const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
            const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
            const partId = latestPart?.id;
            
            streamingBlock = {
              blockId,
              type: 'text',
              content: delta.text,
              isComplete: false,
              messageId: aiMessageIdRef.current,
              partId,
              startedAt: currentTime,
              lastUpdatedAt: currentTime,
            };
            streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
            console.log(`🌊 [STREAMING] content_block_delta: Created text block ${blockId} (fallback) with partId: ${partId}, content: "${delta.text}"`);
          } else {
            // Accumulate delta content (character-by-character)
            streamingBlock.content += delta.text;
            streamingBlock.lastUpdatedAt = currentTime;
            console.log(`🌊 [STREAMING] content_block_delta: Accumulated text delta "${delta.text}" to block ${blockId}, total: "${streamingBlock.content.substring(0, 50)}..."`);
          }

          // T028: Schedule UI update with RAF throttling
          scheduleUpdate(blockId, streamingBlock.content, 'text');
        } else if (delta.type === 'thinking_delta' && delta.thinking !== undefined) {
          // T035: Partial thinking block handling
          let streamingBlock = streamingStateRef.current.activeBlocks.get(blockId);

          if (!streamingBlock) {
            // Create new streaming block if not exists (fallback - missed content_block_start)
            console.warn(`🤔 [STREAMING] content_block_delta: Missing content_block_start for thinking block, creating fallback`);
            
            // Create initial thinking part with empty content
            addThinkingPartToMessage(aiMessageIdRef.current, '');
            
            // Get the part ID of the newly created part
            const state = useAgentStore.getState();
            const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
            const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
            const partId = latestPart?.id;
            
            streamingBlock = {
              blockId,
              type: 'thinking',
              content: delta.thinking,
              isComplete: false,
              messageId: aiMessageIdRef.current,
              partId,
              startedAt: currentTime,
              lastUpdatedAt: currentTime,
            };
            streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
            console.log(`🤔 [STREAMING] content_block_delta: Created thinking block ${blockId} (fallback) with partId: ${partId}, content: "${delta.thinking}"`);
          } else {
            // Accumulate delta content (character-by-character)
            streamingBlock.content += delta.thinking;
            streamingBlock.lastUpdatedAt = currentTime;
            console.log(`🤔 [STREAMING] content_block_delta: Accumulated thinking delta "${delta.thinking}" to block ${blockId}, total: "${streamingBlock.content.substring(0, 50)}..."`);
          }

          // T036: Schedule UI update with RAF throttling
          scheduleUpdate(blockId, streamingBlock.content, 'thinking');
        } else if (delta.type === 'input_json_delta') {
          // T041: Handle partial tool input updates
          // CRITICAL: partial_json is an INCREMENTAL fragment, must be accumulated!
          const partialJsonFragment = delta.partial_json || '';
          
          let streamingBlock = streamingStateRef.current.activeBlocks.get(blockId);
          
          if (!streamingBlock) {
            // Fallback: Create tool if content_block_start was missed
            console.warn(`🔧 [STREAMING] content_block_delta: Missing content_block_start for tool block, creating fallback`);
            
            // Need content_block info for fallback
            if (!streamEvent.content_block || streamEvent.content_block.type !== 'tool_use') {
              console.error('🔧 [STREAMING] content_block_delta: Missing content_block info for tool, cannot create fallback');
              return;
            }
            
            const toolName = streamEvent.content_block.name;
            const claudeId = streamEvent.content_block.id;
            
            // Create tool with empty input first, will be updated as JSON accumulates
            addToolPartToMessage(aiMessageIdRef.current, {
              toolName,
              toolInput: {},  // Start empty, will accumulate
              isExecuting: true,
              claudeId,
            });
            
            // Get the part ID of the newly created tool part
            const state = useAgentStore.getState();
            const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
            const latestPart = currentMessage?.messageParts?.[currentMessage.messageParts.length - 1];
            const partId = latestPart?.toolData?.id;
            
            streamingBlock = {
              blockId,
              type: 'tool_use',
              content: partialJsonFragment,  // Start accumulating
              isComplete: false,
              messageId: aiMessageIdRef.current,
              partId,
              startedAt: currentTime,
              lastUpdatedAt: currentTime,
            };
            streamingStateRef.current.activeBlocks.set(blockId, streamingBlock);
            console.log(`🔧 [STREAMING] content_block_delta: Created tool_use block (fallback)`, toolName, 'blockId:', blockId, 'partId:', partId, 'initial fragment:', partialJsonFragment);
          } else {
            // CRITICAL FIX: Accumulate partial JSON fragments with +=, not replace with =
            streamingBlock.content += partialJsonFragment;
            streamingBlock.lastUpdatedAt = currentTime;
            
            // Only try to parse and update UI when JSON looks complete (ends with })
            // This prevents constant parsing errors during streaming
            const accumulatedJson = streamingBlock.content;
            const trimmed = accumulatedJson.trim();
            
            if (streamingBlock.partId && trimmed.endsWith('}')) {
              try {
                const toolInput = JSON.parse(accumulatedJson);
                updateToolPartInMessage(aiMessageIdRef.current, streamingBlock.partId, {
                  toolInput,
                });
                console.log(`🔧 [STREAMING] content_block_delta: Updated tool_use block ${blockId}, parsed complete JSON`);
              } catch (e) {
                // JSON not yet complete, this is normal during streaming - don't log as warning
                console.log(`🔧 [STREAMING] content_block_delta: JSON not yet complete for ${blockId}, length: ${accumulatedJson.length}`);
              }
            }
          }
        }
        return;
      }

      // Handle content_block_stop: Finalize content block
      if (streamEvent.type === 'content_block_stop' && aiMessageIdRef.current) {
        const blockIndex = streamEvent.index;
        const blockId = `block-${aiMessageIdRef.current}-${blockIndex}`;
        const streamingBlock = streamingStateRef.current.activeBlocks.get(blockId);
        
        if (streamingBlock) {
          streamingBlock.isComplete = true;
          console.log(`🌊 [STREAMING] content_block_stop: Block ${blockId} complete, type: ${streamingBlock.type}, content length: ${streamingBlock.content.length}`);
          
          // ⚡ CRITICAL: Immediately flush any pending RAF update for THIS block
          // This ensures all accumulated content is saved before we delete the block
          const state = streamingStateRef.current;
          if (state.pendingUpdate?.blockId === blockId) {
            console.log(`🌊 [STREAMING] content_block_stop: Flushing pending RAF for ${blockId} immediately`);
            
            // Cancel the RAF
            if (state.rafId !== null) {
              cancelAnimationFrame(state.rafId);
              state.rafId = null;
            }
            
            // Execute the pending update NOW
            const pending = state.pendingUpdate;
            if (streamingBlock.partId) {
              if (pending.type === 'text') {
                updateTextPartInMessage(aiMessageIdRef.current, streamingBlock.partId, pending.content);
              } else if (pending.type === 'thinking') {
                updateThinkingPartInMessage(aiMessageIdRef.current, streamingBlock.partId, pending.content);
              }
              console.log(`🌊 [STREAMING] content_block_stop: Flushed ${pending.type} content for ${blockId}, length: ${pending.content.length}`);
            }
            
            state.pendingUpdate = null;
          } else if ((streamingBlock.type === 'text' || streamingBlock.type === 'thinking') && streamingBlock.partId) {
            // No pending RAF, but ensure final content is in store
            // (This handles the case where RAF already executed but we want to be sure)
            console.log(`🌊 [STREAMING] content_block_stop: Final check - ensuring ${streamingBlock.type} content saved, length: ${streamingBlock.content.length}`);
            if (streamingBlock.type === 'text') {
              updateTextPartInMessage(aiMessageIdRef.current, streamingBlock.partId, streamingBlock.content);
            } else if (streamingBlock.type === 'thinking') {
              updateThinkingPartInMessage(aiMessageIdRef.current, streamingBlock.partId, streamingBlock.content);
            }
          } else if (streamingBlock.type === 'tool_use' && streamingBlock.partId && streamingBlock.content) {
            // ⚡ CRITICAL: Final parse of accumulated tool input JSON when block stops
            // This ensures the complete tool parameters are saved even if they weren't parseable during streaming
            console.log(`🔧 [STREAMING] content_block_stop: Finalizing tool_use block ${blockId}, accumulated JSON length: ${streamingBlock.content.length}`);
            try {
              const toolInput = JSON.parse(streamingBlock.content);
              updateToolPartInMessage(aiMessageIdRef.current, streamingBlock.partId, {
                toolInput,
              });
              console.log(`🔧 [STREAMING] content_block_stop: Successfully parsed final tool input for ${blockId}`);
            } catch (e) {
              console.error(`🔧 [STREAMING] content_block_stop: Failed to parse final tool JSON for ${blockId}:`, e, 'content:', streamingBlock.content.substring(0, 200));
            }
          }
          
          // Now safe to delete block
          streamingStateRef.current.activeBlocks.delete(blockId);
          console.log(`🌊 [STREAMING] content_block_stop: Cleaned up block ${blockId}`);
        }
        return;
      }

      // Handle message_delta: Message-level updates (e.g., stop_reason)
      if (streamEvent.type === 'message_delta') {
        console.log('🌊 [STREAMING] message_delta:', streamEvent.delta);
        // Usually contains stop_reason or usage updates - can be handled if needed
        return;
      }

      // Handle message_stop: Finalize entire message
      if (streamEvent.type === 'message_stop') {
        if (streamingStateRef.current.isStreaming) {
          console.log('🌊 [STREAMING] message_stop: Finalizing all streaming blocks, count:', streamingStateRef.current.activeBlocks.size);
          
          const messageId = aiMessageIdRef.current;
          const state = streamingStateRef.current;
          
          // ⚡ CRITICAL: Flush pending RAF immediately if exists
          if (state.pendingUpdate && state.rafId !== null) {
            console.log(`🌊 [STREAMING] message_stop: Flushing pending RAF for ${state.pendingUpdate.blockId}`);
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
            
            const pending = state.pendingUpdate;
            const block = state.activeBlocks.get(pending.blockId);
            if (block && block.partId && messageId) {
              if (pending.type === 'text') {
                updateTextPartInMessage(messageId, block.partId, pending.content);
              } else if (pending.type === 'thinking') {
                updateThinkingPartInMessage(messageId, block.partId, pending.content);
              }
              console.log(`🌊 [STREAMING] message_stop: Flushed ${pending.type} content, length: ${pending.content.length}`);
            }
            state.pendingUpdate = null;
          }
          
          // Final pass: ensure all blocks have their content saved
          if (messageId) {
            state.activeBlocks.forEach((block) => {
              block.isComplete = true;
              
              if ((block.type === 'text' || block.type === 'thinking') && block.partId) {
                console.log(`🌊 [STREAMING] message_stop: Final check for ${block.type} block ${block.blockId}, length: ${block.content.length}`);
                if (block.type === 'text') {
                  updateTextPartInMessage(messageId, block.partId, block.content);
                } else if (block.type === 'thinking') {
                  updateThinkingPartInMessage(messageId, block.partId, block.content);
                }
              } else if (!block.partId) {
                console.error(`❌ [STREAMING] message_stop: Missing partId for block ${block.blockId}, content LOST:`, block.content.substring(0, 100));
              }
            });
          }
          
          state.isStreaming = false;
          state.currentMessageId = null;
          state.activeBlocks.clear();
          console.log('🌊 [STREAMING] message_stop: All blocks finalized and cleared');
        }
        return;
      }

      // Unknown stream_event type - log for debugging
      console.warn('🌊 [STREAMING] Unknown stream_event type:', streamEvent.type);
      return;
    }

    // Handle direct error messages from Claude Code SDK
    if (eventData.type === 'error') {
      console.error('Claude Code SDK error:', eventData);
      setAiTyping(false);
      setIsInitializingSession(false);
      abortControllerRef.current = null;

      let errorMessage = '';

      // 处理从后端传来的结构化错误（包含 subtype 和 message）
      if (eventData.subtype && eventData.message) {
        console.log('📋 Processing structured error with subtype:', eventData.subtype);

        // 根据 subtype 生成不同的错误标题
        const errorTitles: Record<string, string> = {
          'error_during_execution': t('agentChat.executionError'),
          'error_max_turns': t('agentChat.maxTurnsReached'),
          'error_max_budget_usd': t('agentChat.maxBudgetReached'),
          'error_max_structured_output_retries': t('agentChat.maxRetriesReached')
        };

        const errorTitle = errorTitles[eventData.subtype] || t('agentChat.processingError');
        errorMessage = `❌ **${errorTitle}**\n\n${eventData.message}`;

        // 添加建议操作
        errorMessage += `\n\n**${t('agentChatPanel.errors.suggestedActions')}**\n`;
        if (eventData.subtype === 'error_max_budget_usd') {
          errorMessage += `- ${t('agentChatPanel.errors.checkBudget')}\n`;
        } else if (eventData.subtype === 'error_max_turns') {
          errorMessage += `- ${t('agentChatPanel.errors.increaseMaxTurns')}\n`;
        }
        errorMessage += `- ${t('agentChatPanel.errors.resendMessage')}\n`;
        errorMessage += `- ${t('agentChatPanel.errors.refreshPage')}`;
      }
      // 处理其他类型的错误
      else if (eventData.error === 'Claude Code SDK failed' && eventData.message && typeof eventData.message === 'string') {
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

      // Add error message
      if (!aiMessageIdRef.current) {
        addMessage({
          content: errorMessage,
          role: 'assistant'
        });
      } else {
        addTextPartToMessage(aiMessageIdRef.current, '\n\n' + errorMessage);
      }
      return;
    }

    // Handle session initialization
    if (eventData.type === 'system' && eventData.subtype === 'init' && (eventData.sessionId || eventData.session_id)) {
      const newSessionId = eventData.sessionId || eventData.session_id;
      console.log('Setting session ID from AI response:', newSessionId);

      // 会话初始化完成，关闭初始化提示
      setIsInitializingSession(false);

      // Only set session ID if we don't have one (new session created by AI)
      if (!currentSessionId && newSessionId) {
        setCurrentSessionId(newSessionId);
        // This is a new session being created
        setIsNewSession(true);
        // Update URL with new session ID
        if (onSessionChange) {
          onSessionChange(newSessionId);
        }
        // Refresh sessions list when new session is created
        queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });
      }
      return;
    }

    // 🔧 处理 MCP 状态事件
    if (eventData.type === 'mcp_status') {
      console.log('📡 MCP Status Event:', eventData);

      if (eventData.subtype === 'connection_failed') {
        const failedServers = (eventData as any).failedServers || [];
        console.warn('🚨 MCP服务器连接失败:', failedServers);

        // 更新 MCP 状态到 store
        updateMcpStatus({
          hasError: true,
          connectionErrors: failedServers,
          lastError: `连接失败: ${failedServers.map((s: any) => s.name).join(', ')}`
        });
      } else if (eventData.subtype === 'connection_success') {
        const connectedServers = (eventData as any).connectedServers || [];
        console.log('✅ MCP服务器连接成功:', connectedServers.map((s: any) => s.name));

        // 更新 MCP 状态到 store
        updateMcpStatus({
          hasError: false,
          connectedServers: connectedServers,
          connectionErrors: [],
          lastError: null
        });
      }
      return;
    }

    // 🚨 处理 MCP 执行错误事件
    if (eventData.type === 'mcp_error') {
      console.log('❌ MCP Error Event:', eventData);

      if (eventData.subtype === 'execution_failed') {
        const errorData = eventData as any;
        const toolName = errorData.tool || '未知工具';
        const errorMessage = errorData.error || '执行失败';
        const details = errorData.details || '';

        console.error('❌ MCP工具执行失败:', { tool: toolName, error: errorMessage, details });

        // 更新 MCP 状态到 store
        updateMcpStatus({
          hasError: true,
          lastError: `工具执行失败: ${toolName} - ${errorMessage}`,
          lastErrorDetails: details
        });
      }
      return;
    }

    // 🔄 处理自动压缩通知事件 (auto-compaction)
    // 当 Claude SDK 自动压缩上下文窗口时，通知用户
    if (eventData.type === 'auto_compact') {
      const compactData = eventData as any;
      const preTokens = compactData.preTokens || 0;
      const trigger = compactData.trigger || 'auto';
      console.log('🔄 [AUTO-COMPACT] Context window auto-compacted:', { trigger, preTokens });

      // 确保有 AI 消息 placeholder
      if (!aiMessageIdRef.current) {
        const message = {
          content: '',
          role: 'assistant' as const,
        };
        addMessage(message);
        const state = useAgentStore.getState();
        aiMessageIdRef.current = state.messages[state.messages.length - 1].id;
        console.log('🔄 [AUTO-COMPACT] Created new AI message with ID:', aiMessageIdRef.current);
      }

      // 构建压缩通知内容
      const tokenInfo = preTokens > 0
        ? t('compactSummary.autoCompactWithTokens', { tokens: preTokens.toLocaleString() })
        : t('compactSummary.autoCompact');

      // 添加 compactSummary 到消息
      addCompactSummaryPartToMessage(aiMessageIdRef.current, tokenInfo);

      return;
    }

    // Handle frontend tool invocations from the FrontendToolBridge.
    if (eventData.type === 'frontend_tool_call') {
      const d = eventData as Record<string, unknown>;
      if (!d.toolCallId || !d.toolName) {
        console.warn('[FrontendTool] Malformed frontend_tool_call event:', d);
        return;
      }
      addPendingFrontendTool({
        toolCallId: d.toolCallId as string,
        toolName: d.toolName as string,
        args: (d.args as Record<string, unknown>) || {},
        sessionId: d.sessionId as string,
        agentId: d.agentId as string,
        timestamp: Date.now(),
      });
      return;
    }

    // 🔄 Handle A2A stream start event (real-time notification from backend)
    // Supports A2A standard protocol with contextId and taskId
    if (eventData.type === 'a2a_stream_start') {
      const a2aData = eventData as any as {
        sessionId: string;
        contextId?: string;  // A2A standard contextId
        taskId?: string;     // A2A standard taskId
        agentUrl: string;
        message: string;
        timestamp: number;
      };
      setA2AStreamStart(a2aData.agentUrl, a2aData.sessionId, a2aData.message);
      return;
    }

    // 🔄 Handle A2A stream data event (A2A standard protocol events)
    // These events are stored in the activeA2AStreams for real-time display
    if (eventData.type === 'a2a_stream_data') {
      const a2aData = eventData as any as {
        sessionId: string;
        agentUrl: string;  // Agent URL for frontend matching
        event: any;  // SDK message event (assistant, user, system, result)
        timestamp: number;
      };
      // Store the event in activeA2AStreams for real-time display in A2ACallTool
      if (a2aData.agentUrl) {
        addA2AStreamEvent(a2aData.agentUrl, {
          type: a2aData.event?.type || 'unknown',
          sessionId: a2aData.event?.sessionId,
          message: a2aData.event?.message,
          timestamp: a2aData.timestamp,
        });
      }
      return;
    }

    // 🔄 Handle A2A stream end event
    // Supports A2A standard protocol with finalState
    if (eventData.type === 'a2a_stream_end') {
      const a2aData = eventData as any as {
        sessionId: string;
        success: boolean;
        error?: string;
        finalState?: string;  // A2A standard TaskState
        timestamp: number;
      };
      // Find the agentUrl from active streams by sessionId
      const state = useAgentStore.getState();
      for (const [agentUrl, stream] of Object.entries(state.activeA2AStreams)) {
        if (stream.sessionId === a2aData.sessionId) {
          setA2AStreamEnd(agentUrl);
          break;
        }
      }
      return;
    }

    // Handle session resume notification
    if (eventData.type === 'session_resumed' && eventData.subtype === 'new_branch') {
      const resumeData = eventData as any as {
        originalSessionId: string;
        newSessionId: string;
        message: string;
        sessionId: string;
      };

      console.log('🔄 Session resumed with new branch:', resumeData);
      console.log('🔄 Updating session ID from', currentSessionId, 'to', resumeData.newSessionId);

      // 会话恢复完成，关闭初始化提示
      setIsInitializingSession(false);

      // Update session ID to the new one (this will trigger useAgentSessionMessages to reload history)
      setCurrentSessionId(resumeData.newSessionId);
      // This is a resumed session creating a new branch
      setIsNewSession(true); // 恢复会话创建新分支，视为新会话

      // Update URL with new session ID
      if (onSessionChange) {
        console.log('🔄 Updating URL with new session ID:', resumeData.newSessionId);
        onSessionChange(resumeData.newSessionId);
      }

      // Show session resume notification
      addMessage({
        content: `${t('agentChat.sessionResumed')}\n\n${resumeData.message}\n\n${t('agentChat.sessionIdUpdated')}`,
        role: 'assistant'
      });

      // Refresh sessions list to include the new session
      queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });

      // 🆕 TabManager 会话恢复处理
      if (currentSessionId && resumeData.originalSessionId && resumeData.newSessionId) {
        // 立即更新TabManager状态
        tabManager.handleSessionResume(
          agentId,
          resumeData.originalSessionId,
          resumeData.newSessionId
        );

        // 记录恢复事件以供智能监听使用
        tabManager.recordSessionResume(
          agentId,
          resumeData.originalSessionId,
          resumeData.newSessionId
        );

        console.log(`🎯 TabManager updated for session resume: ${resumeData.originalSessionId} → ${resumeData.newSessionId}`);
      }

      console.log('✅ Session resume handling complete');
      return;
    }

    // Handle Claude Code SDK initialization
    if (eventData.type === 'system' && eventData.subtype === 'init') {
      // Claude Code SDK initialization - silently initialize without showing message
      // Just ensure we have an AI message ID ready for when content starts coming
      return;
    }

    // Handle assistant messages
    if (eventData.type === 'assistant') {
      // ⚡ CRITICAL: Skip if this message was already processed via stream_event
      // When includePartialMessages is true, we receive both stream_event AND a final assistant message
      // We should only process the stream_event messages to avoid duplicates
      // Use wasStreamProcessed flag instead of isStreaming because message_stop clears isStreaming
      // but the assistant message arrives AFTER message_stop
      if (streamingStateRef.current.wasStreamProcessed) {
        console.log('📝 [ASSISTANT] Skipping assistant message - already processed via stream_event (prevents duplicates)');
        return;
      }
      
      // Add AI message placeholder if not added yet
      if (!aiMessageIdRef.current) {
        const message = {
          content: '',
          role: 'assistant' as const
        };
        addMessage(message);
        // Get the ID of the message we just added
        const state = useAgentStore.getState();
        aiMessageIdRef.current = state.messages[state.messages.length - 1].id;
        console.log('📝 Created new AI message with ID:', aiMessageIdRef.current);
      }

      // Handle tool use and text content
      if (eventData.message && typeof eventData.message === 'object' && 'content' in eventData.message && eventData.message.content && aiMessageIdRef.current) {
        console.log('📝 Processing assistant message content blocks:', eventData.message.content.length, 'aiMessageId:', aiMessageIdRef.current);
        for (const block of eventData.message.content as Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string }>) {
          console.log('📝 Processing block:', { type: block.type, hasText: !!block.text, hasThinking: !!block.thinking, textLength: block.text?.length, thinkingLength: block.thinking?.length, toolName: block.name });
          if (block.type === 'text') {
            // Add text as a separate part
            if (block.text) {
              console.log('📝 Adding text part:', block.text.substring(0, 100) + (block.text.length > 100 ? '...' : ''));
              // Check if this is a response to /compact command
              if (isCompactCommand) {
                console.log('📦 Detected /compact command response, adding as compactSummary');
                addTextPartToMessage(aiMessageIdRef.current, block.text);
              } else {
                addTextPartToMessage(aiMessageIdRef.current, block.text);
              }
            } else {
              console.warn('📝 Text block has no text content');
            }
          } else if (block.type === 'thinking') {
            // Add thinking as a separate part
            if (block.thinking) {
              console.log('🤔 Adding thinking part:', block.thinking.substring(0, 100) + (block.thinking.length > 100 ? '...' : ''));
              addThinkingPartToMessage(aiMessageIdRef.current, block.thinking);
            } else {
              console.warn('🤔 Thinking block has no thinking content');
            }
          } else if (block.type === 'tool_use') {
            // Add tool usage as a separate part
            if (block.name) {
              console.log('📝 Adding tool part:', block.name, 'id:', block.id);
              // Special logging for BashOutput
              if (block.name === 'BashOutput') {
                console.log('🐚 [BashOutput] Tool use detected, claudeId:', block.id, 'input:', block.input);
              }
              const toolData = {
                toolName: block.name,
                toolInput: (block.input as Record<string, unknown>) || {},
                isExecuting: true,
                claudeId: block.id // Store Claude's tool use ID for matching with results
              };
              addToolPartToMessage(aiMessageIdRef.current, toolData);
            }
          } else {
            console.log('📝 Unknown block type:', block.type);
          }
        }
      } else {
        console.warn('📝 No content or aiMessageId for assistant message:', {
          hasMessage: !!eventData.message,
          hasContent: !!(eventData.message as any)?.content,
          aiMessageId: aiMessageIdRef.current
        });
      }
      return;
    }

    // Handle tool results from user messages
    if (eventData.type === 'user') {
      // Tool results
      if (eventData.message && typeof eventData.message === 'object' && 'content' in eventData.message && eventData.message.content && aiMessageIdRef.current) {
        for (const block of eventData.message.content as Array<{ type: string; content?: unknown; is_error?: boolean; tool_use_id?: string }>) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            console.log('🔧 Processing tool_result for tool_use_id:', block.tool_use_id, 'content:', block.content, 'is_error:', block.is_error);
            // Find the tool by tool_use_id - search across ALL messages, not just current
            const state = useAgentStore.getState();
            let targetTool: any = null;
            let targetMessageId: string | null = null;

            // Search through all messages to find the tool with matching claudeId
            for (const message of state.messages) {
              if (message.messageParts) {
                const foundTool = message.messageParts.find((part: any) =>
                  part.type === 'tool' && part.toolData?.claudeId === block.tool_use_id
                );
                if (foundTool) {
                  targetTool = foundTool;
                  targetMessageId = message.id;
                  break;
                }
              }
            }

            console.log('🔧 Found target tool:', {
              toolData: targetTool?.toolData,
              messageId: targetMessageId,
              currentMessageId: aiMessageIdRef.current
            });

            if (targetTool?.toolData && targetMessageId) {
              // Update the corresponding tool with results
              const toolResult = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.map((c: { text?: string }) => c.text || String(c)).join('')
                  : JSON.stringify(block.content);

              console.log('🔧 Updating tool with result, setting isExecuting: false');
              
              // 🎯 Task工具特殊处理：追加结果文本到子Agent消息流
              if (targetTool.toolData.toolName === 'Task' && targetTool.toolData.claudeId) {
                const taskClaudeId = targetTool.toolData.claudeId;
                console.log('🎯 [TASK] Task tool completed, appending result to sub-agent flow:', taskClaudeId);
                
                // 从结果中提取文本内容并追加到消息流
                if (toolResult && typeof toolResult === 'string' && toolResult.trim()) {
                  addSubAgentMessagePart(taskClaudeId, {
                    id: `part_${taskClaudeId}_result_${Date.now()}`,
                    type: 'text',
                    content: toolResult,
                    order: 9999, // 排在最后
                  });
                  console.log('🎯 [TASK] Appended result text to sub-agent flow, length:', toolResult.length);
                }
              }
              
              // Special logging for BashOutput
              if (targetTool.toolData.toolName === 'BashOutput') {
                console.log('🐚 [BashOutput] Updating tool result:', {
                  toolId: targetTool.toolData.id,
                  messageId: targetMessageId,
                  toolResult: toolResult?.substring(0, 200),
                  rawContent: block.content
                });
              }
              updateToolPartInMessage(targetMessageId, targetTool.toolData.id, {
                toolResult,
                isError: block.is_error || false,
                isExecuting: false
              });
            } else {
              console.warn('🔧 No target tool found for tool_use_id:', block.tool_use_id);
              // Log all available tools for debugging
              const allTools = state.messages.flatMap(m =>
                (m.messageParts || [])
                  .filter((p: any) => p.type === 'tool')
                  .map((p: any) => ({
                    claudeId: p.toolData?.claudeId,
                    toolName: p.toolData?.toolName,
                    isExecuting: p.toolData?.isExecuting
                  }))
              );
              console.warn('🔧 Available tools:', allTools);
            }
          }
        }
      }
      return;
    }

    // Also check for tool results in assistant messages (alternative path)
    if (eventData.type === 'assistant' && eventData.message && typeof eventData.message === 'object' && 'content' in eventData.message && eventData.message.content && aiMessageIdRef.current) {
      for (const block of eventData.message.content as Array<{ type: string; content?: unknown; is_error?: boolean; tool_use_id?: string }>) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          console.log('🔧 Processing tool_result in assistant message for tool_use_id:', block.tool_use_id);
          // Find the tool by tool_use_id - search across ALL messages, not just current
          const state = useAgentStore.getState();
          let targetTool: any = null;
          let targetMessageId: string | null = null;

          // Search through all messages to find the tool with matching claudeId
          for (const message of state.messages) {
            if (message.messageParts) {
              const foundTool = message.messageParts.find((part: any) =>
                part.type === 'tool' && part.toolData?.claudeId === block.tool_use_id
              );
              if (foundTool) {
                targetTool = foundTool;
                targetMessageId = message.id;
                break;
              }
            }
          }

          console.log('🔧 Found target tool in assistant message:', {
            toolData: targetTool?.toolData,
            messageId: targetMessageId,
            currentMessageId: aiMessageIdRef.current
          });

          if (targetTool?.toolData && targetMessageId) {
            // Update the corresponding tool with results
            const toolResult = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: { text?: string }) => c.text || String(c)).join('')
                : JSON.stringify(block.content);

            console.log('🔧 Updating tool with result in assistant message, setting isExecuting: false');
            updateToolPartInMessage(targetMessageId, targetTool.toolData.id, {
              toolResult,
              isError: block.is_error || false,
              isExecuting: false
            });
          } else {
            console.warn('🔧 No target tool found for tool_use_id in assistant message:', block.tool_use_id);
          }
        }
      }
      return;
    }

    // Handle result events
    if (eventData.type === 'result') {
      console.log('Received result event:', { subtype: eventData.subtype, isSideChain: (eventData as any).isSideChain });

      // 只有主任务结束才停止 AI 输入状态（检查 isSideChain）
      const isSideChain = (eventData as any).isSideChain;
      if (!isSideChain) {
        console.log('Main task result received, stopping AI typing...');

        // T029: Mark all active streaming blocks as complete
        if (streamingStateRef.current.isStreaming) {
          console.log('🌊 [STREAMING] Finalizing all streaming blocks');
          streamingStateRef.current.activeBlocks.forEach((block) => {
            block.isComplete = true;
            console.log(`🌊 [STREAMING] Marked block ${block.blockId} as complete`);
          });
          streamingStateRef.current.isStreaming = false;
          streamingStateRef.current.currentMessageId = null;

          // Cancel any pending RAF updates
          if (streamingStateRef.current.rafId !== null) {
            cancelAnimationFrame(streamingStateRef.current.rafId);
            streamingStateRef.current.rafId = null;
          }

          // Clear active blocks after finalization
          streamingStateRef.current.activeBlocks.clear();
        }

        // Clear the abort controller and immediately stop typing
        abortControllerRef.current = null;
        setAiTyping(false);

        // Mark as successful response if result is successful
        if (eventData.subtype === 'success') {
          setHasSuccessfulResponse(true);
          console.log('✅ Marked session as having successful response for heartbeat');

          // 发送AI回复完成事件，通知其他组件刷新
          eventBus.emit(EVENTS.AI_RESPONSE_COMPLETE, {
            agentId: agentId,
            sessionId: currentSessionId,
            projectPath
          });
          console.log('📡 Emitted AI_RESPONSE_COMPLETE event');
        }
      } else {
        console.log('Side chain result received, continuing main task...');
      }

      // 只有主任务结束才处理最终消息（非 side chain）
      if (!isSideChain) {
        // If no AI message was created yet (e.g., only result event received), create one now
        if (!aiMessageIdRef.current && eventData.subtype === 'success') {
          console.log('📝 Creating AI message from result event - no assistant messages received');
          const resultContent = (eventData as any).result;
          if (resultContent && typeof resultContent === 'string') {
            const message = {
              content: '',
              role: 'assistant' as const
            };
            addMessage(message);
            // Get the ID of the message we just added
            const state = useAgentStore.getState();
            aiMessageIdRef.current = state.messages[state.messages.length - 1].id;

            // Add the result content as text
            if (aiMessageIdRef.current) {
              addTextPartToMessage(aiMessageIdRef.current, resultContent);
            }
            console.log('📝 Added result content to new AI message:', resultContent.substring(0, 100));
          } else {
            console.warn('📝 Result event with no content - creating empty success message');
            const message = {
              content: t('agentChat.taskComplete'),
              role: 'assistant' as const
            };
            addMessage(message);
            const state = useAgentStore.getState();
            aiMessageIdRef.current = state.messages[state.messages.length - 1].id;
          }
        }

        // Ensure all executing tools are marked as completed
        if (aiMessageIdRef.current) {
          const state = useAgentStore.getState();
          const currentMessage = state.messages.find(m => m.id === aiMessageIdRef.current);
          if (currentMessage?.messageParts) {
            currentMessage.messageParts.forEach((part: any) => {
              if (part.type === 'tool' && part.toolData?.isExecuting) {
                console.log('Force completing tool:', part.toolData.toolName, 'claudeId:', part.toolData.claudeId);
                updateToolPartInMessage(aiMessageIdRef.current!, part.toolData.id, {
                  isExecuting: false,
                  toolResult: part.toolData.toolResult || t('agentChat.executionCompleted')
                });
              }
            });
          }
        }

        // Handle different result types
        let finalMessage = '';
        if (eventData.subtype === 'success') {
          finalMessage = '';
        } else if (eventData.subtype === 'error_max_turns') {
          finalMessage = `\n\n${t('agentChat.maxTurnsReached')}`;
          if (eventData.permission_denials && eventData.permission_denials.length > 0) {
            finalMessage += `\n\n${t('agentChat.permissionDenials')}`;
            eventData.permission_denials.forEach((denial: { tool_name: string; tool_input: Record<string, unknown> }, index: number) => {
              finalMessage += `\n${index + 1}. ${denial.tool_name}: \`${denial.tool_input.command || denial.tool_input.description || JSON.stringify(denial.tool_input)}\``;
            });
            finalMessage += `\n\n${t('agentChat.permissionNote')}`;
          }
        } else if (eventData.subtype === 'error_during_execution') {
          finalMessage = `\n\n${t('agentChat.executionError')}`;
          // 如果有 errors 数组，显示具体错误信息
          if ((eventData as any).errors && Array.isArray((eventData as any).errors)) {
            finalMessage += `\n\n${(eventData as any).errors.join('\n')}`;
          }
        } else if (eventData.subtype === 'error_max_budget_usd') {
          finalMessage = `\n\n${t('agentChat.maxBudgetReached')}`;
          // 如果有 errors 数组，显示具体错误信息
          if ((eventData as any).errors && Array.isArray((eventData as any).errors)) {
            finalMessage += `\n\n${(eventData as any).errors.join('\n')}`;
          }
        } else if (eventData.subtype === 'error_max_structured_output_retries') {
          finalMessage = `\n\n${t('agentChat.maxRetriesReached')}`;
          // 如果有 errors 数组，显示具体错误信息
          if ((eventData as any).errors && Array.isArray((eventData as any).errors)) {
            finalMessage += `\n\n${(eventData as any).errors.join('\n')}`;
          }
        } else if (eventData.subtype === 'error') {
          // Generic error case
          finalMessage = `\n\n${t('agentChat.processingError')}`;
          // 如果有 errors 数组，显示具体错误信息
          if ((eventData as any).errors && Array.isArray((eventData as any).errors)) {
            finalMessage += `\n\n${(eventData as any).errors.join('\n')}`;
          }
        } else {
          finalMessage = `\n\n${t('agentChat.processingComplete')}`;
        }

        // Update final message content
        if (aiMessageIdRef.current && finalMessage) {
          addTextPartToMessage(aiMessageIdRef.current, finalMessage);
        }

        // Refresh sessions list only if we had a session (don't refresh on new session creation)
        if (currentSessionId) {
          queryClient.invalidateQueries({ queryKey: ['agent-sessions', agentId] });
        }
      }
      return;
    }
    } catch (error) {
      console.error('❌ [STREAMING] Error in handleStreamMessage:', error);
      console.error('❌ [STREAMING] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌ [STREAMING] Event data:', JSON.stringify(data).substring(0, 500));
      
      // Try to show error to user
      try {
        if (aiMessageIdRef.current) {
          addTextPartToMessage(aiMessageIdRef.current, `\n\n❌ **Streaming Error**: ${error instanceof Error ? error.message : String(error)}\n\nPlease refresh the page and try again.`);
        } else {
          addMessage({
            content: `❌ **Streaming Error**: ${error instanceof Error ? error.message : String(error)}\n\nPlease refresh the page and try again.`,
            role: 'assistant'
          });
        }
      } catch (innerError) {
        console.error('❌ [STREAMING] Failed to display error message:', innerError);
      }
      
      // Stop AI typing indicator
      setAiTyping(false);
    }
  }, [
    agentId,
    currentSessionId,
    projectPath,
    isCompactCommand,
    abortControllerRef,
    onSessionChange,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
    t,
    queryClient,
    addMessage,
    addTextPartToMessage,
    addThinkingPartToMessage,
    updateTextPartInMessage,
    updateThinkingPartInMessage,
    addCompactSummaryPartToMessage,
    addToolPartToMessage,
    updateToolPartInMessage,
    updateMcpStatus,
    addPendingFrontendTool,
    setA2AStreamStart,
    setA2AStreamEnd,
    addA2AStreamEvent,
    scheduleUpdate,
    generateBlockId,
  ]);

  const handleStreamError = useCallback((error: unknown) => {
    console.error('SSE error:', error);
    setAiTyping(false);
    setIsInitializingSession(false);
    abortControllerRef.current = null;

    // Check if error is due to user cancellation
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('Request was aborted by user');
      return;
    }

    // Determine specific error message
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
      } else if (error.message.includes('forbidden') || error.message.includes('403')) {
        errorMessage = t('agentChatPanel.errors.forbidden');
      } else if (error.message.includes('500') || error.message.includes('internal server')) {
        errorMessage = t('agentChatPanel.errors.internalServerError');
      } else {
        errorMessage = `❌ **${t('agentChatPanel.errors.processingError')}**\n\n${error.message || t('agentChatPanel.errors.unknownErrorRetry')}`;
      }
    }

    // Add error message if no AI message was created yet
    if (!aiMessageIdRef.current) {
      addMessage({
        content: errorMessage,
        role: 'assistant'
      });
    } else {
      // Update existing message with error
      addTextPartToMessage(aiMessageIdRef.current, '\n\n' + errorMessage);
    }
  }, [abortControllerRef, setAiTyping, setIsInitializingSession, t, addMessage, addTextPartToMessage]);

  // Reset AI message ID when starting new message
  const resetMessageId = useCallback(() => {
    aiMessageIdRef.current = null;
    // Also reset the streaming flags for the next message
    streamingStateRef.current.wasStreamProcessed = false;
    streamingStateRef.current.isStreaming = false;
    streamingStateRef.current.currentMessageId = null;
  }, []);

  return {
    handleStreamMessage,
    handleStreamError,
    resetMessageId,
  };
};
