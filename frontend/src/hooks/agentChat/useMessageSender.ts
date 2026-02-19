import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { showInfo } from '../../utils/toast';
import { isCommandTrigger, formatCommandMessage } from '../../utils/commandFormatter';
import { createCommandHandler, SystemCommand } from '../../utils/commandHandler';
import { useAgentStore } from '../../stores/useAgentStore';
import { useAgentChat } from '../useAgents';
import { useAGUIChat } from '../useAGUIChat';
import { useAIStreamHandler, type UseAIStreamHandlerProps } from './useAIStreamHandler';
import type { ImageData } from './useImageUpload';
import type { AgentConfig } from '../../types/index.js';
import type { CommandType } from '../../utils/commandFormatter';
import type { AGUIEvent } from '../../types/aguiTypes';

export interface UseMessageSenderProps {
  agent: AgentConfig;
  projectPath?: string;
  inputMessage: string;
  selectedImages: ImageData[];
  isAiTyping: boolean;
  currentSessionId: string | null;
  hasCommandsLoadError: boolean;
  userCommandsError?: Error;
  projectCommandsError?: Error;
  SYSTEM_COMMANDS: SystemCommand[];
  userCommands: CommandType[];
  projectCommands: CommandType[];
  selectedCommand: CommandType | null;
  selectedRegularTools: string[];
  selectedMcpTools: string[];
  mcpToolsEnabled: boolean;
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  selectedModel: string;
  selectedClaudeVersion?: string;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  onSessionChange?: (sessionId: string | null) => void;
  setInputMessage: (message: string) => void;
  clearImages: () => void;
  setSelectedCommand: (command: CommandType | null) => void;
  setShowCommandSelector: (show: boolean) => void;
  setCommandWarning: (warning: string | null) => void;
  setIsInitializingSession: (init: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setIsNewSession: (isNew: boolean) => void;
  setAiTyping: (typing: boolean) => void;
  setHasSuccessfulResponse: (success: boolean) => void;
  setConfirmMessage: (message: string) => void;
  setConfirmAction: (action: (() => void) | null) => void;
  setShowConfirmDialog: (show: boolean) => void;
  handleNewSession: () => void;
  isCommandDefined: (commandName: string) => boolean;
  getAllAvailableCommands: () => string;
  envVars: Record<string, string>;
}

export const useMessageSender = (props: UseMessageSenderProps) => {
  const {
    agent,
    projectPath,
    inputMessage,
    selectedImages,
    isAiTyping,
    currentSessionId,
    hasCommandsLoadError,
    userCommandsError,
    projectCommandsError,
    SYSTEM_COMMANDS,
    userCommands,
    projectCommands,
    selectedCommand,
    selectedRegularTools,
    selectedMcpTools,
    mcpToolsEnabled,
    permissionMode,
    selectedModel,
    selectedClaudeVersion,
    abortControllerRef,
    onSessionChange,
    setInputMessage,
    clearImages,
    setSelectedCommand,
    setShowCommandSelector,
    setCommandWarning,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
    setConfirmMessage,
    setConfirmAction,
    setShowConfirmDialog,
    handleNewSession,
    isCommandDefined,
    getAllAvailableCommands,
    envVars
  } = props;

  const { t } = useTranslation('components');
  const { addMessage, addCommandPartToMessage, addTextPartToMessage, addCompactSummaryPartToMessage, selectedEngine, updateMessage, addToolPartToMessage, updateToolPartInMessage, addThinkingPartToMessage, updateThinkingPartInMessage } = useAgentStore();
  const agentChatMutation = useAgentChat();
  const aguiChat = useAGUIChat();

  // Track if this is a compact command for special handling in SSE stream
  const isCompactCommandRef = useRef(false);

  // Initialize AI stream handler
  const streamHandlerProps: UseAIStreamHandlerProps = {
    agentId: agent.id,
    currentSessionId,
    projectPath,
    isCompactCommand: isCompactCommandRef.current,
    abortControllerRef,
    onSessionChange,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
  };

  const { handleStreamMessage, handleStreamError, resetMessageId } = useAIStreamHandler(streamHandlerProps);

  // Check if send should be disabled
  const isSendDisabled = useCallback(() => {
    if (isAiTyping) return true;
    if (!inputMessage.trim() && selectedImages.length === 0) return true;

    // Check for undefined command
    if (isCommandTrigger(inputMessage)) {
      const commandName = inputMessage.slice(1).split(' ')[0].toLowerCase();
      return !isCommandDefined(commandName);
    }

    return false;
  }, [inputMessage, isAiTyping, selectedImages, isCommandDefined]);

  // Main send message handler
  const handleSendMessage = useCallback(async () => {
    if ((!inputMessage.trim() && selectedImages.length === 0) || isAiTyping) return;

    let userMessage = inputMessage.trim();
    const images = [...selectedImages];

    // Convert images to backend format
    const imageData = images.map(img => ({
      id: img.id,
      data: img.preview.split(',')[1], // Remove data:image/type;base64, prefix
      mediaType: img.file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      name: img.file.name
    }));

    // Check if this is a command and handle routing
    if (isCommandTrigger(inputMessage)) {
      const commandName = inputMessage.slice(1).split(' ')[0].toLowerCase();

      // Check if command is defined
      if (!isCommandDefined(commandName)) {
        // If commands failed to load, provide a more helpful error message
        if (hasCommandsLoadError) {
          setCommandWarning(t('agentChat.commandsLoadErrorWarning', {
            command: commandName,
            commands: SYSTEM_COMMANDS.map(cmd => cmd.content).join(', '),
            errorMessage: userCommandsError?.message || projectCommandsError?.message || 'Unknown error'
          }));
        } else {
          setCommandWarning(t('agentChat.unknownCommandWarning', {
            command: commandName,
            commands: getAllAvailableCommands()
          }));
        }
        return;
      }

      // Clear warning if command is valid
      setCommandWarning(null);

      // 创建命令处理器
      const commandHandler = createCommandHandler({
        agentStore: useAgentStore.getState(),
        onNewSession: handleNewSession,
        onNavigate: (path: string) => {
          showInfo(t('agentChat.navigateToAlert', { path }));
        },
        onConfirm: (message: string, onConfirm: () => void) => {
          setConfirmMessage(message);
          setConfirmAction(() => onConfirm);
          setShowConfirmDialog(true);
        }
      });

      // 创建命令对象（系统命令或从 selectedCommand）
      let command = selectedCommand;
      if (!command) {
        // 用户手动输入的命令，查找对应的命令对象
        command = SYSTEM_COMMANDS.find(cmd => cmd.name === commandName) ||
          projectCommands.find(cmd => cmd.name === commandName) ||
          userCommands.find(cmd => cmd.name === commandName) ||
          null;
      }

      if (command) {
        // 执行命令路由
        const result = await commandHandler.executeCommand(command);

        if (result.shouldSendToBackend) {
          // 后端命令：直接使用原始用户输入，不做任何格式化
          userMessage = inputMessage.trim();

          // 添加用户消息，使用 messageParts 显示命令组件
          const message = {
            content: '',
            role: 'user' as const,
            images: imageData
          };
          addMessage(message);
          // 获取刚添加的消息ID
          const state = useAgentStore.getState();
          const messageId = state.messages[state.messages.length - 1].id;
          // 添加命令部分
          addCommandPartToMessage(messageId, userMessage);
        } else {
          // 前端处理完成，添加格式化的用户命令消息
          const commandArgs = inputMessage.slice(command.content.length).trim() || undefined;
          const formattedCommand = formatCommandMessage(command, commandArgs, projectPath);

          addMessage({
            content: formattedCommand,
            role: 'user',
            images: imageData
          });

          setInputMessage('');
          clearImages();
          setSelectedCommand(null);
          setShowCommandSelector(false);

          if (result.message && result.action !== 'confirm') {
            addMessage({
              content: result.message,
              role: 'assistant'
            });
          }
          return; // 不发送到后端
        }
      }
    } else {
      // Clear warning for non-command messages
      setCommandWarning(null);
    }

    setInputMessage('');
    clearImages();
    setSelectedCommand(null);
    setShowCommandSelector(false);

    // Add user message with images (only for non-command messages)
    // Commands are already added above
    if (!isCommandTrigger(inputMessage.trim())) {
      addMessage({
        content: userMessage || t('agentChat.sendImage'),
        role: 'user',
        images: imageData
      });
    }

    // Build context - now simplified since each agent manages its own state
    const context = {};

    setAiTyping(true);

    // 检查是否需要创建新会话
    if (!currentSessionId) {
      console.log('🆕 No current session, will create new session');
      setIsInitializingSession(true);
    }

    // Create abort controller for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Track if this is a compact command for special handling in SSE stream
    isCompactCommandRef.current = userMessage.trim() === '/compact';

    // Reset AI message ID for new message
    resetMessageId();

    try {
      // 合并常规工具和MCP工具
      const allSelectedTools = [
        ...selectedRegularTools,
        ...(mcpToolsEnabled && selectedMcpTools.length > 0 ? selectedMcpTools : [])
      ];

      if (selectedEngine === 'cursor' || selectedEngine === 'codebuddy' || selectedEngine === 'codex') {
        // Cursor/CodeBuddy/Codex Engine: Use AGUI API with simplified stream handling
        console.log(`🚀 [MessageSender] Using ${selectedEngine} engine`);
        
        // Track current message for AGUI events
        let currentAguiMessageId: string | null = null;
        let currentTextContent = '';
        const currentToolCalls = new Map<string, { name: string; args: string }>();
        
        // Handle AGUI events
        const handleAguiEvent = (event: AGUIEvent) => {
          console.log(`📨 [AGUI] Event: ${event.type}`, event);
          
          switch (event.type) {
            case 'RUN_STARTED':
              setIsInitializingSession(false);
              if (event.threadId && event.threadId !== currentSessionId) {
                setCurrentSessionId(event.threadId);
                setIsNewSession(true);
                onSessionChange?.(event.threadId);
              }
              break;
              
            case 'RUN_FINISHED':
              setAiTyping(false);
              setHasSuccessfulResponse(true);
              break;
              
            case 'RUN_ERROR':
              // Skip error display if the request was intentionally aborted by the user
              if (abortControllerRef.current?.signal.aborted) {
                console.log('[AGUI] Ignoring RUN_ERROR after user abort');
              } else {
                console.error('[AGUI] Run error:', event.error);
                addMessage({
                  role: 'assistant',
                  content: `❌ **Error**: ${event.error}`,
                });
              }
              setAiTyping(false);
              break;
              
            case 'TEXT_MESSAGE_START':
              currentAguiMessageId = event.messageId;
              currentTextContent = '';
              addMessage({
                role: 'assistant',
                content: '',
              });
              break;
              
            case 'TEXT_MESSAGE_CONTENT':
              if (currentAguiMessageId) {
                currentTextContent += event.content;
                // Find and update the last assistant message
                const state = useAgentStore.getState();
                const lastMsg = state.messages[state.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  updateMessage(lastMsg.id, { content: currentTextContent });
                }
              }
              break;
              
            case 'TEXT_MESSAGE_END':
              // Message finalized
              break;
              
            case 'THINKING_START': {
              // Ensure we have an assistant message to add thinking to
              let stateForThinking = useAgentStore.getState();
              let lastMsgForThinking = stateForThinking.messages[stateForThinking.messages.length - 1];
              
              if (!lastMsgForThinking || lastMsgForThinking.role !== 'assistant') {
                addMessage({ role: 'assistant', content: '' });
                stateForThinking = useAgentStore.getState();
                lastMsgForThinking = stateForThinking.messages[stateForThinking.messages.length - 1];
              }
              
              if (lastMsgForThinking && lastMsgForThinking.role === 'assistant') {
                addThinkingPartToMessage(lastMsgForThinking.id, '');
              }
              break;
            }
              
            case 'THINKING_CONTENT': {
              const stateForThinkContent = useAgentStore.getState();
              const lastMsgForThinkContent = stateForThinkContent.messages[stateForThinkContent.messages.length - 1];
              if (lastMsgForThinkContent && lastMsgForThinkContent.role === 'assistant' && lastMsgForThinkContent.messageParts) {
                // Find the last thinking part and append content
                const thinkingParts = lastMsgForThinkContent.messageParts.filter((p: any) => p.type === 'thinking');
                if (thinkingParts.length > 0) {
                  const lastThinkingPart = thinkingParts[thinkingParts.length - 1];
                  updateThinkingPartInMessage(
                    lastMsgForThinkContent.id,
                    lastThinkingPart.id,
                    (lastThinkingPart.content || '') + (event as any).content
                  );
                }
              }
              break;
            }
              
            case 'THINKING_END':
              // Thinking block finalized
              break;
              
            case 'TOOL_CALL_START':
              currentToolCalls.set(event.toolCallId, {
                name: event.toolName,
                args: '',
              });
              // Ensure we have an assistant message to add tool to
              let stateForTool = useAgentStore.getState();
              let lastMsgForTool = stateForTool.messages[stateForTool.messages.length - 1];
              
              // If no assistant message exists, create one first
              if (!lastMsgForTool || lastMsgForTool.role !== 'assistant') {
                addMessage({
                  role: 'assistant',
                  content: '',
                });
                // Refresh state after adding message
                stateForTool = useAgentStore.getState();
                lastMsgForTool = stateForTool.messages[stateForTool.messages.length - 1];
              }
              
              // Add tool part to current message
              if (lastMsgForTool && lastMsgForTool.role === 'assistant') {
                addToolPartToMessage(lastMsgForTool.id, {
                  toolName: event.toolName,
                  toolInput: {},
                  isExecuting: true,
                  claudeId: event.toolCallId, // Store toolCallId for later lookup
                });
              }
              break;
              
            case 'TOOL_CALL_ARGS':
              const toolCall = currentToolCalls.get(event.toolCallId);
              if (toolCall) {
                toolCall.args += event.args;
                // Try to parse and update
                try {
                  const toolInput = JSON.parse(toolCall.args);
                  const stateForArgs = useAgentStore.getState();
                  const lastMsgForArgs = stateForArgs.messages[stateForArgs.messages.length - 1];
                  if (lastMsgForArgs && lastMsgForArgs.role === 'assistant') {
                    updateToolPartInMessage(lastMsgForArgs.id, event.toolCallId, { toolInput });
                  }
                } catch {
                  // Args not complete yet
                }
              }
              break;
              
            case 'TOOL_CALL_END':
              const completedTool = currentToolCalls.get(event.toolCallId);
              if (completedTool) {
                try {
                  const toolInput = JSON.parse(completedTool.args);
                  const stateForEnd = useAgentStore.getState();
                  const lastMsgForEnd = stateForEnd.messages[stateForEnd.messages.length - 1];
                  if (lastMsgForEnd && lastMsgForEnd.role === 'assistant') {
                    updateToolPartInMessage(lastMsgForEnd.id, event.toolCallId, { toolInput, isExecuting: false });
                  }
                } catch {
                  // Use empty input
                  const stateForEnd = useAgentStore.getState();
                  const lastMsgForEnd = stateForEnd.messages[stateForEnd.messages.length - 1];
                  if (lastMsgForEnd && lastMsgForEnd.role === 'assistant') {
                    updateToolPartInMessage(lastMsgForEnd.id, event.toolCallId, { isExecuting: false });
                  }
                }
              }
              break;
              
            case 'TOOL_CALL_RESULT':
              const stateForResult = useAgentStore.getState();
              const lastMsgForResult = stateForResult.messages[stateForResult.messages.length - 1];
              if (lastMsgForResult && lastMsgForResult.role === 'assistant') {
                updateToolPartInMessage(lastMsgForResult.id, event.toolCallId, {
                  toolResult: event.result == null
                    ? undefined
                    : typeof event.result === 'string'
                      ? event.result
                      : JSON.stringify(event.result),
                  isError: event.isError || false,
                  isExecuting: false,
                });
              }
              break;
            
            case 'CUSTOM': {
              const customEvent = event as { name?: string; data?: any };
              // Handle session ID sync from Cursor CLI
              if (customEvent.name === 'session_id_updated' && customEvent.data?.sessionId) {
                const cliSessionId = customEvent.data.sessionId;
                console.log(`🔄 [AGUI] Session ID updated from CLI: ${cliSessionId}`);
                setCurrentSessionId(cliSessionId);
                onSessionChange?.(cliSessionId);
              }
              // Handle auto-compact event (context window auto-compaction)
              if (customEvent.name === 'auto_compact') {
                const preTokens = customEvent.data?.preTokens || 0;
                console.log('🔄 [AGUI] Auto-compact event received:', { preTokens });
                const stateForCompact = useAgentStore.getState();
                const lastMsg = stateForCompact.messages[stateForCompact.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  const tokenInfo = preTokens > 0
                    ? t('compactSummary.autoCompactWithTokens', { tokens: preTokens.toLocaleString() })
                    : t('compactSummary.autoCompact');
                  addCompactSummaryPartToMessage(lastMsg.id, tokenInfo);
                }
              }
              break;
            }
          }
        };
        
        await aguiChat.sendMessage({
          message: userMessage,
          engineType: selectedEngine as 'cursor' | 'codebuddy' | 'codex',
          workspace: projectPath || '.',
          sessionId: currentSessionId || undefined, // Convert null to undefined
          model: selectedModel,
          images: imageData.length > 0 ? imageData : undefined, // Pass images
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined, // Pass env vars
          abortController,
          onAguiEvent: handleAguiEvent,
          onError: (error) => {
            // If the abort controller was already aborted (user clicked stop),
            // this is not a real error - just a consequence of aborting the stream
            if (abortController.signal.aborted) {
              console.log('[AGUI] Ignoring error after user abort:', error.message);
              return;
            }
            console.error('[AGUI] Error:', error);
            addMessage({
              role: 'assistant',
              content: `❌ **Error**: ${error.message}`,
            });
            setAiTyping(false);
          },
        });
      } else {
        // Claude Engine: Use original agent chat API
        console.log('🚀 [MessageSender] Using Claude Engine');
        
        await agentChatMutation.mutateAsync({
          agentId: agent.id,
          message: userMessage,
          images: imageData.length > 0 ? imageData : undefined,
          context,
          sessionId: currentSessionId,
          projectPath,
          mcpTools: allSelectedTools.length > 0 ? allSelectedTools : undefined,
          permissionMode,
          model: selectedModel,
          claudeVersion: selectedClaudeVersion,
          envVars,
          channel: 'web',
          abortController,
          onMessage: handleStreamMessage,
          onError: handleStreamError
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      setAiTyping(false);
      setIsInitializingSession(false);

      // If abortControllerRef was already cleared by handleStopGeneration,
      // this error is from the user-initiated stop, not a real error
      if (!abortControllerRef.current) {
        console.log('Request was aborted by user (controller already cleared)');
        return;
      }

      abortControllerRef.current = null;

      // Check if error is due to user cancellation (abort)
      const isAbortError = (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && (
          error.message.includes('aborted') ||
          error.message.includes('BodyStreamBuffer was aborted') ||
          error.message.includes('signal is aborted') ||
          error.message.includes('network error')
        ))
      );
      if (isAbortError) {
        console.log('Request was aborted by user');
        return;
      }

      // Determine specific error message for catch block
      let errorMessage = t('agentChatPanel.errors.connectionFailed');

      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = t('agentChatPanel.errors.networkConnectionFailed');
        } else if (error.message.includes('timeout')) {
          errorMessage = t('agentChatPanel.errors.connectionTimeout');
        } else {
          errorMessage = `❌ **${t('agentChatPanel.errors.connectionError')}**\n\n${error.message || t('agentChatPanel.errors.cannotConnectRetry')}`;
        }
      }

      addMessage({
        content: errorMessage,
        role: 'assistant'
      });
    }
  }, [
    agent,
    projectPath,
    inputMessage,
    selectedImages,
    isAiTyping,
    currentSessionId,
    hasCommandsLoadError,
    userCommandsError,
    projectCommandsError,
    SYSTEM_COMMANDS,
    userCommands,
    projectCommands,
    selectedCommand,
    selectedRegularTools,
    selectedMcpTools,
    mcpToolsEnabled,
    permissionMode,
    selectedModel,
    selectedClaudeVersion,
    selectedEngine,
    abortControllerRef,
    onSessionChange,
    setInputMessage,
    clearImages,
    setSelectedCommand,
    setShowCommandSelector,
    setCommandWarning,
    setIsInitializingSession,
    setCurrentSessionId,
    setIsNewSession,
    setAiTyping,
    setHasSuccessfulResponse,
    handleNewSession,
    isCommandDefined,
    getAllAvailableCommands,
    t,
    addMessage,
    addCommandPartToMessage,
    addTextPartToMessage,
    addCompactSummaryPartToMessage,
    updateMessage,
    addToolPartToMessage,
    updateToolPartInMessage,
    addThinkingPartToMessage,
    updateThinkingPartInMessage,
    agentChatMutation,
    aguiChat,
    handleStreamMessage,
    handleStreamError,
    resetMessageId,
    setConfirmMessage,
    setConfirmAction,
    setShowConfirmDialog,
  ]);

  return {
    isSendDisabled,
    handleSendMessage,
    // Export stream handlers for AskUserQuestion tool_result handling
    handleStreamMessage,
    handleStreamError,
    resetMessageId
  };
};
