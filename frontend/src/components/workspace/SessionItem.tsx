import React, { useMemo, useState, useCallback } from 'react';
import { useStore } from 'zustand';
import { X } from 'lucide-react';
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
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const handleRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (showRemoveConfirm) {
        onRemove?.(sessionId);
        setShowRemoveConfirm(false);
      } else {
        setShowRemoveConfirm(true);
        setTimeout(() => setShowRemoveConfirm(false), 3000);
      }
    },
    [sessionId, onRemove, showRemoveConfirm],
  );
  const effectiveStore = storeApi ?? EMPTY_STORE;
  const isAiTyping = useStore(effectiveStore, (s) => s.isAiTyping);
  const status = useStore(effectiveStore, (s) => s.status);

  const effectiveStatus = isAiTyping ? 'running' : status;
  const badge = STATUS_BADGE[effectiveStatus] || STATUS_BADGE.idle;

  const relativeTime = useMemo(
    () => formatRelativeTime(lastActivity),
    [lastActivity],
  );

  const displayTitle = title || 'New Session';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      className={`
        w-full text-left px-3 py-2.5 rounded-lg transition-colors group cursor-pointer
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
            onClick={handleRemoveClick}
            className={`
              flex-shrink-0 p-0.5 rounded transition-colors
              ${showRemoveConfirm
                ? 'text-red-500 bg-red-50 dark:bg-red-900/30 opacity-100'
                : 'text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100'}
            `}
            title={showRemoveConfirm ? 'Click again to confirm' : 'Remove session'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
