/**
 * AGUI Chat Panel - TDesign React Chat implementation with native AGUI support
 * 
 * This component provides an alternative chat interface using TDesign's Chat components
 * with full AGUI protocol integration for streaming messages, thinking visualization,
 * and tool call display.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Clock, Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useAgentSessions, useAgentSessionMessages, useInterruptSession } from '../hooks/useAgents';
import { useSessions } from '../hooks/useSessions';
import { useSessionHeartbeatOnSuccess } from '../hooks/useSessionHeartbeatOnSuccess';
import { useResponsiveSettings } from '../hooks/useResponsiveSettings';
import { SessionsDropdown } from './SessionsDropdown';
import type { AgentConfig } from '../types/index.js';
import { useTranslation } from 'react-i18next';
import { loadBackendServices, getCurrentService } from '../utils/backendServiceStorage';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { useMobileContext } from '../contexts/MobileContext';
import {
    useImageUpload,
    useScrollManagement,
    useMessageSender,
    useSessionManager,
    useUIState,
    useClaudeVersionManager,
    useToolSelector,
    useCommandCompletion
} from '../hooks/agentChat';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import {
    AgentInputArea,
    createAgentCommandSelectorKeyHandler,
    EngineSelector
} from './agentChat';
import useEngine from '../hooks/useEngine';


interface AGUIChatPanelProps {
    agent: AgentConfig;
    projectPath?: string;
    onSessionChange?: (sessionId: string | null) => void;
    initialMessage?: string;
}

/**
 * AGUI Chat Panel component using TDesign patterns with native AGUI protocol support
 */
export const AGUIChatPanel: React.FC<AGUIChatPanelProps> = ({
    agent,
    projectPath,
    onSessionChange,
    initialMessage
}) => {
    const { t } = useTranslation('components');
    const { isCompactMode } = useResponsiveSettings();
    const { isMobile } = useMobileContext();
    
    // Get engine type from service - this is the source of truth
    const { engineType: serviceEngineType } = useEngine();

    // Refs
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Basic state
    const [inputMessage, setInputMessage] = useState('');
    const [hasProcessedInitialMessage, setHasProcessedInitialMessage] = useState(false);
    const [projectDefaultProvider, setProjectDefaultProvider] = useState<string | undefined>(undefined);
    const [projectDefaultModel, setProjectDefaultModel] = useState<string | undefined>(undefined);

    // Agent store state
    const {
        messages,
        isAiTyping,
        currentSessionId,
        mcpStatus,
        pendingUserQuestion,
        selectedEngine,
        engineUICapabilities,
        engineModels,
        addMessage,
        interruptAllExecutingTools,
        setAiTyping,
        loadSessionMessages,
        setPendingUserQuestion,
    } = useAgentStore();

    // Auto-send ref for initial message
    const shouldAutoSendRef = useRef(false);

    // Process initial message
    useEffect(() => {
        if (initialMessage && !hasProcessedInitialMessage) {
            setInputMessage(initialMessage);
            setHasProcessedInitialMessage(true);
            shouldAutoSendRef.current = true;
        }
    }, [initialMessage, hasProcessedInitialMessage]);

    // UI state management
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

    // Session management
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

    // Image upload hook
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

    // Scroll management
    const scrollManagement = useScrollManagement({
        messagesContainerRef,
        messagesEndRef,
        messages,
        isAiTyping
    });

    const { scrollToBottom, isUserScrolling, newMessagesCount, setIsUserScrolling, setNewMessagesCount } = scrollManagement;

    // Command completion hook
    const commandCompletion = useCommandCompletion({
        projectPath,
        textareaRef
    });

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
        handleCommandSelect,
        isCommandDefined,
        getAllAvailableCommands
    } = commandCompletion;

    // Tool selector
    const toolSelector = useToolSelector({ agent });
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

    // Claude version manager
    // Skip model validation when using Cursor engine to prevent resetting to GLM models
    const claudeVersionManager = useClaudeVersionManager({
        initialModel: projectDefaultModel || 'sonnet',
        initialVersion: projectDefaultProvider,
        skipModelValidation: selectedEngine === 'cursor',
    });
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
    
    // Reset model selection when switching engines
    useEffect(() => {
        if (selectedEngine === 'cursor' && engineModels.length > 0) {
            // When switching to Cursor, select the first available model (usually 'auto')
            const firstModel = engineModels[0]?.id || 'auto';
            console.log(`[AGUIChatPanel] Switching to Cursor engine, resetting model to: ${firstModel}`);
            setSelectedModel(firstModel);
        }
    }, [selectedEngine, engineModels, setSelectedModel]);

    // Fetch project default settings and apply to version manager
    useEffect(() => {
        if (projectPath) {
            const fetchProjectSettings = async () => {
                try {
                    const response = await authFetch(`${API_BASE}/projects/${encodeURIComponent(projectPath)}`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log('🔧 Project settings loaded:', data.project);

                        // Apply project's default provider
                        if (data.project.defaultProviderId) {
                            console.log('🔧 Setting provider to:', data.project.defaultProviderId);
                            setProjectDefaultProvider(data.project.defaultProviderId);
                            setSelectedClaudeVersion(data.project.defaultProviderId);
                        }

                        // Apply project's default model
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

    // Backend service name
    const [currentServiceName, setCurrentServiceName] = useState<string>('默认服务');
    useEffect(() => {
        const backendServices = loadBackendServices();
        const currentService = getCurrentService(backendServices);
        if (currentService) {
            setCurrentServiceName(currentService.name);
        }
    }, []);

    // API hooks
    const interruptSessionMutation = useInterruptSession();
    
    // Check if engine has synced - only fetch sessions when selectedEngine matches service engine
    // This prevents fetching with wrong engine type (e.g., fetching claude sessions when service is cursor)
    const SERVICE_TO_STORE_ENGINE: Record<string, 'claude' | 'cursor'> = {
        'cursor-cli': 'cursor',
        'claude-sdk': 'claude',
    };
    const expectedEngine = serviceEngineType ? SERVICE_TO_STORE_ENGINE[serviceEngineType] : undefined;
    // Only fetch when: 1) service engine is loaded AND 2) selectedEngine matches expected engine
    const isEngineSynced = !!expectedEngine && selectedEngine === expectedEngine;
    
    const { data: sessionsData, refetch: refetchSessions } = useAgentSessions(agent.id, searchTerm, projectPath, selectedEngine, isEngineSynced);
    const { data: sessionMessagesData } = useAgentSessionMessages(agent.id, currentSessionId, projectPath, selectedEngine);
    const { data: activeSessionsData } = useSessions();

    // Refresh sessions when dropdown opens
    useEffect(() => {
        if (showSessions) {
            refetchSessions();
        }
    }, [showSessions, refetchSessions]);

    // Session heartbeat
    useSessionHeartbeatOnSuccess({
        agentId: agent.id,
        sessionId: currentSessionId,
        projectPath,
        enabled: !!currentSessionId,
        isNewSession,
        hasSuccessfulResponse
    });

    // Load session messages
    useEffect(() => {
        if (sessionMessagesData?.messages && currentSessionId) {
            loadSessionMessages(sessionMessagesData.messages);
            if (isLoadingMessages) {
                setTimeout(() => setIsLoadingMessages(false), 100);
            }
        }
    }, [sessionMessagesData, currentSessionId, loadSessionMessages, isLoadingMessages]);

    // Restore model/provider from active session when page refreshes
    useEffect(() => {
        if (!currentSessionId || !activeSessionsData?.sessions) {
            setIsVersionLocked(false);
            return;
        }

        // Find if current session is in active sessions list
        const activeSession = activeSessionsData.sessions.find(s => s.sessionId === currentSessionId);

        if (activeSession) {
            console.log(`🔒 Found active session: ${currentSessionId}, version: ${activeSession.claudeVersionId}, model: ${activeSession.modelId}`);

            // Only switch and lock if session has a specific version
            if (activeSession.claudeVersionId) {
                // Only update if version actually changes
                if (selectedClaudeVersion !== activeSession.claudeVersionId) {
                    console.log(`🔄 Changing Claude version from ${selectedClaudeVersion} to ${activeSession.claudeVersionId}`);
                    setSelectedClaudeVersion(activeSession.claudeVersionId);
                }

                // Also restore model selection if session recorded modelId
                if (activeSession.modelId && selectedModel !== activeSession.modelId) {
                    console.log(`🔄 Restoring model from ${selectedModel} to ${activeSession.modelId}`);
                    setSelectedModel(activeSession.modelId);
                }

                setIsVersionLocked(true);
                console.log(`🔒 Locked to Claude version: ${activeSession.claudeVersionId}, model: ${activeSession.modelId}`);
            } else {
                // Session has no specific version, unlock but don't reset user's selection
                setIsVersionLocked(false);
                console.log(`🔓 Session has no specific version, unlocked but keeping user selection`);
            }
        } else {
            // Session not in active list, unlock but don't reset user's selection
            setIsVersionLocked(false);
            console.log(`🔓 Session ${currentSessionId} not in active sessions, unlocked but keeping user selection`);
        }
    }, [currentSessionId, activeSessionsData, selectedClaudeVersion, selectedModel, setSelectedModel, setSelectedClaudeVersion, setIsVersionLocked]);

    // Check if commands failed to load
    const hasCommandsLoadError = !!(userCommandsError || projectCommandsError);

    // Message sender hook
    const { isSendDisabled, handleSendMessage } = useMessageSender({
        agent,
        projectPath,
        inputMessage,
        selectedImages,
        isAiTyping,
        currentSessionId,
        hasCommandsLoadError,
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

    // Agent command selector key handler
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
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
                return;
            }
        }
    });

    // Handle stop generation
    const handleStopGeneration = async () => {
        if (!abortControllerRef.current || !currentSessionId) {
            return;
        }

        try {
            setIsStopping(true);
            await interruptSessionMutation.mutateAsync(currentSessionId);
            interruptAllExecutingTools();
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setAiTyping(false);
            setIsStopping(false);
            setIsInitializingSession(false);

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


    // Auto-adjust textarea height
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        }
    }, [inputMessage]);

    // Handle session switch with UI
    const handleSwitchSessionWithUI = (sessionId: string) => {
        handleSwitchSession(sessionId);
        setShowSessions(false);
    };

    const handleNewSessionWithUI = () => {
        handleNewSession();
        setShowSessions(false);
        setSearchTerm('');
    };

    // Ask user question submit
    const handleAskUserQuestionSubmit = async (toolUseId: string, response: string) => {
        try {
            const apiResponse = await authFetch(`${API_BASE}/agents/user-response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    toolUseId,
                    response,
                    sessionId: currentSessionId,
                    agentId: agent.id,
                }),
            });

            if (!apiResponse.ok) {
                throw new Error(`HTTP ${apiResponse.status}`);
            }
            setPendingUserQuestion(null);
        } catch (error) {
            console.error('Submit failed:', error);
        }
    };

    // Render messages using existing renderer - matching original chat style
    const renderedMessages = useMemo(() => {
        return messages.map((message) => (
            <div key={message.id} className="px-4">
                <div
                    className={`text-sm leading-relaxed break-words overflow-hidden ${message.role === 'user'
                        ? 'text-white p-3 rounded-lg bg-gray-800 dark:bg-gray-700'
                        : 'text-gray-800 dark:text-gray-200'
                        }`}
                >
                    <ChatMessageRenderer
                        message={message as any}
                        onAskUserQuestionSubmit={handleAskUserQuestionSubmit}
                    />
                </div>
            </div>
        ));
    }, [messages, handleAskUserQuestionSubmit]);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900">
            {/* Header */}
            <div className="flex-shrink-0 h-12 px-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-800 flex items-center">
                <div className="flex items-center justify-between w-full">
                    {/* Title with AGUI badge */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-lg">{agent.ui.icon}</span>
                        <h1 className="text-base font-semibold text-gray-900 dark:text-white truncate">
                            [{currentServiceName}]
                        </h1>
                        <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded-full">
                            AGUI
                        </span>
                        {projectPath && (
                            <span className="text-sm text-gray-600 dark:text-gray-300 font-normal truncate" title={projectPath}>
                                {projectPath.split('/').pop() || projectPath}
                            </span>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                        {/* Engine Sync (headless - syncs service engine to store) */}
                        <EngineSelector disabled={isAiTyping} />
                        
                        <div className="flex space-x-1">
                            <button
                                onClick={handleNewSessionWithUI}
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300"
                                title={t('agentChat.newSession')}
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        <div className="relative">
                            <button
                                onClick={() => setShowSessions(!showSessions)}
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300"
                                title={t('agentChat.sessionHistory')}
                            >
                                <Clock className="w-4 h-4" />
                            </button>
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
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300 disabled:opacity-50"
                                title={t('agentChat.refreshMessages')}
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoadingMessages ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 relative min-h-0">
                <div
                    ref={messagesContainerRef}
                    className="absolute inset-0 px-5 py-5 overflow-y-auto space-y-4"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Welcome message */}
                    <div className="px-4">
                        <div className="text-sm leading-relaxed break-words overflow-hidden text-gray-600 dark:text-gray-400">
                            {agent.ui.welcomeMessage || agent.description}
                        </div>
                    </div>

                    {/* Loading state */}
                    {isLoadingMessages && (
                        <div className="flex flex-col items-center justify-center py-12 space-y-3">
                            <div className="flex space-x-2">
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                            </div>
                            <div className="text-sm text-gray-500">{t('agentChat.loadingMessages')}</div>
                        </div>
                    )}

                    {/* Messages */}
                    {!isLoadingMessages && renderedMessages}

                    {/* Typing indicator */}
                    {(isInitializingSession || isAiTyping || isStopping) && (
                        <div className="px-4 py-3">
                            <div className="flex items-center gap-2">
                                <div className="flex space-x-1">
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                                {isInitializingSession && (
                                    <span className="text-xs text-gray-500">{t('agentChatPanel.initializingSession')}</span>
                                )}
                                {isStopping && (
                                    <span className="text-xs text-gray-500">{t('agentChat.stopping')}</span>
                                )}
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Scroll to bottom button */}
                {isUserScrolling && newMessagesCount > 0 && (
                    <button
                        onClick={() => {
                            scrollToBottom();
                            setIsUserScrolling(false);
                            setNewMessagesCount(0);
                        }}
                        className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-blue-500 hover:bg-blue-600 text-white rounded-full px-4 py-2 shadow-lg flex items-center gap-2"
                    >
                        <span className="text-sm">{t('agentChat.scrollToLatest')}</span>
                        <ChevronDown className="w-4 h-4" />
                    </button>
                )}

                {/* Drag overlay */}
                {isDragOver && (
                    <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center">
                        <div className="text-blue-500 font-medium">{t('agentChat.dropImageHere')}</div>
                    </div>
                )}
            </div>

            {/* Input Area - using shared component */}
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

                // Data - use engine-specific models when Cursor is selected
                availableModels={selectedEngine === 'cursor' && engineModels.length > 0 ? engineModels : availableModels}
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
                isSendDisabled={() => isSendDisabled() || !!pendingUserQuestion}

                // Environment Variables
                envVars={envVars}
                onSetEnvVars={setEnvVars}
                
                // Engine UI capabilities
                engineUICapabilities={engineUICapabilities}
            />
        </div>
    );
};
