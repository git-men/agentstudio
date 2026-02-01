/**
 * Hooks Management Page (Claude Code only)
 * 
 * Hooks are custom shell commands that execute automatically when targeted events occur.
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Edit,
  Trash2,
  AlertCircle,
  RefreshCw,
  Webhook,
  Globe,
  FolderOpen,
  Terminal,
  CheckCircle,
  XCircle,
  Play,
  Clock,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import useEngine from '../hooks/useEngine';
import { NotSupportedMessage } from '../components/EngineGate';

// Types
type HookEventType = 
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'Notification';

interface HookMatcher {
  tool_name?: string;
  tool_names?: string[];
  path_pattern?: string;
}

interface HookListItem {
  id: string;
  event: HookEventType;
  command: string;
  matcher?: HookMatcher;
  enabled: boolean;
  timeout?: number;
}

interface HooksResponse {
  hooks: HookListItem[];
  engine: string;
}

// Event type descriptions
const EVENT_DESCRIPTIONS: Record<HookEventType, string> = {
  PreToolUse: '工具执行前',
  PostToolUse: '工具成功执行后',
  PostToolUseFailure: '工具执行失败后',
  PermissionRequest: '请求权限时',
  SessionStart: '会话开始时',
  UserPromptSubmit: '用户提交提示时',
  Notification: '显示通知时',
};

// API functions
async function fetchHooks(scope?: 'global' | 'local'): Promise<HooksResponse> {
  const params = scope ? `?scope=${scope}` : '';
  const response = await authFetch(`${API_BASE}/hooks${params}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch hooks');
  }
  return response.json();
}

async function createHook(data: {
  event: HookEventType;
  command: string;
  matcher?: HookMatcher;
  enabled?: boolean;
  timeout?: number;
}, scope: 'global' | 'local'): Promise<{ hook: HookListItem }> {
  const response = await authFetch(`${API_BASE}/hooks?scope=${scope}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create hook');
  }
  return response.json();
}

async function updateHook(id: string, data: {
  event?: HookEventType;
  command?: string;
  matcher?: HookMatcher;
  enabled?: boolean;
  timeout?: number;
}): Promise<{ hook: HookListItem }> {
  const response = await authFetch(`${API_BASE}/hooks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update hook');
  }
  return response.json();
}

async function deleteHook(id: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/hooks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete hook');
  }
}

export const HooksPage: React.FC = () => {
  const { isCursorEngine, isFeatureSupported } = useEngine();
  const queryClient = useQueryClient();
  
  const [showForm, setShowForm] = useState(false);
  const [editingHook, setEditingHook] = useState<HookListItem | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<HookListItem | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    event: 'PreToolUse' as HookEventType,
    command: '',
    scope: 'global' as 'global' | 'local',
    toolName: '',
    pathPattern: '',
    enabled: true,
    timeout: '',
  });

  // Check if hooks are supported
  const hooksSupported = isFeatureSupported('hooks');

  // Queries
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hooks'],
    queryFn: () => fetchHooks(),
    enabled: hooksSupported,
  });

  const hooks = data?.hooks || [];

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createHook>[0]) => 
      createHook(data, formData.scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hooks'] });
      setShowForm(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateHook>[1] }) =>
      updateHook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hooks'] });
      setShowForm(false);
      setEditingHook(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteHook,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hooks'] });
      setShowDeleteConfirm(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateHook(id, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hooks'] });
    },
  });

  // Helpers
  const resetForm = () => {
    setFormData({
      event: 'PreToolUse',
      command: '',
      scope: 'global',
      toolName: '',
      pathPattern: '',
      enabled: true,
      timeout: '',
    });
  };

  const handleEditHook = (hook: HookListItem) => {
    setEditingHook(hook);
    const [scope] = hook.id.split(':');
    setFormData({
      event: hook.event,
      command: hook.command,
      scope: scope as 'global' | 'local',
      toolName: hook.matcher?.tool_name || hook.matcher?.tool_names?.join(', ') || '',
      pathPattern: hook.matcher?.path_pattern || '',
      enabled: hook.enabled,
      timeout: hook.timeout?.toString() || '',
    });
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const matcher: HookMatcher | undefined = (formData.toolName || formData.pathPattern) ? {
      ...(formData.toolName && { 
        tool_names: formData.toolName.split(',').map(s => s.trim()).filter(Boolean)
      }),
      ...(formData.pathPattern && { path_pattern: formData.pathPattern }),
    } : undefined;
    
    const hookData = {
      event: formData.event,
      command: formData.command,
      matcher,
      enabled: formData.enabled,
      timeout: formData.timeout ? parseInt(formData.timeout, 10) : undefined,
    };
    
    if (editingHook) {
      updateMutation.mutate({ id: editingHook.id, data: hookData });
    } else {
      createMutation.mutate(hookData);
    }
  };

  // Show not supported message for Cursor
  if (isCursorEngine || !hooksSupported) {
    return (
      <div className="p-6">
        <NotSupportedMessage
          feature="Hooks"
          description="Hooks 是 Claude Code 特有的功能，Cursor 不支持此功能。"
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>加载失败: {error instanceof Error ? error.message : '未知错误'}</span>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hooks</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              管理 Claude Code 钩子 - 在特定事件触发时自动执行的命令
            </p>
          </div>
          <button
            onClick={() => {
              setEditingHook(null);
              resetForm();
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>添加 Hook</span>
          </button>
        </div>
      </div>

      {/* Hooks Table */}
      {hooks.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <Webhook className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            暂无 Hooks
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            创建第一个 Hook 开始自动化工作流
          </p>
          <button
            onClick={() => {
              setEditingHook(null);
              resetForm();
              setShowForm(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            添加 Hook
          </button>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事件</TableHead>
                <TableHead>范围</TableHead>
                <TableHead>命令</TableHead>
                <TableHead>匹配器</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks.map((hook) => {
                const [scope] = hook.id.split(':');
                return (
                  <TableRow key={hook.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Play className="w-4 h-4 text-blue-500" />
                        <div>
                          <div className="font-medium">{hook.event}</div>
                          <div className="text-xs text-gray-500">
                            {EVENT_DESCRIPTIONS[hook.event]}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                        scope === 'global'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                      }`}>
                        {scope === 'global' ? <Globe className="w-3 h-3" /> : <FolderOpen className="w-3 h-3" />}
                        {scope === 'global' ? '全局' : '本地'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded max-w-xs truncate block">
                        {hook.command}
                      </code>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500 dark:text-gray-400">
                      {hook.matcher ? (
                        <div className="space-y-1">
                          {hook.matcher.tool_name && (
                            <div className="flex items-center gap-1">
                              <Terminal className="w-3 h-3" />
                              {hook.matcher.tool_name}
                            </div>
                          )}
                          {hook.matcher.tool_names && (
                            <div className="flex items-center gap-1">
                              <Terminal className="w-3 h-3" />
                              {hook.matcher.tool_names.join(', ')}
                            </div>
                          )}
                          {hook.matcher.path_pattern && (
                            <div className="flex items-center gap-1">
                              <FolderOpen className="w-3 h-3" />
                              {hook.matcher.path_pattern}
                            </div>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                      {hook.timeout && (
                        <div className="flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          {hook.timeout}ms
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleMutation.mutate({ id: hook.id, enabled: !hook.enabled })}
                        disabled={toggleMutation.isPending}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
                          hook.enabled
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/50 dark:text-green-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {hook.enabled ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            启用
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            禁用
                          </>
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEditHook(hook)}
                          className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                          title="编辑"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(hook)}
                          className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                {editingHook ? '编辑 Hook' : '创建 Hook'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  事件类型
                </label>
                <select
                  value={formData.event}
                  onChange={(e) => setFormData({ ...formData, event: e.target.value as HookEventType })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                >
                  {Object.entries(EVENT_DESCRIPTIONS).map(([event, desc]) => (
                    <option key={event} value={event}>
                      {event} - {desc}
                    </option>
                  ))}
                </select>
              </div>
              {!editingHook && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    范围
                  </label>
                  <select
                    value={formData.scope}
                    onChange={(e) => setFormData({ ...formData, scope: e.target.value as 'global' | 'local' })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  >
                    <option value="global">全局 (~/.claude/settings.json)</option>
                    <option value="local">本地 (.claude/settings.local.json)</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  命令
                </label>
                <input
                  type="text"
                  value={formData.command}
                  onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white font-mono"
                  placeholder="echo 'Hook triggered!'"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">将在事件触发时执行的 shell 命令</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  工具匹配 (可选)
                </label>
                <input
                  type="text"
                  value={formData.toolName}
                  onChange={(e) => setFormData({ ...formData, toolName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="Read, Write, Shell"
                />
                <p className="mt-1 text-xs text-gray-500">多个工具用逗号分隔</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  路径匹配 (可选)
                </label>
                <input
                  type="text"
                  value={formData.pathPattern}
                  onChange={(e) => setFormData({ ...formData, pathPattern: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="**/*.ts"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  超时 (毫秒, 可选)
                </label>
                <input
                  type="number"
                  value={formData.timeout}
                  onChange={(e) => setFormData({ ...formData, timeout: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  placeholder="5000"
                  min="0"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">
                  启用此 Hook
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingHook(null);
                    resetForm();
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">确认删除</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要删除此 Hook 吗？此操作无法撤销。
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate(showDeleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? '删除中...' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
