import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import type { StoreApi } from 'zustand';
import type { SessionState, SessionActions } from '../../stores/createSessionStore';
import { createSessionStore } from '../../stores/createSessionStore';

const EMPTY_STORE = createSessionStore('__empty__', '__empty__');

interface SessionItemProps {
  sessionId: string;
  title: string | null;
  lastActivity: number;
  isActive: boolean;
  storeApi: StoreApi<SessionState & SessionActions> | undefined;
  onClick: () => void;
  onRemove?: (sessionId: string) => void;
  onRename?: (sessionId: string, newTitle: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_BADGE: Record<string, { dot: string; label: string }> = {
  idle: { dot: 'bg-gray-400 dark:bg-gray-500', label: 'Idle' },
  running: { dot: 'bg-green-500', label: 'Running' },
  completed: { dot: 'bg-blue-500', label: 'Done' },
  error: { dot: 'bg-red-500', label: 'Error' },
};

export const SessionItem: React.FC<SessionItemProps> = ({
  sessionId,
  title,
  lastActivity,
  isActive,
  storeApi,
  onClick,
  onRemove,
  onRename,
}) => {
  const { t } = useTranslation('components');
  const [showRenamePopover, setShowRenamePopover] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renamePopoverRef = useRef<HTMLDivElement>(null);
  const deletePopoverRef = useRef<HTMLDivElement>(null);

  const effectiveStore = storeApi ?? EMPTY_STORE;
  const isAiTyping = useStore(effectiveStore, (s) => s.isAiTyping);
  const status = useStore(effectiveStore, (s) => s.status);
  const effectiveStatus = isAiTyping ? 'running' : status;
  const badge = STATUS_BADGE[effectiveStatus] || STATUS_BADGE.idle;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const relativeTime = useMemo(() => formatRelativeTime(lastActivity), [lastActivity, tick]);
  const displayTitle = title || t('workspace.defaultTitle', 'New Session');

  useEffect(() => {
    if (showRenamePopover) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [showRenamePopover]);

  useEffect(() => {
    if (!showRenamePopover) return;
    const handler = (e: MouseEvent) => {
      if (renamePopoverRef.current && !renamePopoverRef.current.contains(e.target as Node)) {
        setShowRenamePopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRenamePopover]);

  useEffect(() => {
    if (!showDeleteConfirm) return;
    const handler = (e: MouseEvent) => {
      if (deletePopoverRef.current && !deletePopoverRef.current.contains(e.target as Node)) {
        setShowDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDeleteConfirm]);

  useEffect(() => {
    if (!showRenamePopover && !showDeleteConfirm) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowRenamePopover(false);
        setShowDeleteConfirm(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showRenamePopover, showDeleteConfirm]);

  const handleRenameClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(displayTitle);
    setShowDeleteConfirm(false);
    setShowRenamePopover(true);
  }, [displayTitle]);

  const handleRenameConfirm = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== displayTitle) {
      onRename?.(sessionId, trimmed);
    }
    setShowRenamePopover(false);
  }, [renameValue, displayTitle, sessionId, onRename]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRenamePopover(false);
    setShowDeleteConfirm(true);
  }, []);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
    onRemove?.(sessionId);
  }, [sessionId, onRemove]);

  const hasActions = !!(onRemove || onRename);

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
        className={`
          w-full text-left px-3 py-2.5 rounded-lg transition-colors group cursor-pointer
          ${isActive
            ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'}
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-shrink-0 relative flex items-center justify-center w-2.5 h-2.5">
            <span className={`block w-2 h-2 rounded-full ${badge.dot}`} />
            {isAiTyping && (
              <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
            )}
          </span>

          <span className={`flex-1 truncate text-sm ${isActive ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
            {displayTitle}
          </span>

          {/* 时间：无 hover 时显示，hover 时隐藏（actions 出现） */}
          <span className={`flex-shrink-0 text-xs text-gray-400 dark:text-gray-500 ${hasActions ? 'group-hover:hidden' : ''}`}>
            {relativeTime}
          </span>

          {/* ✏ 重命名按钮 */}
          {onRename && (
            <button
              onClick={handleRenameClick}
              aria-label={t('workspace.renameSession', '重命名会话')}
              className="hidden group-hover:inline-flex flex-shrink-0 p-0.5 rounded transition-colors text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}

          {/* 🗑 删除按钮 */}
          {onRemove && (
            <button
              onClick={handleDeleteClick}
              aria-label={t('workspace.deleteSession', '删除会话')}
              className="hidden group-hover:inline-flex flex-shrink-0 p-0.5 rounded transition-colors text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Rename popover */}
      {showRenamePopover && (
        <div
          ref={renamePopoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3"
        >
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t('workspace.renameSession', '重命名会话')}
          </p>
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); handleRenameConfirm(); } }}
            maxLength={100}
            placeholder={t('workspace.sessionNamePlaceholder', '输入会话名称')}
            className="w-full px-2 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
          />
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); setShowRenamePopover(false); }}
              className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('workspace.cancel', '取消')}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleRenameConfirm(); }}
              disabled={!renameValue.trim() || renameValue.trim() === displayTitle}
              className="px-2.5 py-1 text-xs rounded-md bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            >
              {t('workspace.saveRename', '保存')}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm popover */}
      {showDeleteConfirm && (
        <div
          ref={deletePopoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3"
        >
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3">
            {t('workspace.confirmDeleteSession', '确定删除此会话？')}
          </p>
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
              className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('workspace.cancel', '取消')}
            </button>
            <button
              onClick={handleDeleteConfirm}
              className="px-2.5 py-1 text-xs rounded-md bg-red-500 hover:bg-red-600 text-white transition-colors"
            >
              {t('workspace.delete', '删除')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
