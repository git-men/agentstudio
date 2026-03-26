import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Plus,
  Trash2,
  Pencil,
  Check,
  Loader2,
  AlertCircle,
  Hash,
  X,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { showSuccess, showError } from '../utils/toast';
import { useConfirm } from '../hooks/useConfirm';
import type { IMBinding, IMChannel } from '../types/im';
import { PLATFORM_LABELS, PLATFORM_BIND_ROUTES } from '../types/im';

const PLATFORMS: IMBinding['platform'][] = ['wecom', 'qqbot', 'weixin'];

function truncateKey(key: string, len = 8): string {
  if (key.length <= len * 2) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

// ──────────────────────────────────────────────────────────────
// Single platform section
// ──────────────────────────────────────────────────────────────

interface PlatformSectionProps {
  platform: IMBinding['platform'];
  onNavigateNewBind: (platform: IMBinding['platform']) => void;
}

const PlatformSection: React.FC<PlatformSectionProps> = ({ platform, onNavigateNewBind }) => {
  const confirm = useConfirm();
  const [bindings, setBindings] = useState<IMBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  // inline edit state
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');

  // add channel state
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
    fetchBindings();
  }, [fetchBindings]);

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

  const label = PLATFORM_LABELS[platform];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          <MessageSquare className="w-4 h-4" />
          {label}
          {!loading && (
            <span className="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500">
              ({bindings.length})
            </span>
          )}
        </button>
        <button
          onClick={() => onNavigateNewBind(platform)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          新绑定
        </button>
      </div>

      {/* Bindings list */}
      {expanded && (
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : bindings.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <MessageSquare className="w-9 h-9 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                暂无 {label} 绑定
              </p>
              <button
                onClick={() => onNavigateNewBind(platform)}
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
                  {/* Bot info */}
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
                    <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-700 pt-3">
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
                          {binding.channels.map((ch: IMChannel) => (
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
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Manual binding modal
// ──────────────────────────────────────────────────────────────

interface ManualBindModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const ManualBindModal: React.FC<ManualBindModalProps> = ({ open, onClose, onCreated }) => {
  const [platform, setPlatform] = useState<IMBinding['platform']>('wecom');
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [botKey, setBotKey] = useState('');
  const [chatId, setChatId] = useState('');
  const [chatName, setChatName] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setPlatform('wecom');
    setName('');
    setProjectPath('');
    setBotKey('');
    setChatId('');
    setChatName('');
  };

  const handleSubmit = async () => {
    if (!name.trim() || !projectPath.trim() || !botKey.trim()) {
      showError('请填写必填项');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        platform,
        name: name.trim(),
        project_path: projectPath.trim(),
        bot_key: botKey.trim(),
      };

      if (platform === 'wecom' && chatId.trim()) {
        body.channels = [{ chat_id: chatId.trim(), chat_name: chatName.trim() || undefined }];
      }

      const resp = await authFetch(`${API_BASE}/im-bindings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        showSuccess('补录成功', `${name} 已添加`);
        reset();
        onCreated();
        onClose();
      } else {
        const data = await resp.json().catch(() => ({}));
        throw new Error((data as any).error || '创建失败');
      }
    } catch (err) {
      showError('补录失败', err instanceof Error ? err.message : '未知错误');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">手动补录 IM 绑定</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">平台 *</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as IMBinding['platform'])}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="wecom">企业微信</option>
              <option value="weixin">微信</option>
              <option value="qqbot">QQ Bot</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：jarvis 企微"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">项目路径 *</label>
            <input
              type="text"
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="/Users/kongjie/projects/jarvis"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bot Key *</label>
            <input
              type="text"
              value={botKey}
              onChange={(e) => setBotKey(e.target.value)}
              placeholder="Webhook Key / Bot 标识"
              className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {platform === 'wecom' && (
            <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                企微群关联（可选，填写后该群将收到定时任务通知）
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Chat ID</label>
                  <input
                    type="text"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="企微群 Chat ID"
                    className="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">群名称</label>
                  <input
                    type="text"
                    value={chatName}
                    onChange={(e) => setChatName(e.target.value)}
                    placeholder="方便识别（可选）"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !projectPath.trim() || !botKey.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 rounded-lg transition-colors"
          >
            {saving ? '保存中...' : '补录'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────

export const IMChannelsPage: React.FC = () => {
  const navigate = useNavigate();
  const [manualBindOpen, setManualBindOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleNavigateNewBind = (platform: IMBinding['platform']) => {
    navigate(`${PLATFORM_BIND_ROUTES[platform]}?from=/im-channels`);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <MessageSquare className="w-6 h-6 text-blue-500" />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">消息渠道</h1>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              管理已接入的 IM 渠道绑定。点击「新绑定」可前往对应平台的接入向导。
            </p>
          </div>
          <button
            onClick={() => setManualBindOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Pencil className="w-4 h-4" />
            手动补录
          </button>
        </div>
      </div>

      {/* Platform sections */}
      <div className="space-y-4" key={refreshKey}>
        {PLATFORMS.map((platform) => (
          <PlatformSection
            key={platform}
            platform={platform}
            onNavigateNewBind={handleNavigateNewBind}
          />
        ))}
      </div>

      {/* Tip */}
      <div className="mt-6 flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
        <ExternalLink className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-600 dark:text-blue-400">
          「新绑定」会引导你完成接入配置（填写 Bot Webhook、授权企业微信回调等），完成后绑定记录会出现在对应平台区域。
          如果绑定数据丢失，可以点击「手动补录」直接录入。
        </p>
      </div>

      {/* Manual bind modal */}
      <ManualBindModal
        open={manualBindOpen}
        onClose={() => setManualBindOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
};
