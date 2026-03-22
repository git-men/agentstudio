import React, { useMemo, useState, useCallback } from 'react';
import { MapPin, Forward, Check, Loader2, AlertCircle } from 'lucide-react';
import { ChatMessageRenderer } from '../ChatMessageRenderer';
import { useTranslation } from 'react-i18next';
import { useDispatchIM } from '../../hooks/useDispatchIM';
import { DispatchIMDialog } from '../chat/DispatchIMDialog';
import type { DispatchStatus } from '../../types/dispatch';

const ENVIRONMENT_CONTEXT_RE = /^<environment_context>\n([\s\S]*?)\n<\/environment_context>\n\n/;

function parseEnvironmentContext(content: string): { envLabel: string | null; cleanContent: string } {
  const match = content.match(ENVIRONMENT_CONTEXT_RE);
  if (!match) return { envLabel: null, cleanContent: content };
  return { envLabel: match[1], cleanContent: content.replace(ENVIRONMENT_CONTEXT_RE, '') };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  messageParts?: any[];
  images?: any[];
}

export interface ChatMessageListProps {
  messages: Message[];
  isLoadingMessages: boolean;
  isInitializingSession: boolean;
  isAiTyping: boolean;
  isStopping: boolean;
  messagesContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  isUserScrolling: boolean;
  newMessagesCount: number;
  onScrollToBottom: () => void;
  onFrontendToolSubmit?: (toolCallId: string, result: unknown) => Promise<{ success: boolean; error?: string }>;
  onFrontendToolCancel?: (toolCallId: string, reason?: string) => void;
  sessionId?: string;
  projectName?: string;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({
  messages,
  isLoadingMessages,
  isInitializingSession,
  isAiTyping,
  isStopping,
  messagesContainerRef,
  messagesEndRef,
  onFrontendToolSubmit,
  onFrontendToolCancel,
  sessionId,
  projectName,
}) => {
  const { t } = useTranslation('components');
  const { dispatchToIM, getStatus, resetStatus } = useDispatchIM();
  const [dispatchDialog, setDispatchDialog] = useState<{ messageId: string; content: string } | null>(null);

  const handleForwardClick = useCallback((messageId: string, content: string) => {
    resetStatus(messageId);
    setDispatchDialog({ messageId, content });
  }, [resetStatus]);

  const handleDispatchConfirm = useCallback(async (botKey: string, chatId: string) => {
    if (!dispatchDialog || !sessionId) return;
    await dispatchToIM(dispatchDialog.messageId, {
      sessionId,
      messageContent: dispatchDialog.content,
      botKey,
      chatId,
      projectName,
    });
    setDispatchDialog(null);
  }, [dispatchDialog, sessionId, projectName, dispatchToIM]);

  const handleDispatchCancel = useCallback(() => {
    setDispatchDialog(null);
  }, []);

  // Memoize rendered messages to prevent unnecessary re-renders
  const renderedMessages = useMemo(() => {
    return messages.map((message) => {
      let displayMessage = message;
      let envLabel: string | null = null;

      if (message.role === 'user') {
        // Check message.content (legacy / primary format)
        if (message.content) {
          const parsed = parseEnvironmentContext(message.content);
          envLabel = parsed.envLabel;
          if (envLabel) {
            displayMessage = { ...message, content: parsed.cleanContent };
          }
        }
        // Always check messageParts as well — ChatMessageRenderer prioritises
        // messageParts over content, so raw tags must be stripped here too.
        if (message.messageParts?.length) {
          const firstText = message.messageParts.find((p: any) => p.type === 'text' && p.content);
          if (firstText) {
            const parsed = parseEnvironmentContext(firstText.content);
            if (parsed.envLabel) {
              if (!envLabel) envLabel = parsed.envLabel;
              displayMessage = {
                ...(displayMessage || message),
                messageParts: message.messageParts.map((p: any) =>
                  p === firstText ? { ...p, content: parsed.cleanContent } : p
                ),
              };
            }
          }
        }
      }

      const msgDispatch = message.role === 'assistant' ? getStatus(message.id) : null;
      const plainText = message.content || '';

      return (
        <div key={message.id} className="px-4 group/msg">
          {envLabel && (
            <div className="flex items-center gap-1 mb-1 justify-end">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300">
                <MapPin className="w-3 h-3" />
                {envLabel}
              </span>
            </div>
          )}
          <div
            className={`text-sm leading-relaxed break-words overflow-hidden ${
              message.role === 'user'
                ? 'text-white p-3 rounded-lg'
                : 'text-gray-800 dark:text-gray-200'
            }`}
            style={message.role === 'user' ? { backgroundColor: 'hsl(var(--primary))', color: 'white' } : {}}
          >
            <ChatMessageRenderer 
              message={displayMessage as any} 
              onFrontendToolSubmit={onFrontendToolSubmit}
              onFrontendToolCancel={onFrontendToolCancel}
            />
          </div>

          {/* Forward button + dispatch status for assistant messages */}
          {message.role === 'assistant' && plainText && (
            <div className="flex items-center gap-2 mt-1 min-h-[20px]">
              {msgDispatch?.status === 'sent' ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400" title={`已转发 (${msgDispatch.shortId})`}>
                  <Check size={12} /> 已转发
                </span>
              ) : msgDispatch?.status === 'sending' ? (
                <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                  <Loader2 size={12} className="animate-spin" /> 发送中…
                </span>
              ) : msgDispatch?.status === 'error' ? (
                <span className="inline-flex items-center gap-1 text-xs text-red-500" title={msgDispatch.error}>
                  <AlertCircle size={12} /> 转发失败
                </span>
              ) : null}

              <button
                onClick={() => handleForwardClick(message.id, plainText)}
                className="opacity-0 group-hover/msg:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                title="转发到企业微信"
              >
                <Forward size={13} />
              </button>
            </div>
          )}
        </div>
      );
    });
  }, [messages, onFrontendToolSubmit, onFrontendToolCancel, getStatus, handleForwardClick]);

  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 overflow-y-auto space-y-4 py-4 relative"
    >
      {isLoadingMessages && (
        <div className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('agentChatPanel.loadingMessages')}</p>
          </div>
        </div>
      )}

      {!isLoadingMessages && messages.length === 0 && (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-500 dark:text-gray-400">
           
          </div>
        </div>
      )}

      {!isLoadingMessages && renderedMessages}

      {/* 会话初始化指示器：优先级最高 */}
      {isInitializingSession && (
        <div className="px-4">
          <div className="flex flex-col items-center space-y-2">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('agentChatPanel.initializingSession')}
            </div>
          </div>
        </div>
      )}

      {/* AI 输入指示器：会话初始化完成后显示 */}
      {!isInitializingSession && (isAiTyping || isStopping) && (
        <div className="px-4">
          <div className="flex flex-col items-center space-y-2">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            {isStopping && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {t('agentChat.stopping')}
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />

      {/* Dispatch IM Dialog */}
      {dispatchDialog && (
        <DispatchIMDialog
          isOpen
          messagePreview={dispatchDialog.content}
          dispatchStatus={getStatus(dispatchDialog.messageId).status}
          error={getStatus(dispatchDialog.messageId).error}
          onConfirm={handleDispatchConfirm}
          onCancel={handleDispatchCancel}
        />
      )}
    </div>
  );
};
