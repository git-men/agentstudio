import React, { useState, useEffect } from 'react';
import { X, Send, Loader2, AlertCircle } from 'lucide-react';
import type { DispatchStatus } from '../../types/dispatch';

interface DispatchIMDialogProps {
  isOpen: boolean;
  messagePreview: string;
  dispatchStatus: DispatchStatus;
  error?: string;
  onConfirm: (botKey: string, chatId: string) => void;
  onCancel: () => void;
}

const STORAGE_KEY = 'dispatch-im-config';

function loadSavedConfig(): { botKey: string; chatId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { botKey: '', chatId: '' };
}

function saveConfig(botKey: string, chatId: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ botKey, chatId }));
}

export const DispatchIMDialog: React.FC<DispatchIMDialogProps> = ({
  isOpen,
  messagePreview,
  dispatchStatus,
  error,
  onConfirm,
  onCancel,
}) => {
  const [botKey, setBotKey] = useState('');
  const [chatId, setChatId] = useState('');

  useEffect(() => {
    if (isOpen) {
      const saved = loadSavedConfig();
      setBotKey(saved.botKey);
      setChatId(saved.chatId);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isSending = dispatchStatus === 'sending';
  const canSubmit = botKey.trim() && chatId.trim() && !isSending;

  const handleConfirm = () => {
    if (!canSubmit) return;
    saveConfig(botKey.trim(), chatId.trim());
    onConfirm(botKey.trim(), chatId.trim());
  };

  const truncated = messagePreview.length > 100
    ? messagePreview.slice(0, 100) + '…'
    : messagePreview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X size={20} />
        </button>

        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          转发到企业微信
        </h3>

        {/* Message preview */}
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm text-gray-600 dark:text-gray-300 max-h-24 overflow-y-auto">
          {truncated}
        </div>

        {/* Config inputs */}
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Bot Key
            </label>
            <input
              type="text"
              value={botKey}
              onChange={e => setBotKey(e.target.value)}
              placeholder="企微 Bot Webhook Key"
              disabled={isSending}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                focus:ring-2 focus:ring-blue-500 focus:border-transparent
                disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Chat ID
            </label>
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="目标群/会话 ID"
              disabled={isSending}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                focus:ring-2 focus:ring-blue-500 focus:border-transparent
                disabled:opacity-50"
            />
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-sm text-red-600 dark:text-red-400">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isSending}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700
              hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600
              hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                发送中…
              </>
            ) : (
              <>
                <Send size={14} />
                确认转发
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
