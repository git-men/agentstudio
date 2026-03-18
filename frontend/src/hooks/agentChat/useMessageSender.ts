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
import { getAllSchemas, isFrontendToolName, extractFrontendToolShortName } from '../../services/frontendToolRegistry.js';
import type { StoreApi } from 'zustand';
import type { SessionState, SessionActions } from '../../stores/createSessionStore';
import { SessionStreamManager } from '../../services/SessionStreamManager';
import { sessionStoreManager } from '../../services/SessionStoreManager';

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
  environmentContext?: string;
  /**
   * Optional: session store for workspace mode.
   * When provided, message operations use this store instead of the
   * global useAgentStore facade.
   */
  sessionStore?: StoreApi<SessionState & SessionActions>;
  /**
   * Optional: external SessionStreamManager for workspace mode.
   * Passed through to useAIStreamHandler.
   */
  externalStreamManager?: SessionStreamManager;
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
    envVars,
    environmentContext,
    sessionStore,
    externalStreamManager,
  } = props;

  const { t } = useTranslation('components');

  // Use session store actions if provided, otherwise fall back to useAgentStore
  const facadeActions = useAgentStore();
  const storeActions = sessionStore
    ? sessionStore.getState()
    : facadeActions;

  // Convenience: read from session store or facade for store actions
  function getActions() {
    return sessionStore ? sessionStore.getState() : useAgentStore.getState();
  }

  const { selectedEngine } = useAgentStore();
  const agentChatMutation = useAgentChat();
  const aguiChat = useAGUIChat();

  const isCompactCommandRef = useRef(false);
  const lastSentContextRef = useRef<string | undefined>(undefined);

  // Initialize AI stream handler (pass external manager for workspace mode)
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
    externalStreamManager,
  };

  const { handleStreamMessage, handleStreamError, resetMessageId } = useAIStreamHandler(streamHandlerProps);

  const isSendDisabled = useCallback(() => {
    if (isAiTyping) return true;
    if (!inputMessage.trim() && selectedImages.length === 0) return true;

    if (isCommandTrigger(inputMessage)) {
      const commandName = inputMessage.slice(1).split(' ')[0].toLowerCase();
      return !isCommandDefined(commandName);
    }

    return false;
  }, [inputMessage, isAiTyping, selectedImages, isCommandDefined]);

  const handleSendMessage = useCallback(async () => {
    if ((!inputMessage.trim() && selectedImages.length === 0) || isAiTyping) return;

    let userMessage = inputMessage.trim();
    const images = [...selectedImages];

    const imageData = images.map(img => ({
      id: img.id,
      data: img.preview.split(',')[1],
      mediaType: img.file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      name: img.file.name
    }));

    // Command handling
    if (isCommandTrigger(inputMessage)) {
      const commandName = inputMessage.slice(1).split(' ')[0].toLowerCase();

      if (!isCommandDefined(commandName)) {
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

      setCommandWarning(null);

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

      let command = selectedCommand;
      if (!command) {
        command = SYSTEM_COMMANDS.find(cmd => cmd.name === commandName) ||
          projectCommands.find(cmd => cmd.name === commandName) ||
          userCommands.find(cmd => cmd.name === commandName) ||
          null;
      }

      if (command) {
        const result = await commandHandler.executeCommand(command);

        if (result.shouldSendToBackend) {
          userMessage = inputMessage.trim();

          const message = {
            content: '',
            role: 'user' as const,
            images: imageData
          };
          getActions().addMessage(message);
          const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
          const messageId = state.messages[state.messages.length - 1].id;
          getActions().addCommandPartToMessage(messageId, userMessage);
        } else {
          const commandArgs = inputMessage.slice(command.content.length).trim() || undefined;
          const formattedCommand = formatCommandMessage(command, commandArgs, projectPath);

          getActions().addMessage({
            content: formattedCommand,
            role: 'user',
            images: imageData
          });

          setInputMessage('');
          clearImages();
          setSelectedCommand(null);
          setShowCommandSelector(false);

          if (result.message && result.action !== 'confirm') {
            getActions().addMessage({
              content: result.message,
              role: 'assistant'
            });
          }
          return;
        }
      }
    } else {
      setCommandWarning(null);
    }

    setInputMessage('');
    clearImages();
    setSelectedCommand(null);
    setShowCommandSelector(false);

    if (!isCommandTrigger(inputMessage.trim())) {
      getActions().addMessage({
        content: userMessage || t('agentChat.sendImage'),
        role: 'user',
        images: imageData
      });
    }

    const contextChanged = environmentContext !== lastSentContextRef.current;
    const effectiveEnvironmentContext = contextChanged ? environmentContext : undefined;
    if (contextChanged) {
      lastSentContextRef.current = environmentContext;
    }

    const context = {
      ...(effectiveEnvironmentContext ? { environmentContext: effectiveEnvironmentContext } : {}),
    };

    setAiTyping(true);

    if (!currentSessionId) {
      setIsInitializingSession(true);
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    isCompactCommandRef.current = userMessage.trim() === '/compact';

    resetMessageId();

    // Attach abort controller to the stream manager if in workspace mode
    if (externalStreamManager) {
      externalStreamManager.setAbortController(abortController);
    }

    try {
      const allSelectedTools = [
        ...selectedRegularTools,
        ...(mcpToolsEnabled && selectedMcpTools.length > 0 ? selectedMcpTools : [])
      ];

      const frontendToolSchemas = getAllSchemas();
      const frontendToolsPayload = frontendToolSchemas.length > 0 ? frontendToolSchemas : undefined;

      if (selectedEngine === 'cursor' || selectedEngine === 'codebuddy') {
        console.log(`🚀 [MessageSender] Using ${selectedEngine === 'codebuddy' ? 'CodeBuddy' : 'Cursor'} Engine`);

        let currentAguiMessageId: string | null = null;
        let currentTextContent = '';
        const currentToolCalls = new Map<string, { name: string; args: string; isFrontendTool?: boolean }>();

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
              if (abortControllerRef.current?.signal.aborted) {
                console.log('[AGUI] Ignoring RUN_ERROR after user abort');
              } else {
                console.error('[AGUI] Run error:', event.error);
                getActions().addMessage({
                  role: 'assistant',
                  content: `❌ **Error**: ${event.error}`,
                });
              }
              setAiTyping(false);
              break;

            case 'TEXT_MESSAGE_START':
              currentAguiMessageId = event.messageId;
              currentTextContent = '';
              getActions().addMessage({
                role: 'assistant',
                content: '',
              });
              break;

            case 'TEXT_MESSAGE_CONTENT':
              if (currentAguiMessageId) {
                currentTextContent += event.content;
                const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
                const lastMsg = state.messages[state.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  getActions().updateMessage(lastMsg.id, { content: currentTextContent });
                }
              }
              break;

            case 'TEXT_MESSAGE_END':
              break;

            case 'THINKING_START': {
              let state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
              let lastMsg = state.messages[state.messages.length - 1];

              if (!lastMsg || lastMsg.role !== 'assistant') {
                getActions().addMessage({ role: 'assistant', content: '' });
                state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
                lastMsg = state.messages[state.messages.length - 1];
              }

              if (lastMsg && lastMsg.role === 'assistant') {
                getActions().addThinkingPartToMessage(lastMsg.id, '');
              }
              break;
            }

            case 'THINKING_CONTENT': {
              const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
              const lastMsg = state.messages[state.messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.messageParts) {
                const thinkingParts = lastMsg.messageParts.filter((p: any) => p.type === 'thinking');
                if (thinkingParts.length > 0) {
                  const lastThinkingPart = thinkingParts[thinkingParts.length - 1];
                  getActions().updateThinkingPartInMessage(
                    lastMsg.id,
                    lastThinkingPart.id,
                    (lastThinkingPart.content || '') + (event as any).content
                  );
                }
              }
              break;
            }

            case 'THINKING_END':
              break;

            case 'TOOL_CALL_START': {
              const isFrontend = isFrontendToolName(event.toolName);
              currentToolCalls.set(event.toolCallId, {
                name: event.toolName,
                args: '',
                isFrontendTool: isFrontend,
              });
              let state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
              let lastMsg = state.messages[state.messages.length - 1];

              if (!lastMsg || lastMsg.role !== 'assistant') {
                getActions().addMessage({ role: 'assistant', content: '' });
                state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
                lastMsg = state.messages[state.messages.length - 1];
              }

              if (lastMsg && lastMsg.role === 'assistant') {
                getActions().addToolPartToMessage(lastMsg.id, {
                  toolName: event.toolName,
                  toolInput: {},
                  isExecuting: true,
                  claudeId: event.toolCallId,
                });
              }
              break;
            }

            case 'TOOL_CALL_ARGS': {
              const toolCall = currentToolCalls.get(event.toolCallId);
              if (toolCall) {
                toolCall.args += (event.args ?? '');
                try {
                  const toolInput = JSON.parse(toolCall.args);
                  const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
                  const lastMsg = state.messages[state.messages.length - 1];
                  if (lastMsg && lastMsg.role === 'assistant') {
                    getActions().updateToolPartInMessage(lastMsg.id, event.toolCallId, { toolInput });
                  }
                } catch {
                  // Args not complete yet
                }
              }
              break;
            }

            case 'TOOL_CALL_END': {
              const completedTool = currentToolCalls.get(event.toolCallId);
              if (!completedTool) break;

              let parsedArgs: Record<string, unknown> = {};
              try { parsedArgs = JSON.parse(completedTool.args); } catch { /* use empty */ }

              const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
              const lastMsg = state.messages[state.messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                getActions().updateToolPartInMessage(lastMsg.id, event.toolCallId, {
                  toolInput: parsedArgs,
                  isExecuting: completedTool.isFrontendTool,
                });
              }

              if (completedTool.isFrontendTool) {
                const shortName = extractFrontendToolShortName(completedTool.name);
                getActions().addPendingFrontendTool({
                  toolCallId: event.toolCallId,
                  toolName: shortName,
                  args: parsedArgs,
                  sessionId: currentSessionId || '',
                  agentId: '',
                });
              }
              break;
            }

            case 'TOOL_CALL_RESULT': {
              const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
              const lastMsg = state.messages[state.messages.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                getActions().updateToolPartInMessage(lastMsg.id, event.toolCallId, {
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
            }

            case 'CUSTOM': {
              const customEvent = event as { name?: string; data?: any };
              if (customEvent.name === 'session_id_updated' && customEvent.data?.sessionId) {
                const cliSessionId = customEvent.data.sessionId;
                setCurrentSessionId(cliSessionId);
                onSessionChange?.(cliSessionId);
              }
              if (customEvent.name === 'auto_compact') {
                const preTokens = customEvent.data?.preTokens || 0;
                const state = sessionStore ? sessionStore.getState() : useAgentStore.getState();
                const lastMsg = state.messages[state.messages.length - 1];
                if (lastMsg && lastMsg.role === 'assistant') {
                  const tokenInfo = preTokens > 0
                    ? t('compactSummary.autoCompactWithTokens', { tokens: preTokens.toLocaleString() })
                    : t('compactSummary.autoCompact');
                  getActions().addCompactSummaryPartToMessage(lastMsg.id, tokenInfo);
                }
              }
              break;
            }
          }
        };

        const isTempAguiId = currentSessionId?.startsWith('session_') || currentSessionId?.startsWith('__pending_');
        const effectiveAguiSessionId = (sessionStore && isTempAguiId) ? undefined : (currentSessionId || undefined);

        await aguiChat.sendMessage({
          message: userMessage,
          engineType: selectedEngine as 'cursor' | 'codebuddy',
          workspace: projectPath || '.',
          sessionId: effectiveAguiSessionId,
          model: selectedModel,
          images: imageData.length > 0 ? imageData : undefined,
          envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
          environmentContext: effectiveEnvironmentContext,
          frontendTools: frontendToolsPayload,
          abortController,
          onAguiEvent: handleAguiEvent,
          onError: (error) => {
            if (abortController.signal.aborted) {
              console.log('[AGUI] Ignoring error after user abort:', error.message);
              return;
            }
            console.error('[AGUI] Error:', error);
            getActions().addMessage({
              role: 'assistant',
              content: `❌ **Error**: ${error.message}`,
            });
            setAiTyping(false);
          },
        });
      } else {
        console.log('🚀 [MessageSender] Using Claude Engine');

        const isTempId = currentSessionId?.startsWith('session_') || currentSessionId?.startsWith('__pending_');
        const effectiveSessionId = (sessionStore && isTempId) ? undefined : currentSessionId;

        console.log('[MessageSender] Session ID decision:', {
          currentSessionId,
          isTempId,
          effectiveSessionId,
          hasSessionStore: !!sessionStore,
          projectPath,
        });

        await agentChatMutation.mutateAsync({
          agentId: agent.id,
          message: userMessage,
          images: imageData.length > 0 ? imageData : undefined,
          context,
          sessionId: effectiveSessionId,
          projectPath,
          mcpTools: allSelectedTools.length > 0 ? allSelectedTools : undefined,
          permissionMode,
          model: selectedModel,
          claudeVersion: selectedClaudeVersion,
          envVars,
          channel: 'web',
          frontendTools: frontendToolsPayload,
          abortController,
          onMessage: handleStreamMessage,
          onError: handleStreamError
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      setAiTyping(false);
      setIsInitializingSession(false);

      if (!abortControllerRef.current) {
        console.log('Request was aborted by user (controller already cleared)');
        return;
      }

      abortControllerRef.current = null;

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

      getActions().addMessage({
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
    agentChatMutation,
    aguiChat,
    handleStreamMessage,
    handleStreamError,
    resetMessageId,
    setConfirmMessage,
    setConfirmAction,
    setShowConfirmDialog,
    sessionStore,
    externalStreamManager,
  ]);

  return {
    isSendDisabled,
    handleSendMessage,
    handleStreamMessage,
    handleStreamError,
    resetMessageId
  };
};
