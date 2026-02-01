/**
 * useAGUIStreamHandler Hook
 * 
 * Simplified stream handler for AGUI events.
 * Converts standardized AGUI events into UI updates via useAgentStore.
 * 
 * Unlike the original useAIStreamHandler which had to handle both Claude SDK
 * native events and convert them, this handler receives already-standardized
 * AGUI events from the backend.
 */

import { useCallback, useRef } from 'react';
import { useAgentStore } from '../../stores/useAgentStore';
import type { AGUIEvent, AGUIEventType } from '../../types/aguiTypes';

export interface UseAGUIStreamHandlerProps {
  agentId: string;
  currentSessionId: string | null;
  projectPath?: string;
  onSessionChange?: (sessionId: string | null) => void;
  setIsInitializingSession: (init: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setIsNewSession: (isNew: boolean) => void;
  setAiTyping: (typing: boolean) => void;
  setHasSuccessfulResponse: (success: boolean) => void;
}

export const useAGUIStreamHandler = (props: UseAGUIStreamHandlerProps) => {
  const {
    agentId,
    currentSessionId,
    projectPath,
    onSessionChange,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
  } = props;

  const {
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    addToolCallToMessage,
    updateToolCallInMessage,
    updateToolResultInMessage,
    addThinkingToMessage,
    updateThinkingInMessage,
    finalizeThinkingInMessage,
  } = useAgentStore();

  // Track current message state
  const currentMessageIdRef = useRef<string | null>(null);
  const currentTextContentRef = useRef<string>('');
  const currentThinkingContentRef = useRef<string>('');
  const currentToolCallsRef = useRef<Map<string, { name: string; args: string }>>(new Map());

  /**
   * Reset handler state
   */
  const reset = useCallback(() => {
    currentMessageIdRef.current = null;
    currentTextContentRef.current = '';
    currentThinkingContentRef.current = '';
    currentToolCallsRef.current.clear();
  }, []);

  /**
   * Handle AGUI event
   */
  const handleAguiEvent = useCallback((event: AGUIEvent) => {
    console.log(`📨 [AGUI Handler] Event: ${event.type}`, event);

    switch (event.type) {
      case 'RUN_STARTED':
        // Initialize new run
        reset();
        setIsInitializingSession(false);
        setAiTyping(true);

        // Update session ID if provided
        if (event.threadId && event.threadId !== currentSessionId) {
          setCurrentSessionId(event.threadId);
          setIsNewSession(true);
          onSessionChange?.(event.threadId);
        }
        break;

      case 'RUN_FINISHED':
        // Finalize the run
        if (currentMessageIdRef.current) {
          finalizeStreamingMessage(currentMessageIdRef.current);
        }
        setAiTyping(false);
        setHasSuccessfulResponse(true);
        break;

      case 'RUN_ERROR':
        // Handle error
        console.error('[AGUI Handler] Run error:', event.error);
        
        // Add error message if no current message
        if (!currentMessageIdRef.current) {
          addMessage({
            role: 'assistant',
            content: `❌ **Error**: ${event.error}`,
          });
        }
        
        setAiTyping(false);
        break;

      case 'TEXT_MESSAGE_START':
        // Start new text message
        const msgId = event.messageId;
        currentMessageIdRef.current = msgId;
        currentTextContentRef.current = '';

        // Add empty assistant message
        addMessage({
          role: 'assistant',
          content: '',
          id: msgId,
        });
        break;

      case 'TEXT_MESSAGE_CONTENT':
        // Append text content
        if (currentMessageIdRef.current) {
          currentTextContentRef.current += event.content;
          updateStreamingMessage(currentMessageIdRef.current, currentTextContentRef.current);
        }
        break;

      case 'TEXT_MESSAGE_END':
        // Finalize text message
        if (currentMessageIdRef.current) {
          finalizeStreamingMessage(currentMessageIdRef.current);
        }
        break;

      case 'THINKING_START':
        // Start thinking block
        if (currentMessageIdRef.current) {
          currentThinkingContentRef.current = '';
          addThinkingToMessage(currentMessageIdRef.current, '');
        }
        break;

      case 'THINKING_CONTENT':
        // Append thinking content
        if (currentMessageIdRef.current) {
          currentThinkingContentRef.current += event.content;
          updateThinkingInMessage(currentMessageIdRef.current, currentThinkingContentRef.current);
        }
        break;

      case 'THINKING_END':
        // Finalize thinking block
        if (currentMessageIdRef.current) {
          finalizeThinkingInMessage(currentMessageIdRef.current);
        }
        break;

      case 'TOOL_CALL_START':
        // Start tool call
        currentToolCallsRef.current.set(event.toolCallId, {
          name: event.toolName,
          args: '',
        });

        if (currentMessageIdRef.current) {
          addToolCallToMessage(currentMessageIdRef.current, {
            id: event.toolCallId,
            name: event.toolName,
            input: {},
            status: 'running',
          });
        }
        break;

      case 'TOOL_CALL_ARGS':
        // Accumulate tool call arguments
        const toolCall = currentToolCallsRef.current.get(event.toolCallId);
        if (toolCall) {
          toolCall.args += event.args;
          
          // Try to parse accumulated args
          try {
            const input = JSON.parse(toolCall.args);
            if (currentMessageIdRef.current) {
              updateToolCallInMessage(currentMessageIdRef.current, event.toolCallId, { input });
            }
          } catch {
            // Args not complete yet, ignore parse error
          }
        }
        break;

      case 'TOOL_CALL_END':
        // Finalize tool call
        const completedTool = currentToolCallsRef.current.get(event.toolCallId);
        if (completedTool && currentMessageIdRef.current) {
          try {
            const input = JSON.parse(completedTool.args);
            updateToolCallInMessage(currentMessageIdRef.current, event.toolCallId, {
              input,
              status: 'pending',
            });
          } catch {
            // Use empty input if parse fails
            updateToolCallInMessage(currentMessageIdRef.current, event.toolCallId, {
              status: 'pending',
            });
          }
        }
        break;

      case 'TOOL_CALL_RESULT':
        // Update tool result
        if (currentMessageIdRef.current) {
          updateToolResultInMessage(currentMessageIdRef.current, event.toolCallId, {
            result: event.result,
            isError: event.isError || false,
            status: event.isError ? 'error' : 'completed',
          });
        }
        break;

      case 'RAW':
      case 'CUSTOM':
        // Log but don't process raw/custom events
        console.log('[AGUI Handler] Raw/Custom event:', event);
        break;

      default:
        console.warn('[AGUI Handler] Unknown event type:', (event as any).type);
    }
  }, [
    currentSessionId,
    reset,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
    onSessionChange,
    addMessage,
    updateStreamingMessage,
    finalizeStreamingMessage,
    addToolCallToMessage,
    updateToolCallInMessage,
    updateToolResultInMessage,
    addThinkingToMessage,
    updateThinkingInMessage,
    finalizeThinkingInMessage,
  ]);

  /**
   * Handle stream error
   */
  const handleStreamError = useCallback((error: Error) => {
    console.error('[AGUI Handler] Stream error:', error);
    
    // Add error message
    addMessage({
      role: 'assistant',
      content: `❌ **Error**: ${error.message}`,
    });
    
    setAiTyping(false);
  }, [addMessage, setAiTyping]);

  return {
    handleAguiEvent,
    handleStreamError,
    reset,
  };
};

export default useAGUIStreamHandler;
