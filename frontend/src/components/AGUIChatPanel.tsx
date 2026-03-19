/**
 * AGUI Chat Panel - TDesign React Chat implementation with native AGUI support
 * 
 * This component provides an alternative chat interface using TDesign's Chat components
 * with full AGUI protocol integration for streaming messages, thinking visualization,
 * and tool call display.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback, useContext } from 'react';
import { Clock, Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useSharedStore } from '../stores/useSharedStore';
import { SessionStoreContext, useSessionStoreOptional, useIsWorkspaceMode } from '../stores/SessionStoreContext';
import { sessionStoreManager } from '../services/SessionStoreManager';
import { SessionStreamManager } from '../services/SessionStreamManager';
import { useAgentSessions, useInterruptSession } from '../hooks/useAgents';
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
import { isCommandTrigger } from '../utils/commandFormatter';
import { ChatMessageRenderer } from './ChatMessageRenderer';
import {
    AgentInputArea,
    createAgentCommandSelectorKeyHandler,
    EngineSelector
} from './agentChat';
import useEngine from '../hooks/useEngine';
import { useRatingTool } from '../hooks/useRatingTool';
import { useConsoleLogsTool } from '../hooks/useConsoleLogsTool';


interface AGUIChatPanelProps {
    agent: AgentConfig;
    projectPath?: string;
    onSessionChange?: (sessionId: string | null) => void;
    initialMessage?: string;
    environmentContext?: string;
    /** When true, the top header bar (agent info, new session, history, refresh) is hidden. */
    hideHeader?: boolean;
}

/**
 * AGUI Chat Panel component using TDesign patterns with native AGUI protocol support
 */
export const AGUIChatPanel: React.FC<AGUIChatPanelProps> = ({
    agent,
    projectPath: rawProjectPath,
    onSessionChange,
    initialMessage,
    environmentContext,
    hideHeader = false,
}) => {
    const { t } = useTranslation('components');
    const { isCompactMode } = useResponsiveSettings();

    // Resolve effective project path: explicit prop > agent's workingDirectory
    const projectPath = rawProjectPath || agent.workingDirectory || undefined;

    // Register custom frontend tools
    useRatingTool();
    useConsoleLogsTool();
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

    // ---- Dual-mode state: workspace (Context) vs legacy (facade) ----
    const isWorkspaceMode = useIsWorkspaceMode();

    // Session-scoped state — from SessionStoreContext when in workspace
    // mode, from useAgentStore facade when in legacy ChatPage mode.
    // Both hooks are always called (hook-rule safe); we pick values below.
    const ctxMessages = useSessionStoreOptional((s) => s.messages);
    const ctxIsAiTyping = useSessionStoreOptional((s) => s.isAiTyping);
    const ctxMcpStatus = useSessionStoreOptional((s) => s.mcpStatus);
    const ctxPendingFrontendTools = useSessionStoreOptional((s) => s.pendingFrontendTools);
    const ctxAddMessage = useSessionStoreOptional((s) => s.addMessage);
    const ctxInterruptAllExecutingTools = useSessionStoreOptional((s) => s.interruptAllExecutingTools);
    const ctxSetAiTyping = useSessionStoreOptional((s) => s.setAiTyping);
    const ctxRemovePendingFrontendTool = useSessionStoreOptional((s) => s.removePendingFrontendTool);
    const ctxSessionId = useSessionStoreOptional((s) => s.sessionId);

    // Shared state — always from the shared singleton
    const selectedEngine = useSharedStore((s) => s.selectedEngine);
    const engineUICapabilities = useSharedStore((s) => s.engineUICapabilities);
    const engineModels = useSharedStore((s) => s.engineModels);

    // Legacy facade state (always called to satisfy hook rules)
    const facadeState = useAgentStore();

    // Pick session-scoped values based on mode
    const messages = isWorkspaceMode ? ctxMessages : facadeState.messages;
    const isAiTyping = isWorkspaceMode ? ctxIsAiTyping : facadeState.isAiTyping;
    const currentSessionId = isWorkspaceMode ? ctxSessionId : facadeState.currentSessionId;
    const mcpStatus = isWorkspaceMode ? ctxMcpStatus : facadeState.mcpStatus;
    const pendingFrontendTools = isWorkspaceMode ? ctxPendingFrontendTools : facadeState.pendingFrontendTools;
    const addMessage = isWorkspaceMode ? ctxAddMessage : facadeState.addMessage;
    const interruptAllExecutingTools = isWorkspaceMode ? ctxInterruptAllExecutingTools : facadeState.interruptAllExecutingTools;
    const ctxSetStatus = useSessionStoreOptional((s) => s.setStatus);
    const rawSetAiTyping = isWorkspaceMode ? ctxSetAiTyping : facadeState.setAiTyping;
    const setAiTyping = useCallback(
        (typing: boolean) => {
            rawSetAiTyping(typing);
            if (isWorkspaceMode) {
                ctxSetStatus(typing ? 'running' : 'completed');
            }
        },
        [rawSetAiTyping, isWorkspaceMode, ctxSetStatus],
    );
    const removePendingFrontendTool = isWorkspaceMode ? ctxRemovePendingFrontendTool : facadeState.removePendingFrontendTool;

    // Auto-send ref for initial message
    const shouldAutoSendRef = useRef(false);

    // Auto-focus textarea on mount (covers session switching in workspace mode)
    useEffect(() => {
        setTimeout(() => {
            textareaRef.current?.focus();
        }, 0);
    }, []);

    // Process initial message
    useEffect(() => {
        if (initialMessage && !hasProcessedInitialMessage) {
            setInputMessage(initialMessage);
            setHasProcessedInitialMessage(true);
            shouldAutoSendRef.current = true;
        }
    }, [initialMessage, hasProcessedInitialMessage]);

    // T021: Auto-derive session title from first user message (workspace mode)
    const ctxTitle = useSessionStoreOptional((s) => s.title);
    const ctxSetTitle = useSessionStoreOptional((s) => s.setTitle);
    const titleDerivedRef = useRef(false);
    useEffect(() => {
        if (!isWorkspaceMode || titleDerivedRef.current || ctxTitle) return;
        const firstUserMsg = messages.find((m) => m.role === 'user');
        if (!firstUserMsg) return;
        const text = (firstUserMsg.content || '').trim();
        if (!text) return;
        const derived =
            text.length <= 50
                ? text
                : text.slice(0, 50).replace(/\s+\S*$/, '') + '…';
        ctxSetTitle(derived);
        titleDerivedRef.current = true;
    }, [isWorkspaceMode, messages, ctxTitle, ctxSetTitle]);

    // Reset title derivation flag when session changes
    useEffect(() => {
        titleDerivedRef.current = false;
    }, [currentSessionId]);

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

    // Session management (imperative message loading — no react-query)
    const sessionManager = useSessionManager({
        agentId: agent.id,
        currentSessionId,
        projectPath,
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
        handleRefreshMessages,
        loadMessagesForSession,
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
    // Skip model validation when using AGUI engines (Cursor/CodeBuddy/Codex) to prevent resetting to Claude models
    const claudeVersionManager = useClaudeVersionManager({
        initialModel: projectDefaultModel || 'sonnet',
        initialVersion: projectDefaultProvider,
        skipModelValidation: selectedEngine === 'cursor' || selectedEngine === 'codebuddy' || selectedEngine === 'codex',
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
        if ((selectedEngine === 'cursor' || selectedEngine === 'codebuddy' || selectedEngine === 'codex') && engineModels.length > 0) {
            // When switching to AGUI engine, select the first available model
            const firstModel = engineModels[0]?.id || 'auto';
            console.log(`[AGUIChatPanel] Switching to ${selectedEngine} engine, resetting model to: ${firstModel}`);
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

    // Only fetch sessions once engine config is loaded from backend
    const isEngineReady = !!serviceEngineType;

    const { data: sessionsData, refetch: refetchSessions } = useAgentSessions(agent.id, searchTerm, projectPath, isEngineReady);
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

    // Load messages once on mount when a session is already selected (e.g. page
    // refreshed with ?session=xxx in the URL). Subsequent session switches go
    // through handleSwitchSession which loads messages imperatively.
    //
    // State machine ref to prevent the load effect from overwriting live-streamed
    // data after streaming ends (the most common cause of "last text disappears"):
    //   'idle'      → no load attempted yet, waiting for conditions
    //   'streaming' → session was created during streaming; skip backend load
    //   'done'      → initial load completed or intentionally skipped
    const initialLoadStateRef = useRef<'idle' | 'streaming' | 'done'>('idle');

    useEffect(() => {
        if (initialLoadStateRef.current === 'done') return;

        if (isAiTyping && currentSessionId) {
            initialLoadStateRef.current = 'streaming';
            return;
        }

        if (!isAiTyping && currentSessionId) {
            if (initialLoadStateRef.current === 'streaming') {
                initialLoadStateRef.current = 'done';
                return;
            }
            initialLoadStateRef.current = 'done';
            setIsLoadingMessages(true);
            loadMessagesForSession(currentSessionId).then(() => {
                setIsLoadingMessages(false);
            });
        }
    }, [currentSessionId, isAiTyping, loadMessagesForSession, setIsLoadingMessages]);

    // Auto-focus textarea when AI finishes responding
    const prevIsAiTypingRef = useRef(false);
    useEffect(() => {
        const wasTyping = prevIsAiTypingRef.current;
        prevIsAiTypingRef.current = isAiTyping;
        if (wasTyping && !isAiTyping) {
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 0);
        }
    }, [isAiTyping]);

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

    // Workspace mode: get the raw StoreApi and a SessionStreamManager for the
    // active session so that SSE events write directly to the session store.
    const sessionStoreApi = useContext(SessionStoreContext);
    const workspaceStreamManagerRef = useRef<SessionStreamManager | null>(null);

    const workspaceStreamManager = useMemo(() => {
        if (!isWorkspaceMode || !sessionStoreApi) return undefined;
        if (
            workspaceStreamManagerRef.current &&
            workspaceStreamManagerRef.current.getStore() === sessionStoreApi
        ) {
            return workspaceStreamManagerRef.current;
        }
        const mgr = new SessionStreamManager(sessionStoreApi);
        workspaceStreamManagerRef.current = mgr;

        const sid = sessionStoreApi.getState().sessionId;
        sessionStoreManager.attachStream(sid, mgr);
        return mgr;
    }, [isWorkspaceMode, sessionStoreApi]);

    // Message sender hook
    const { isSendDisabled, handleSendMessage } = useMessageSender({
        agent,
        projectPath,
        inputMessage,
        selectedImages,
        isAiTyping,
        currentSessionId,
        hasCommandsLoadError,
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
        environmentContext,
        sessionStore: isWorkspaceMode ? sessionStoreApi ?? undefined : undefined,
        externalStreamManager: workspaceStreamManager,
    });

    // Auto-send initial message when conditions are met
    useEffect(() => {
        if (!shouldAutoSendRef.current || !inputMessage) return;

        const checkAndSend = () => {
            if (!isSendDisabled() && !isAiTyping) {
                shouldAutoSendRef.current = false;
                handleSendMessage();
                return true;
            }
            return false;
        };

        if (checkAndSend()) return;

        const timer = setTimeout(() => {
            if (shouldAutoSendRef.current) {
                checkAndSend();
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [inputMessage, isSendDisabled, isAiTyping, handleSendMessage]);

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

    // Handle stop generation
    const handleStopGeneration = async () => {
        if (!abortControllerRef.current || !currentSessionId) {
            return;
        }

        try {
            setIsStopping(true);

            // IMPORTANT: Abort the client-side SSE stream FIRST to prevent receiving
            // any more events (including error events from the server-side interrupt).
            // Then call the server to clean up the backend session.
            interruptAllExecutingTools();
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setAiTyping(false);
            setIsInitializingSession(false);

            addMessage({
                content: t('agentChat.generationStopped'),
                role: 'assistant'
            });

            // Now call server-side interrupt (fire-and-forget, don't await)
            if (selectedEngine === 'cursor' || selectedEngine === 'codebuddy' || selectedEngine === 'codex') {
                authFetch(`${API_BASE}/agui/sessions/${currentSessionId}/interrupt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                }).catch(err => console.warn('[Stop] Server interrupt failed:', err));
            } else {
                interruptSessionMutation.mutateAsync(currentSessionId)
                    .catch(err => console.warn('[Stop] Server interrupt failed:', err));
            }

            setIsStopping(false);
        } catch (error) {
            console.error('Error stopping generation:', error);
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            setAiTyping(false);
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
                removePendingFrontendTool(toolCallId);
                return { success: false, error: err.error || `HTTP ${apiResponse.status}` };
            }
            removePendingFrontendTool(toolCallId);
            return { success: true };
        } catch (error) {
            removePendingFrontendTool(toolCallId);
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
                        message={message as unknown as Parameters<typeof ChatMessageRenderer>[0]['message']}
                        onFrontendToolSubmit={handleFrontendToolSubmit}
                        onFrontendToolCancel={handleFrontendToolCancel}
                    />
                </div>
            </div>
        ));
    }, [messages, handleFrontendToolSubmit, handleFrontendToolCancel]);

    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900">
            {/* Header — hidden when embedded in ProjectWorkspacePage */}
            {!hideHeader && (
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
                                disabled={!currentSessionId || isLoadingMessages || isAiTyping}
                                className="p-1.5 hover:bg-white/50 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-600 dark:text-gray-300 disabled:opacity-50"
                                title={t('agentChat.refreshMessages')}
                            >
                                <RefreshCw className={`w-4 h-4 ${isLoadingMessages ? 'animate-spin' : ''}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* EngineSelector must always mount (headless sync) even when header is hidden */}
            {hideHeader && <EngineSelector disabled={isAiTyping} />}

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

                // Data - use engine-specific models when AGUI engine (Cursor/CodeBuddy) is selected
                // When AGUI engine models are still loading (empty), show empty array instead of
                // falling back to Claude models to prevent toolbar flickering
                availableModels={(selectedEngine === 'cursor' || selectedEngine === 'codebuddy' || selectedEngine === 'codex') ? engineModels : availableModels}
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
                isSendDisabled={() => isSendDisabled() || pendingFrontendTools.size > 0}

                // Environment Variables
                envVars={envVars}
                onSetEnvVars={setEnvVars}

                // Engine UI capabilities
                engineUICapabilities={engineUICapabilities}
            />
        </div>
    );
};
