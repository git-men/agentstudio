import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Plus,
  Trash2,
  Pencil,
  Check,
  MessageSquare,
  Loader2,
  AlertCircle,
  Hash,
} from 'lucide-react';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { showSuccess, showError } from '../utils/toast';
import { useConfirm } from '../hooks/useConfirm';
import type { IMBinding } from '../types/im';

const PLATFORM_LABELS: Record<string, string> = {
  wecom: '企业微信',
  qqbot: 'QQ Bot',
  weixin: '微信',
};

interface IMBindingModalProps {
  platform: 'wecom' | 'qqbot' | 'weixin';
  isOpen: boolean;
  onClose: () => void;
  onNewBind: () => void;
}

function truncateKey(key: string, len = 8): string {
  if (key.length <= len * 2) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

export const IMBindingModal: React.FC<IMBindingModalProps> = ({
  platform,
  isOpen,
  onClose,
  onNewBind,
}) => {
  const confirm = useConfirm();
  const [bindings, setBindings] = useState<IMBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [addingChannel, setAddingChannel] = useState<string | null>(null);
  const [channelChatId, setChannelChatId] = useState('');
  const [channelChatName, setChannelChatName] = useState('');

  const fetchBindings = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authFetch(`${API_BASE}/im-bindings?platform=${platform}`);
      const data = await resp.json();
      setBindings(data.bindings || []);
    } catch {
      setBindings([]);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    if (isOpen) fetchBindings();
  }, [isOpen, fetchBindings]);

  const handleDelete = async (binding: IMBinding) => {
    const confirmed = await confirm({
      title: '删除绑定',
      message: `确定删除「${binding.name}」的绑定吗？这不会删除 as-dispatch 上的 Bot 配置。`,
      confirmText: '删除',
      cancelText: '取消',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const resp = await authFetch(`${API_BASE}/im-bindings/${encodeURIComponent(binding.bot_key)}`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        showSuccess('已删除', `${binding.name} 绑定已移除`);
        fetchBindings();
      } else {
        throw new Error('删除失败');
      }
    } catch (err) {
      showError('删除失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  const handleSaveName = async (binding: IMBinding) => {
    if (!nameInput.trim() || nameInput.trim() === binding.name) {
      setEditingName(null);
      return;
    }
    try {
      const resp = await authFetch(`${API_BASE}/im-bindings/${encodeURIComponent(binding.bot_key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (resp.ok) {
        showSuccess('已更新', '绑定名称已修改');
        setEditingName(null);
        fetchBindings();
      }
    } catch (err) {
      showError('更新失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  const handleAddChannel = async (binding: IMBinding) => {
    if (!channelChatId.trim()) return;
    try {
      const resp = await authFetch(
        `${API_BASE}/im-bindings/${encodeURIComponent(binding.bot_key)}/channels`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: channelChatId.trim(),
            chat_name: channelChatName.trim() || undefined,
          }),
        },
      );
      if (resp.ok) {
        showSuccess('已添加', '群已关联');
        setAddingChannel(null);
        setChannelChatId('');
        setChannelChatName('');
        fetchBindings();
      }
    } catch (err) {
      showError('添加失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  const handleRemoveChannel = async (binding: IMBinding, chatId: string) => {
    try {
      const resp = await authFetch(
        `${API_BASE}/im-bindings/${encodeURIComponent(binding.bot_key)}/channels/${encodeURIComponent(chatId)}`,
        { method: 'DELETE' },
      );
      if (resp.ok) {
        fetchBindings();
      }
    } catch {
      showError('删除失败', '无法移除群关联');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {PLATFORM_LABELS[platform]} 绑定管理
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onNewBind}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              新绑定
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : bindings.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">暂无绑定记录</p>
              <button
                onClick={onNewBind}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                创建第一个绑定
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {bindings.map((binding) => (
                <div
                  key={binding.id}
                  className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  {/* Bot info header */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {editingName === binding.bot_key ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={nameInput}
                              onChange={(e) => setNameInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveName(binding);
                                if (e.key === 'Escape') setEditingName(null);
                              }}
                              autoFocus
                              className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-600 rounded-lg outline-none text-gray-900 dark:text-white"
                            />
                            <button
                              onClick={() => handleSaveName(binding)}
                              className="p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingName(null)}
                              className="p-1 text-gray-400 hover:text-gray-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                              {binding.name}
                            </span>
                          </div>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>{binding.project_name}</span>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span className="font-mono">{truncateKey(binding.bot_key)}</span>
                        </div>
                      </div>
                      {editingName !== binding.bot_key && (
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            onClick={() => {
                              setEditingName(binding.bot_key);
                              setNameInput(binding.name);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
                            title="编辑名称"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(binding)}
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
                            title="删除绑定"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Channels section (WeChat Work only) */}
                  {platform === 'wecom' && (
                    <div className="px-4 pb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          关联群
                        </span>
                        <button
                          onClick={() => {
                            setAddingChannel(
                              addingChannel === binding.bot_key ? null : binding.bot_key,
                            );
                            setChannelChatId('');
                            setChannelChatName('');
                          }}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          添加群
                        </button>
                      </div>

                      {binding.channels && binding.channels.length > 0 ? (
                        <div className="space-y-1.5">
                          {binding.channels.map((ch) => (
                            <div
                              key={ch.chat_id}
                              className="flex items-center justify-between px-3 py-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Hash className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                                  {ch.chat_name || truncateKey(ch.chat_id, 6)}
                                </span>
                                {ch.chat_name && (
                                  <span className="text-xs text-gray-400 font-mono truncate">
                                    {truncateKey(ch.chat_id, 6)}
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => handleRemoveChannel(binding, ch.chat_id)}
                                className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                          <AlertCircle className="w-3.5 h-3.5" />
                          未关联群 — 可稍后添加
                        </div>
                      )}

                      {/* Add channel inline form */}
                      {addingChannel === binding.bot_key && (
                        <div className="mt-2 p-3 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700">
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={channelChatId}
                              onChange={(e) => setChannelChatId(e.target.value)}
                              placeholder="Chat ID（必填）"
                              autoFocus
                              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-blue-400 text-gray-700 dark:text-gray-300 placeholder-gray-400 font-mono"
                            />
                            <input
                              type="text"
                              value={channelChatName}
                              onChange={(e) => setChannelChatName(e.target.value)}
                              placeholder="群名称（可选，方便识别）"
                              className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg outline-none focus:border-blue-400 text-gray-700 dark:text-gray-300 placeholder-gray-400"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button
                              onClick={() => setAddingChannel(null)}
                              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleAddChannel(binding)}
                              disabled={!channelChatId.trim()}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded-lg transition-colors"
                            >
                              添加
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
