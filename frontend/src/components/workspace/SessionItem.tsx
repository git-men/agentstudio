import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { X, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

/**
 * A single session row in the workspace sidebar.
 * Subscribes directly to the session's StoreApi for live status / typing
 * updates — does NOT use SessionStoreContext (since the sidebar needs to
 * observe ALL sessions, not just the active one).
 */
export const SessionItem: React.FC<SessionItemProps> = ({
  sessionId,
  title,
  lastActivity,
  isActive,
  storeApi,
  onClick,
  onRemove,
}) => {
  const { t } = useTranslation('components');
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showConfirm) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showConfirm]);

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (deleting) return;
      setShowConfirm(true);
    },
    [deleting],
  );

  const handleConfirmDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDeleting(true);
      setShowConfirm(false);
      onRemove?.(sessionId);
    },
    [sessionId, onRemove],
  );

  const handleCancelDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowConfirm(false);
    },
    [],
  );

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

  const relativeTime = useMemo(
    () => formatRelativeTime(lastActivity),
    [lastActivity, tick],
  );

  const displayTitle = title || 'New Session';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`
        relative w-full text-left px-3 py-2.5 rounded-lg transition-colors group cursor-pointer
        ${
          isActive
            ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'
        }
      `}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-shrink-0 relative flex items-center justify-center w-2.5 h-2.5">
          <span
            className={`block w-2 h-2 rounded-full ${badge.dot}`}
          />
          {isAiTyping && (
            <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
          )}
        </span>

        <span
          className={`
            flex-1 truncate text-sm
            ${isActive ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}
          `}
        >
          {displayTitle}
        </span>

        <span className="flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">
          {relativeTime}
        </span>

        {onRemove && (
          <button
            onClick={handleDeleteClick}
            disabled={deleting}
            className={`
              flex-shrink-0 p-0.5 rounded transition-colors
              ${deleting
                ? 'text-gray-400 dark:text-gray-500 opacity-100 cursor-wait'
                : 'text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100'}
            `}
            title={deleting ? t('workspace.deleting', 'Deleting…') : t('workspace.deleteSession', 'Delete session')}
          >
            {deleting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Delete confirmation popover */}
      {showConfirm && (
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600 p-3 min-w-[180px]"
        >
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
            {t('workspace.confirmDeleteSession', 'Delete this session?')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirmDelete}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              {t('workspace.delete', 'Delete')}
            </button>
            <button
              onClick={handleCancelDelete}
              className="flex-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              {t('workspace.cancel', 'Cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
