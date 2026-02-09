import React, { useState } from 'react';
import {
  X,
  GitBranch,
  Tag,
  Save,
  Clock,
  Check,
  AlertTriangle,
  Trash2,
  ArrowRight,
  Loader2,
  Hash,
} from 'lucide-react';
import {
  useVersions,
  useVersionStatus,
  useCreateVersion,
  useCheckoutVersion,
  useDeleteVersion,
  VersionInfo,
} from '../hooks/useGitVersions';
import { showError, showSuccess } from '../utils/toast';

interface Project {
  id: string;
  name: string;
  path: string;
}

interface ProjectVersionModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
}

export const ProjectVersionModal: React.FC<ProjectVersionModalProps> = ({
  isOpen,
  project,
  onClose,
}) => {
  const [newVersionMessage, setNewVersionMessage] = useState('');
  const [newVersionSlot, setNewVersionSlot] = useState(1);
  const [showConfirmCheckout, setShowConfirmCheckout] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);

  const projectId = project?.path || '';

  const { data: versions = [], isLoading: versionsLoading } = useVersions(projectId);
  const { data: status, isLoading: statusLoading } = useVersionStatus(projectId);
  const createVersion = useCreateVersion();
  const checkoutVersion = useCheckoutVersion();
  const deleteVersion = useDeleteVersion();

  if (!isOpen || !project) return null;

  const handleCreateVersion = async () => {
    if (!newVersionMessage.trim()) {
      showError('请输入版本描述');
      return;
    }

    try {
      const result = await createVersion.mutateAsync({
        projectId,
        message: newVersionMessage.trim(),
        slot: newVersionSlot,
      });
      showSuccess(`版本 ${result.version.tag} 创建成功`);
      setNewVersionMessage('');
    } catch (error: any) {
      showError(error.message || '创建版本失败');
    }
  };

  const handleCheckout = async (tag: string, force: boolean = false) => {
    try {
      await checkoutVersion.mutateAsync({ projectId, tag, force });
      showSuccess(`已切换到版本 ${tag}`);
      setShowConfirmCheckout(null);
    } catch (error: any) {
      if (error.code === 'DIRTY_WORKING_TREE') {
        // Show the dirty state confirmation dialog
        setShowConfirmCheckout(tag);
      } else {
        showError(error.message || '切换版本失败');
      }
    }
  };

  const handleDelete = async (tag: string) => {
    try {
      await deleteVersion.mutateAsync({ projectId, tag });
      showSuccess(`版本 ${tag} 已删除`);
      setShowConfirmDelete(null);
    } catch (error: any) {
      showError(error.message || '删除版本失败');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const isLoading = versionsLoading || statusLoading;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
              <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                版本管理
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {project.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Status Bar */}
        {status && (
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-300">
                  {status.currentVersion ? (
                    <span className="font-medium text-purple-600 dark:text-purple-400">
                      {status.currentVersion}
                    </span>
                  ) : (
                    <span className="text-gray-400">无版本</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-600 dark:text-gray-300">
                  共 {status.totalVersions} 个版本
                </span>
              </div>
              {status.isDirty && (
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    有未保存的修改 ({status.modifiedFiles} 文件修改, {status.untrackedFiles} 新文件)
                  </span>
                </div>
              )}
              {!status.isDirty && status.initialized && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <Check className="w-3.5 h-3.5" />
                  <span>工作区干净</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create New Version */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-3">
            <select
              value={newVersionSlot}
              onChange={(e) => setNewVersionSlot(Number(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              aria-label="选择版本槽位"
            >
              <option value={1}>slot1</option>
              <option value={2}>slot2</option>
              <option value={3}>slot3</option>
              <option value={4}>slot4</option>
              <option value={5}>slot5</option>
            </select>
            <input
              type="text"
              value={newVersionMessage}
              onChange={(e) => setNewVersionMessage(e.target.value)}
              placeholder="输入版本描述，例如：添加定时提醒功能"
              className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !createVersion.isPending) {
                  handleCreateVersion();
                }
              }}
            />
            <button
              onClick={handleCreateVersion}
              disabled={createVersion.isPending || !newVersionMessage.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {createVersion.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              保存版本
            </button>
          </div>
        </div>

        {/* Version List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">加载中...</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-12">
              <GitBranch className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                暂无版本记录
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                输入描述并点击"保存版本"创建第一个版本
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((version: VersionInfo) => (
                <VersionItem
                  key={version.tag}
                  version={version}
                  showConfirmCheckout={showConfirmCheckout}
                  showConfirmDelete={showConfirmDelete}
                  isCheckingOut={checkoutVersion.isPending}
                  isDeleting={deleteVersion.isPending}
                  onCheckout={handleCheckout}
                  onDelete={handleDelete}
                  onConfirmCheckout={setShowConfirmCheckout}
                  onConfirmDelete={setShowConfirmDelete}
                  formatDate={formatDate}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ========================================
// Version Item Sub-component
// ========================================

interface VersionItemProps {
  version: VersionInfo;
  showConfirmCheckout: string | null;
  showConfirmDelete: string | null;
  isCheckingOut: boolean;
  isDeleting: boolean;
  onCheckout: (tag: string, force?: boolean) => void;
  onDelete: (tag: string) => void;
  onConfirmCheckout: (tag: string | null) => void;
  onConfirmDelete: (tag: string | null) => void;
  formatDate: (dateStr: string) => string;
}

const VersionItem: React.FC<VersionItemProps> = ({
  version,
  showConfirmCheckout,
  showConfirmDelete,
  isCheckingOut,
  isDeleting,
  onCheckout,
  onDelete,
  onConfirmCheckout,
  onConfirmDelete,
  formatDate,
}) => {
  const isConfirmingCheckout = showConfirmCheckout === version.tag;
  const isConfirmingDelete = showConfirmDelete === version.tag;

  return (
    <div
      className={`group rounded-lg border p-3 transition-colors ${
        version.isCurrent
          ? 'border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/20'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Tag Badge */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-medium ${
              version.isCurrent
                ? 'bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
            }`}
          >
            <Tag className="w-3 h-3" />
            {version.tag}
          </span>

          {/* Current badge */}
          {version.isCurrent && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400">
              <Check className="w-3 h-3" />
              当前
            </span>
          )}

          {/* Message */}
          <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
            {version.message}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          {/* Date */}
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDate(version.date)}
          </span>

          {/* Checkout button */}
          {!version.isCurrent && (
            <button
              onClick={() => onCheckout(version.tag)}
              disabled={isCheckingOut}
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded transition-all"
              title={`切换到 ${version.tag}`}
            >
              {isCheckingOut ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ArrowRight className="w-3 h-3" />
              )}
              切换
            </button>
          )}

          {/* Delete button */}
          <button
            onClick={() => onConfirmDelete(version.tag)}
            disabled={isDeleting}
            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded transition-all"
            title={`删除 ${version.tag}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Dirty working tree confirmation */}
      {isConfirmingCheckout && (
        <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                当前工作区有未保存的修改，切换版本将丢失这些修改。
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onCheckout(version.tag, true)}
                  className="px-3 py-1 text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
                >
                  放弃修改并切换
                </button>
                <button
                  onClick={() => onConfirmCheckout(null)}
                  className="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {isConfirmingDelete && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-700 dark:text-red-300">
                确定要删除版本 {version.tag} 吗？此操作不可撤销。
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onDelete(version.tag)}
                  className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                >
                  确认删除
                </button>
                <button
                  onClick={() => onConfirmDelete(null)}
                  className="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded transition-colors"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectVersionModal;
