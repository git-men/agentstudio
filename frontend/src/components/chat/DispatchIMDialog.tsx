import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Send, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import type { DispatchStatus } from '../../types/dispatch';
import { authFetch } from '../../lib/authFetch';
import { API_BASE } from '../../lib/config';
import type { IMBinding } from '../../types/im';
import { PLATFORM_LABELS } from '../../types/im';

interface DispatchIMDialogProps {
  isOpen: boolean;
  projectPath?: string;
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
  projectPath,
  messagePreview,
  dispatchStatus,
  error,
  onConfirm,
  onCancel,
}) => {
  const [botKey, setBotKey] = useState('');
  const [chatId, setChatId] = useState('');

  // Dropdown states
  const [bindings, setBindings] = useState<IMBinding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [selectedBindingId, setSelectedBindingId] = useState<string>('');
  
  const fetchBindings = useCallback(async () => {
    if (!isOpen || !projectPath) return;
    setLoadingBindings(true);
    try {
      const resp = await authFetch(`${API_BASE}/im-bindings`);
      const data = await resp.json();
      const all: IMBinding[] = data.bindings || [];
      setBindings(all.filter((b) => b.project_path === projectPath));
    } catch {
      setBindings([]);
    } finally {
      setLoadingBindings(false);
    }
  }, [isOpen, projectPath]);

  useEffect(() => {
    fetchBindings();
  }, [fetchBindings]);

  useEffect(() => {
    if (isOpen) {
      const saved = loadSavedConfig();
      setBotKey(saved.botKey);
      setChatId(saved.chatId);
      setSelectedBindingId(''); // Reset selection on open
    }
  }, [isOpen]);

  // Derived options for dropdown
  const channelOptions = useMemo(() => {
    const options: Array<{ label: string; botKey: string; chatId: string; bindingId: string }> = [];
    bindings.forEach(binding => {
      const platformLabel = PLATFORM_LABELS[binding.platform] || binding.platform;
      if (binding.channels && binding.channels.length > 0) {
        binding.channels.forEach(ch => {
          options.push({
            label: `[${platformLabel}] ${binding.name} - ${ch.chat_name || ch.chat_id}`,
            botKey: binding.bot_key,
            chatId: ch.chat_id,
            bindingId: binding.id + '_' + ch.chat_id
          });
        });
      } else if (binding.platform === 'wecom') {
         // for wecom sometimes channel might be empty if we want to send to bot itself?
         // Actually if channels is empty, project mappings modal says "未关联群". 
         // But bot_key is what matters for enterprise wechat. Let's just use empty string or bot_key itself.
      }
    });
    return options;
  }, [bindings]);

  // When dropdown selection changes
  const handleSelectChannel = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedBindingId(val);
    
    if (val) {
      const option = channelOptions.find(o => o.bindingId === val);
      if (option) {
        setBotKey(option.botKey);
        setChatId(option.chatId);
      }
    }
  };

  // When manually typing, reset dropdown selection if it doesn't match
  const handleTypeBotKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBotKey(e.target.value);
    setSelectedBindingId('');
  };

  const handleTypeChatId = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatId(e.target.value);
    setSelectedBindingId('');
  };

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
        <div className="space-y-4 mb-5">
          {projectPath && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                选择已有的渠道目标
              </label>
              <div className="relative">
                <select
                  value={selectedBindingId}
                  onChange={handleSelectChannel}
                  disabled={isSending || loadingBindings}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 appearance-none
                    focus:ring-2 focus:ring-blue-500 focus:border-transparent
                    disabled:opacity-50"
                >
                  <option value="">{loadingBindings ? '加载中...' : '-- 手动填写下面信息 --'}</option>
                  {channelOptions.map(opt => (
                    <option key={opt.bindingId} value={opt.bindingId}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                  {loadingBindings ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}
                </div>
              </div>
            </div>
          )}

          {!selectedBindingId && (
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Bot Key
                </label>
                <input
                  type="text"
                  value={botKey}
                  onChange={handleTypeBotKey}
                  placeholder="企微 Bot Webhook Key"
                  disabled={isSending}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                    focus:ring-2 focus:ring-blue-500 focus:border-transparent
                    disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Chat ID
                </label>
                <input
                  type="text"
                  value={chatId}
                  onChange={handleTypeChatId}
                  placeholder="目标群/会话 ID"
                  disabled={isSending}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                    focus:ring-2 focus:ring-blue-500 focus:border-transparent
                    disabled:opacity-50"
                />
              </div>
            </div>
          )}
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
