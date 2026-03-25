import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  MessageSquare,
  Hash,
  Loader2,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import type { IMBinding, IMChannel } from '../types/im';
import { PLATFORM_LABELS } from '../types/im';

interface ProjectIMChannelsModalProps {
  projectPath: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
}

function truncateKey(key: string, len = 6): string {
  if (key.length <= len * 2) return key;
  return `${key.slice(0, len)}...${key.slice(-len)}`;
}

const PLATFORM_ICONS: Record<IMBinding['platform'], string> = {
  wecom: '💼',
  qqbot: '🤖',
  weixin: '💬',
};

export const ProjectIMChannelsModal: React.FC<ProjectIMChannelsModalProps> = ({
  projectPath,
  projectName,
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const [bindings, setBindings] = useState<IMBinding[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBindings = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      // Fetch all bindings (no platform filter) and filter by project_path client-side
      const resp = await authFetch(`${API_BASE}/im-bindings`);
      const data = await resp.json();
      const all: IMBinding[] = data.bindings || [];
      setBindings(all.filter((b) => b.project_path === projectPath));
    } catch {
      setBindings([]);
    } finally {
      setLoading(false);
    }
  }, [isOpen, projectPath]);

  useEffect(() => {
    fetchBindings();
  }, [fetchBindings]);

  if (!isOpen) return null;

  const handleGoManage = () => {
    onClose();
    navigate('/im-channels');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-blue-500" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              IM 渠道绑定
            </h2>
            {projectName && (
              <span className="text-xs text-gray-400 dark:text-gray-500">— {projectName}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : bindings.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <MessageSquare className="w-9 h-9 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                当前项目暂无 IM 渠道绑定
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                前往「消息渠道」页面创建绑定
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {bindings.map((binding) => (
                <div
                  key={binding.id}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                >
                  {/* Binding header */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-900/40">
                    <span className="text-base">{PLATFORM_ICONS[binding.platform]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {binding.name}
                        </span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
                          {PLATFORM_LABELS[binding.platform]}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">
                        {truncateKey(binding.bot_key)}
                      </div>
                    </div>
                  </div>

                  {/* Channels */}
                  <div className="px-4 py-3">
                    {binding.channels && binding.channels.length > 0 ? (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                          Chat ID
                        </div>
                        {binding.channels.map((ch: IMChannel) => (
                          <div
                            key={ch.chat_id}
                            className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/40 rounded-lg"
                          >
                            <Hash className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                              {ch.chat_name || ch.chat_id}
                            </span>
                            {ch.chat_name && (
                              <span className="text-xs text-gray-400 font-mono ml-auto shrink-0">
                                {truncateKey(ch.chat_id)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {binding.platform === 'wecom'
                          ? '未关联群'
                          : '暂无 Chat ID'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleGoManage}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            前往消息渠道管理
          </button>
        </div>
      </div>
    </div>
  );
};
