import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useAgentSessions, useAgentSessionMessages, useInterruptSession } from '../hooks/useAgents';
import { useSessionHeartbeatOnSuccess } from '../hooks/useSessionHeartbeatOnSuccess';
import { useSessions } from '../hooks/useSessions';
import { useResponsiveSettings } from '../hooks/useResponsiveSettings';
import { tabManager } from '../utils/tabManager';
import { SessionsDropdown } from './SessionsDropdown';
import type { AgentConfig } from '../types/index.js';
import { isCommandTrigger } from '../utils/commandFormatter';
import { useTranslation } from 'react-i18next';
import { loadBackendServices, getCurrentService } from '../utils/backendServiceStorage';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { useMobileContext } from '../contexts/MobileContext';
import { openUrlInContext } from '../utils/navigation';
import { eventBus, EVENTS } from '../utils/eventBus';
import {
  useImageUpload,
  useScrollManagement,
  useCommandCompletion,
  useToolSelector,
  useClaudeVersionManager,
  useMessageSender,
  useSessionManager,
  useUIState
} from '../hooks/agentChat';
import {
  ChatMessageList,
  AgentInputArea,
  createAgentCommandSelectorKeyHandler,
  EngineSelector
} from './agentChat';
import { useRatingTool } from '../hooks/useRatingTool';
import { useConsoleLogsTool } from '../hooks/useConsoleLogsTool';

interface AgentChatPanelProps {
  agent: AgentConfig;
  projectPath?: string;
  onSessionChange?: (sessionId: string | null) => void;
  initialMessage?: string;
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({ agent, projectPath, onSessionChange, initialMessage }) => {
  const { t } = useTranslation('components');
  const { isCompactMode } = useResponsiveSettings();

  // Register custom frontend tools
  useRatingTool();
  useConsoleLogsTool();
  const { isMobile } = useMobileContext();

  // Refs - 需要在hooks之前定义
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 基础状态
  const [inputMessage, setInputMessage] = useState('');
  const [hasProcessedInitialMessage, setHasProcessedInitialMessage] = useState(false);
  const [projectDefaultProvider, setProjectDefaultProvider] = useState<string | undefined>(undefined);
  const [projectDefaultModel, setProjectDefaultModel] = useState<string | undefined>(undefined);

  // Agent store状态 - 需要在其他hooks之前
  const {
    messages,
    isAiTyping,
    currentSessionId,
    mcpStatus,
    pendingFrontendTools,
    selectedEngine,
    addMessage,
    interruptAllExecutingTools,
    setAiTyping,
    loadSessionMessages,
    removePendingFrontendTool,
  } = useAgentStore();

  // 标记是否需要自动发送初始消息
  const shouldAutoSendRef = useRef(false);
  
  // 处理初始消息 - 从 Dashboard 跳转过来时自动填充并发送
  useEffect(() => {
    if (initialMessage && !hasProcessedInitialMessage) {
      setInputMessage(initialMessage);
      setHasProcessedInitialMessage(true);
      shouldAutoSendRef.current = true;
    }
  }, [initialMessage, hasProcessedInitialMessage]);

  // UI状态管理
  const uiState = useUIState();
  const {
    showSessions,
    showConfirmDialog,
    showMobileSettings,
    showMcpStatusModal,
    confirmMessage,
    searchTerm,
    isStopping,
    isInitializingSession,
    setShowSessions,
    setShowConfirmDialog,
    setShowMobileSettings,
    setShowMcpStatusModal,
    setConfirmMessage,
    setConfirmAction,
    setSearchTerm,
    setIsStopping,
    setIsInitializingSession,
    handleConfirmDialog,
    handleCancelDialog
  } = uiState;

  // 会话管理
  const sessionManager = useSessionManager({
    agentId: agent.id,
    currentSessionId,
    onSessionChange,
    textareaRef
  });
  const {
    isLoadingMessages,
    isNewSession,
    hasSuccessfulResponse,
    setIsLoadingMessages,
    setIsNewSession,
    setHasSuccessfulResponse,
    setCurrentSessionId,
    handleSwitchSession,
    handleNewSession,
    handleRefreshMessages
  } = sessionManager;

  // 使用重构的 hooks
  const {
    selectedImages,
    previewImage,
    isDragOver,
    handleImageSelect,
    handleImageRemove,
    handleImagePreview,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearImages,
    setPreviewImage
  } = useImageUpload({
    textareaRef,
    inputMessage,
    setInputMessage
  });

  const scrollManagement = useScrollManagement({
    messagesContainerRef,
    messagesEndRef,
    messages,
    isAiTyping
  });

  const commandCompletion = useCommandCompletion({
    projectPath,
    textareaRef
  });

  const toolSelector = useToolSelector({
    agent
  });

  const claudeVersionManager = useClaudeVersionManager({
    initialModel: projectDefaultModel || 'sonnet',
    initialVersion: projectDefaultProvider
  });

  // 从hooks中解构需要的状态和方法
  const {
    commandSearch,
    selectedCommand,
    selectedCommandIndex,
    commandWarning,
    showCommandSelector,
    showFileBrowser,
    atSymbolPosition,
    allCommands,
    SYSTEM_COMMANDS,
    userCommands,
    projectCommands,
    userCommandsError,
    projectCommandsError,
    setSelectedCommand,
    setSelectedCommandIndex,
    setCommandWarning,
    setShowCommandSelector,
    setShowFileBrowser,
    setAtSymbolPosition,
    setCommandSearch,
    // handleInputChange,
    handleCommandSelect,
    isCommandDefined,
    getAllAvailableCommands
  } = commandCompletion;

  const {
    selectedModel,
    selectedClaudeVersion,
    isVersionLocked,
    claudeVersionsData,
    availableModels,
    setSelectedModel,
    setSelectedClaudeVersion,
    setIsVersionLocked
  } = claudeVersionManager;

  // 获取项目默认供应商和模型设置，并应用到版本管理器
  useEffect(() => {
    if (projectPath) {
      const fetchProjectSettings = async () => {
        try {
          const response = await authFetch(`${API_BASE}/projects/${encodeURIComponent(projectPath)}`);
          if (response.ok) {
            const data = await response.json();
            console.log('🔧 Project settings loaded:', data.project);
            
            // 应用项目的默认供应商
            if (data.project.defaultProviderId) {
              console.log('🔧 Setting provider to:', data.project.defaultProviderId);
              setProjectDefaultProvider(data.project.defaultProviderId);
              setSelectedClaudeVersion(data.project.defaultProviderId);
            }
            
            // 应用项目的默认模型
            if (data.project.defaultModel) {
              console.log('🔧 Setting model to:', data.project.defaultModel);
              setProjectDefaultModel(data.project.defaultModel);
              setSelectedModel(data.project.defaultModel);
            }
          }
        } catch (error) {
          console.error('Failed to fetch project settings:', error);
        }
      };
      fetchProjectSettings();
    }
  }, [projectPath, setSelectedClaudeVersion, setSelectedModel]);

  const {
    showToolSelector,
    selectedRegularTools,
    selectedMcpTools,
    mcpToolsEnabled,
    permissionMode,
    showPermissionDropdown,
    showModelDropdown,
    showVersionDropdown,
    setShowToolSelector,
    setSelectedRegularTools,
    setSelectedMcpTools,
    setMcpToolsEnabled,
    setPermissionMode,
    setShowPermissionDropdown,
    setShowModelDropdown,
    setShowVersionDropdown,
    envVars,
    setEnvVars
  } = toolSelector;

  const {
    isUserScrolling,
    newMessagesCount,
    scrollToBottom,
    setNewMessagesCount,
    setIsUserScrolling
  } = scrollManagement;


  // Get current backend service name
  const [currentServiceName, setCurrentServiceName] = useState<string>('默认服务');
  useEffect(() => {
    const backendServices = loadBackendServices();
    const currentService = getCurrentService(backendServices);
    if (currentService) {
      setCurrentServiceName(currentService.name);
    }
  }, []);

  const interruptSessionMutation = useInterruptSession();
  const { data: sessionsData, refetch: refetchSessions } = useAgentSessions(agent.id, searchTerm, projectPath);
  const { data: sessionMessagesData } = useAgentSessionMessages(agent.id, currentSessionId, projectPath, isAiTyping);
  const { data: activeSessionsData } = useSessions();

  // 当打开会话历史下拉菜单时，自动刷新会话列表
  useEffect(() => {
    if (showSessions) {
      console.log('📋 [Sessions] Dropdown opened, refreshing sessions list...');
      refetchSessions();
    }
  }, [showSessions, refetchSessions]);

  // 会话心跳 - 基于 AI 响应成功状态
  useSessionHeartbeatOnSuccess({
    agentId: agent.id,
    sessionId: currentSessionId,
    projectPath,
    enabled: !!currentSessionId,
    isNewSession,
    hasSuccessfulResponse
  });

  // TabManager 智能监听和标签页管理
  useEffect(() => {
    // 启动智能监听
    const cleanup = tabManager.startSmartMonitoring();

    return cleanup;
  }, []); // 只在组件挂载时启动一次

  // 设置唤起监听器（当会话ID变化时）
  useEffect(() => {
    if (currentSessionId && agent.id) {
      console.log(`🎯 Setting up wakeup listener for session: ${currentSessionId}`);
      const cleanup = tabManager.setupWakeupListener(agent.id, currentSessionId);
      return cleanup;
    }
  }, [currentSessionId, agent.id]);




  // Check if commands failed to load (likely authentication issue)
  const hasCommandsLoadError = userCommandsError || projectCommandsError;

  // Reset selected index when commands change
  useEffect(() => {
    setSelectedCommandIndex(prev => {
      // Only update if index is out of bounds
      if (allCommands.length > 0 && prev >= allCommands.length) {
        return 0;
      }
      return prev;
    });
  }, [allCommands.length]);




  const handleSwitchSessionWithUI = (sessionId: string) => {
    handleSwitchSession(sessionId);
    setShowSessions(false);
  };

  const handleNewSessionWithUI = () => {
    handleNewSession();
    setShowSessions(false);
    setSearchTerm('');
  };

  const handleStopGeneration = async () => {
    if (!abortControllerRef.current || !currentSessionId) {
      return;
    }

    try {
      // 设置停止中状态
      setIsStopping(true);
      console.log('🛑 Stopping generation for session:', currentSessionId);

      // 先调用后端 interrupt API
      try {
        await interruptSessionMutation.mutateAsync(currentSessionId);
        console.log('✅ Successfully interrupted session via API');
      } catch (interruptError) {
        console.error('❌ Failed to interrupt session:', interruptError);
        // interrupt 失败，显示错误消息
        const errorMessage = interruptError instanceof Error ? interruptError.message : 'Unknown error';
        addMessage({
          content: `${t('agentChat.stopFailed')}\n\n${errorMessage}`,
          role: 'assistant'
        });
        setIsStopping(false);
        return; // 不继续执行 abort，按照用户要求不强制断开
      }

      // 中断所有正在执行的工具
      interruptAllExecutingTools();

      // interrupt 成功后，断开 SSE 连接
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setAiTyping(false);
      setIsStopping(false);
      setIsInitializingSession(false);

      // Add a message indicating the generation was stopped
      addMessage({
        content: t('agentChat.generationStopped'),
        role: 'assistant'
      });
    } catch (error) {
      console.error('Error stopping generation:', error);
      setIsStopping(false);
      setIsInitializingSession(false);
    }
  };

  // 处理语音转写完成
  const handleVoiceTranscribed = useCallback((text: string) => {
    if (text) {
      // 将转写的文本追加到输入框（如果已有内容，用空格分隔）
      setInputMessage((prev) => {
        if (prev.trim()) {
          return prev + ' ' + text;
        }
        return text;
      });
      // 聚焦输入框
      textareaRef.current?.focus();
    }
  }, []);

  // 打开语音设置页面
  const handleOpenVoiceSettings = useCallback(() => {
    openUrlInContext('/settings/voice');
  }, []);

  // Use message sender hook (must be after handleNewSession is defined)
  const { isSendDisabled, handleSendMessage } = useMessageSender({
    agent,
    projectPath,
    inputMessage,
    selectedImages,
    isAiTyping,
    currentSessionId,
    hasCommandsLoadError: !!hasCommandsLoadError,
    userCommandsError: userCommandsError || undefined,
    projectCommandsError: projectCommandsError || undefined,
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
  });

  // 自动发送初始消息 - 从 Dashboard 跳转过来时
  useEffect(() => {
    if (!shouldAutoSendRef.current || !inputMessage) return;
    
    // 使用轮询确保条件满足后发送
    const checkAndSend = () => {
      if (!isSendDisabled() && !isAiTyping) {
        shouldAutoSendRef.current = false;
        handleSendMessage();
        return true;
      }
      return false;
    };
    
    // 立即尝试一次
    if (checkAndSend()) return;
    
    // 如果不行，延迟重试
    const timer = setTimeout(() => {
      if (shouldAutoSendRef.current) {
        checkAndSend();
      }
    }, 500);
    
    return () => clearTimeout(timer);
  }, [inputMessage, isSendDisabled, isAiTyping, handleSendMessage]);

  // NOTE: Frontend tool schemas are now sent inline with each chat request
  // (via the `frontendTools` field). Pre-registration is no longer needed.

  const handleFrontendToolSubmit = useCallback(async (toolCallId: string, result: unknown): Promise<{ success: boolean; error?: string }> => {
    try {
      const pending = pendingFrontendTools.get(toolCallId);
      const apiResponse = await authFetch(`${API_BASE}/agents/frontend-tool-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCallId,
          result,
          sessionId: currentSessionId,
          agentId: agent.id,
          toolName: pending?.toolName,
        }),
      });

      if (!apiResponse.ok) {
        const err = await apiResponse.json().catch(() => ({}));
        return { success: false, error: err.error || `HTTP ${apiResponse.status}` };
      }

      removePendingFrontendTool(toolCallId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [currentSessionId, agent.id, pendingFrontendTools, removePendingFrontendTool]);

  const handleFrontendToolCancel = useCallback(async (toolCallId: string, reason?: string) => {
    try {
      const pending = pendingFrontendTools.get(toolCallId);
      await authFetch(`${API_BASE}/agents/frontend-tool-result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCallId,
          result: reason || 'Cancelled by user',
          isError: true,
          sessionId: currentSessionId,
          agentId: agent.id,
          toolName: pending?.toolName,
        }),
      });
      removePendingFrontendTool(toolCallId);
    } catch (error) {
      console.warn('[FrontendTools] Cancel failed:', error);
    }
  }, [currentSessionId, agent.id, pendingFrontendTools, removePendingFrontendTool]);

  // Listen for LAVS View requests to send a chat message
  useEffect(() => {
    const handleLAVSMessage = (message: string) => {
      if (isAiTyping) return;
      setInputMessage(message);
      shouldAutoSendRef.current = true;
    };
    eventBus.on(EVENTS.LAVS_SEND_CHAT_MESSAGE, handleLAVSMessage);
    return () => eventBus.off(EVENTS.LAVS_SEND_CHAT_MESSAGE, handleLAVSMessage);
  }, [isAiTyping, setInputMessage]);

  // 为 AgentCommandSelector 创建键盘处理器
  const agentCommandSelectorKeyHandler = createAgentCommandSelectorKeyHandler({
    showCommandSelector,
    showFileBrowser,
    commandSearch,
    selectedCommand,
    selectedCommandIndex,
    atSymbolPosition,
    projectPath,
    textareaRef,
    inputMessage,
    allCommands,
    onCommandSelect: handleCommandSelect,
    onSetInputMessage: setInputMessage,
    onSetShowCommandSelector: setShowCommandSelector,
    onSetSelectedCommandIndex: setSelectedCommandIndex,
    onSetShowFileBrowser: setShowFileBrowser,
    onSetAtSymbolPosition: setAtSymbolPosition,
    onHandleKeyDown: (e: React.KeyboardEvent) => {
      // 处理非命令选择器相关的键盘事件
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();

        // Check for undefined command and show warning
        if (isCommandTrigger(inputMessage)) {
          const commandName = inputMessage.slice(1).split(' ')[0].toLowerCase();
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
        }

        handleSendMessage();
        return;
      }
    }
  });

  // const handleKeyPress = useCallback((_e: React.KeyboardEvent) => {
  //   // Enter key is now fully handled in handleKeyDown
  //   // This function is kept for potential future use
  // }, []);


  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputMessage]);

  // Guard: when streaming starts, mark that subsequent sessionMessagesData
  // changes are likely stale cached data from query re-enabling, not user actions.
  // The flag is ONLY cleared by the timer in Effect 1 — never consumed by Effect 2.
  // This prevents a race condition where currentSessionId changing during streaming
  // (from system init) would prematurely consume the guard.
  const skipSessionLoadRef = useRef(false);

  useEffect(() => {
    if (isAiTyping) {
      skipSessionLoadRef.current = true;
    } else if (skipSessionLoadRef.current) {
      const timer = setTimeout(() => {
        skipSessionLoadRef.current = false;
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isAiTyping]);

  // Load session messages into the store when query data arrives.
  // The query is disabled during streaming (paused=isAiTyping).
  // When streaming ends, the query re-enables and may return stale cached
  // data that would overwrite live streaming content — the guard prevents this.
  useEffect(() => {
    if (skipSessionLoadRef.current) {
      console.log('📋 [SESSION] Skipping session message load — streaming guard active');
      return;
    }

    if (sessionMessagesData?.messages && currentSessionId) {
      loadSessionMessages(sessionMessagesData.messages);

      if (isLoadingMessages) {
        setTimeout(() => {
          setIsLoadingMessages(false);
        }, 100);
      }
    } else if (currentSessionId && sessionMessagesData && sessionMessagesData.messages?.length === 0) {
      loadSessionMessages([]);

      if (isLoadingMessages) {
        setTimeout(() => {
          setIsLoadingMessages(false);
        }, 100);
      }
    }
  }, [sessionMessagesData, currentSessionId, loadSessionMessages, isLoadingMessages]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.dropdown-container')) {
        setShowPermissionDropdown(false);
        setShowModelDropdown(false);
        setShowVersionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 检查当前会话是否在活跃会话中，如果是则切换至对应版本和模型并锁定
  // 注意：只有当会话有明确的版本ID时才锁定，否则保持用户当前的选择
  useEffect(() => {
    if (!currentSessionId || !activeSessionsData?.sessions) {
      setIsVersionLocked(false);
      return;
    }

    // 查找当前会话是否在活跃会话列表中
    const activeSession = activeSessionsData.sessions.find(s => s.sessionId === currentSessionId);

    if (activeSession) {
      console.log(`🔒 Found active session: ${currentSessionId}, version: ${activeSession.claudeVersionId}, model: ${activeSession.modelId}`);

      // 只有当会话有指定的版本时，才切换到该版本并锁定
      // 如果会话没有版本，保持用户当前的选择不变（不重置）
      if (activeSession.claudeVersionId) {
        // 只有当版本真正改变时才更新，避免不必要的状态更新导致模型被重置
        if (selectedClaudeVersion !== activeSession.claudeVersionId) {
          console.log(`🔄 Changing Claude version from ${selectedClaudeVersion} to ${activeSession.claudeVersionId}`);
          setSelectedClaudeVersion(activeSession.claudeVersionId);
        }
        
        // 同时恢复模型选择（如果会话记录了模型ID）
        if (activeSession.modelId && selectedModel !== activeSession.modelId) {
          console.log(`🔄 Restoring model from ${selectedModel} to ${activeSession.modelId}`);
          setSelectedModel(activeSession.modelId);
        }
        
        setIsVersionLocked(true);
        console.log(`🔒 Locked to Claude version: ${activeSession.claudeVersionId}, model: ${activeSession.modelId}`);
      } else {
        // 会话没有指定版本，只解锁但不重置用户的选择
        setIsVersionLocked(false);
        console.log(`🔓 Session has no specific version, unlocked but keeping user selection`);
      }
    } else {
      // 会话不在活跃列表中，只解锁但不重置用户的选择
      setIsVersionLocked(false);
      console.log(`🔓 Session ${currentSessionId} not in active sessions, unlocked but keeping user selection`);
    }
  }, [currentSessionId, activeSessionsData, selectedClaudeVersion, selectedModel, setSelectedModel]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header - Fixed */}
      <div
        className="flex-shrink-0 h-12 px-4 border-b border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 flex items-center"
      >
        <div className="flex items-center justify-between w-full">
          {/* Title */}
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold flex items-center space-x-2 text-gray-900 dark:text-white">
              <span className="text-lg flex-shrink-0">{agent.ui.icon}</span>
              <span className="truncate">[{currentServiceName}]</span>
              {projectPath && (
                <span className="text-sm opacity-75 font-normal truncate flex-shrink-0" title={projectPath}>
                  {projectPath.split('/').pop() || projectPath}
                </span>
              )}
              {currentSessionId && (
                <>
                  <span className="text-sm opacity-75">-</span>
                  <span className="text-sm opacity-75 truncate">
                    {sessionsData?.sessions?.find((s: any) => s.id === currentSessionId)?.title || t('agentChat.currentSession')}
                  </span>
                </>
              )}
            </h1>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
            {/* Engine Sync (headless - syncs service engine to store) */}
            <EngineSelector disabled={isAiTyping} />
            
            <div className="flex space-x-1">
              <button
                onClick={handleNewSessionWithUI}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300"
                title={t('agentChat.newSession')}
              >
                <Plus className="w-4 h-4" />
              </button>
            <div className="relative">
              <button
                onClick={() => setShowSessions(!showSessions)}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300"
                title={t('agentChat.sessionHistory')}
              >
                <Clock className="w-4 h-4" />
              </button>

              {/* Sessions Dropdown */}
              <SessionsDropdown
                isOpen={showSessions}
                onToggle={() => setShowSessions(!showSessions)}
                sessions={sessionsData?.sessions || []}
                currentSessionId={currentSessionId}
                onSwitchSession={handleSwitchSessionWithUI}
                isLoading={false}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
              />
            </div>
            <button
              onClick={handleRefreshMessages}
              disabled={!currentSessionId || isLoadingMessages}
              className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('agentChat.refreshMessages')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingMessages ? 'animate-spin' : ''}`} />
            </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域 - 聊天视图 - Scrollable with button overlay */}
      <div className="flex-1 relative min-h-0">
        <div ref={messagesContainerRef} className="absolute inset-0 px-5 py-5 overflow-y-auto space-y-4">
          {/* Welcome message */}
          <div className="px-4">
            <div className="text-sm leading-relaxed break-words overflow-hidden text-gray-600 dark:text-gray-400">
              {agent.ui.welcomeMessage || agent.description}
            </div>
          </div>

          {isLoadingMessages ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="flex space-x-2">
                <div className="w-3 h-3 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"></div>
                <div className="w-3 h-3 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-3 h-3 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {t('agentChat.loadingMessages')}
              </div>
            </div>
          ) : (
            <ChatMessageList
              messages={messages}
              isLoadingMessages={isLoadingMessages}
              isInitializingSession={isInitializingSession}
              isAiTyping={isAiTyping}
              isStopping={isStopping}
              messagesContainerRef={messagesContainerRef}
              messagesEndRef={messagesEndRef}
              isUserScrolling={isUserScrolling}
              newMessagesCount={newMessagesCount}
              onScrollToBottom={scrollToBottom}
              onFrontendToolSubmit={handleFrontendToolSubmit}
              onFrontendToolCancel={handleFrontendToolCancel}
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to bottom button - fixed at bottom of chat area */}
        {isUserScrolling && newMessagesCount > 0 && (
          <button
            onClick={() => {
              scrollToBottom();
              setIsUserScrolling(false);
              setNewMessagesCount(0);
            }}
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-500 hover:bg-blue-600 text-white rounded-full px-4 py-2 shadow-lg flex items-center space-x-2 transition-all duration-200 z-10"
          >
            <span className="text-sm font-medium">
              {t('agentChat.scrollToLatest')}
            </span>
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Unified Input Area */}
      <AgentInputArea
        // Basic state
        inputMessage={inputMessage}
        selectedImages={selectedImages}
        isAiTyping={isAiTyping}
        isStopping={isStopping}
        isMobile={isMobile}

        // Tool state
        showToolSelector={showToolSelector}
        selectedRegularTools={selectedRegularTools}
        selectedMcpTools={selectedMcpTools}
        mcpToolsEnabled={mcpToolsEnabled}

        // Command state
        showCommandSelector={showCommandSelector}
        showFileBrowser={showFileBrowser}
        commandSearch={commandSearch}
        selectedCommand={selectedCommand}
        selectedCommandIndex={selectedCommandIndex}
        atSymbolPosition={atSymbolPosition}
        commandWarning={commandWarning || ''}

        // Settings state
        permissionMode={permissionMode}
        selectedModel={selectedModel}
        selectedClaudeVersion={selectedClaudeVersion || ''}
        showPermissionDropdown={showPermissionDropdown}
        showModelDropdown={showModelDropdown}
        showVersionDropdown={showVersionDropdown}
        showMobileSettings={showMobileSettings}
        isCompactMode={isCompactMode}
        isVersionLocked={isVersionLocked}

        // UI state
        isDragOver={isDragOver}
        previewImage={previewImage}
        showConfirmDialog={showConfirmDialog}
        confirmMessage={confirmMessage || ''}
        showMcpStatusModal={showMcpStatusModal}

        // Data
        availableModels={availableModels}
        claudeVersionsData={claudeVersionsData}
        agent={agent}
        projectPath={projectPath}
        mcpStatus={mcpStatus}

        // Refs
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}

        // Event handlers
        onSend={handleSendMessage}
        handleKeyDown={agentCommandSelectorKeyHandler}
        handleImageSelect={handleImageSelect}
        handleImageRemove={handleImageRemove}
        handleImagePreview={handleImagePreview}
        handlePaste={handlePaste}
        handleDragOver={handleDragOver}
        handleDragLeave={handleDragLeave}
        handleDrop={handleDrop}
        handleStopGeneration={handleStopGeneration}

        // Setters
        onSetInputMessage={setInputMessage}
        onSetShowToolSelector={setShowToolSelector}
        onSetSelectedRegularTools={setSelectedRegularTools}
        onSetSelectedMcpTools={setSelectedMcpTools}
        onSetMcpToolsEnabled={setMcpToolsEnabled}
        onSetPermissionMode={setPermissionMode}
        onSetSelectedModel={setSelectedModel}
        onSetSelectedClaudeVersion={setSelectedClaudeVersion}
        onSetShowPermissionDropdown={setShowPermissionDropdown}
        onSetShowModelDropdown={setShowModelDropdown}
        onSetShowVersionDropdown={setShowVersionDropdown}
        onSetShowMobileSettings={setShowMobileSettings}
        onSetPreviewImage={setPreviewImage}
        onSetShowConfirmDialog={setShowConfirmDialog}
        onSetShowMcpStatusModal={setShowMcpStatusModal}

        // Command handlers
        onCommandSelect={handleCommandSelect}
        onSetShowCommandSelector={setShowCommandSelector}
        onSetSelectedCommandIndex={setSelectedCommandIndex}
        onSetShowFileBrowser={setShowFileBrowser}
        onSetAtSymbolPosition={setAtSymbolPosition}
        onSetCommandWarning={setCommandWarning}
        onSetCommandSearch={setCommandSearch}

        // Confirm dialog handlers
        handleConfirmDialog={handleConfirmDialog}
        handleCancelDialog={handleCancelDialog}

        // Utility functions
        // 当有待回答的问题时，也禁用输入框
        isSendDisabled={() => isSendDisabled() || pendingFrontendTools.size > 0}

        // Environment Variables
        envVars={envVars}
        onSetEnvVars={setEnvVars}

        // Voice Input
        onVoiceTranscribed={handleVoiceTranscribed}
        onOpenVoiceSettings={handleOpenVoiceSettings}
      />
    </div>
  );
};
