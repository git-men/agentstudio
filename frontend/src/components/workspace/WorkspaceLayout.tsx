import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useSharedStore } from '../../stores/useSharedStore';

interface WorkspaceLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
  rightPanelVisible?: boolean;
  onToggleRightPanel?: () => void;
  footer?: React.ReactNode;
  /** Initial width for the right panel (default 360px). Ignored when defaultRightRatio is set. */
  defaultRightWidth?: number;
  /** Initial ratio for the right panel relative to (container - sidebar) width, e.g. 0.6 means 60%. */
  defaultRightRatio?: number;
  /** When true, the floating right-panel toggle button is hidden (use toolbar toggle instead). */
  hideRightToggle?: boolean;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;
const RIGHT_MIN = 250;
const RIGHT_DEFAULT = 360;
const CENTER_MIN = 300;

/**
 * Resizable multi-panel layout for the workspace view.
 * Left: session list sidebar (collapsible, draggable).
 * Center: main chat area.
 * Right: optional panel (file browser, etc.) — toggle + draggable.
 * Footer: optional toolbar/status bar spanning the full width.
 */
export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  sidebar,
  children,
  rightPanel,
  rightPanelVisible = false,
  onToggleRightPanel,
  footer,
  defaultRightWidth = RIGHT_DEFAULT,
  defaultRightRatio,
  hideRightToggle = false,
}) => {
  const sidebarWidth = useSharedStore((s) => s.workspaceSidebarWidth);
  const setSidebarWidth = useSharedStore((s) => s.setWorkspaceSidebarWidth);
  const sidebarCollapsed = useSharedStore((s) => s.sidebarCollapsed);

  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [rightWidth, setRightWidth] = useState<number | string>(defaultRightWidth);
  const containerRef = useRef<HTMLDivElement>(null);

  // When defaultRightRatio is provided, recalculate right panel width on first layout
  useEffect(() => {
    if (defaultRightRatio == null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const currentLeft = sidebarCollapsed ? 0 : sidebarWidth;
    const available = rect.width - currentLeft;
    const computed = Math.round(available * defaultRightRatio);
    setRightWidth(Math.max(RIGHT_MIN, Math.min(available - CENTER_MIN, computed)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
  }, []);

  const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (isDraggingLeft) {
        const newWidth = e.clientX - rect.left;
        setSidebarWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
      }
      if (isDraggingRight) {
        const newWidth = rect.right - e.clientX;
        const currentLeft = sidebarCollapsed ? 0 : sidebarWidth;
        const rightMax = rect.width - currentLeft - CENTER_MIN;
        setRightWidth(Math.max(RIGHT_MIN, Math.min(rightMax, newWidth)));
      }
    },
    [isDraggingLeft, isDraggingRight, setSidebarWidth, sidebarCollapsed, sidebarWidth],
  );

  const handleMouseUp = useCallback(() => {
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  const isDragging = isDraggingLeft || isDraggingRight;

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const showRight = rightPanelVisible && !!rightPanel;

  return (
    <div className="flex flex-col h-full bg-gray-100 dark:bg-gray-900">
      {/* Panels row */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        {!sidebarCollapsed && (
          <div
            className="flex-shrink-0 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
            style={{ width: sidebarWidth }}
          >
            {sidebar}
          </div>
        )}

        {/* Left drag handle */}
        {!sidebarCollapsed && (
          <div
            className={`
              flex-shrink-0 w-1 cursor-col-resize group relative
              ${isDraggingLeft ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500'}
              transition-colors
            `}
            onMouseDown={handleLeftMouseDown}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
        )}

        {/* Inner wrapper for Main and Right panels */}
        <div className="flex-1 min-w-0 flex">
          {/* Main panel */}
          <div className="flex-1 min-w-0 flex flex-col">
            {children}
          </div>

          {/* Right drag handle */}
          {showRight && (
            <div
              className={`
                flex-shrink-0 w-1 cursor-col-resize group relative
                ${isDraggingRight ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500'}
                transition-colors
              `}
              onMouseDown={handleRightMouseDown}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
          )}

          {/* Right panel */}
          {showRight && (
            <div
              className="flex-shrink-0 flex flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 relative"
              style={{ width: rightWidth }}
            >
              {rightPanel}
              {/* Transparent overlay to prevent iframe from consuming mouse events during drag */}
              {isDraggingRight && (
                <div className="absolute inset-0 z-50" style={{ cursor: 'col-resize' }} />
              )}
            </div>
          )}
        </div>

        {/* Right panel toggle (hidden when toolbar provides its own toggle) */}
        {onToggleRightPanel && !hideRightToggle && (
          <button
            onClick={onToggleRightPanel}
            className="absolute top-3 right-2 z-20 p-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm transition-colors"
          >
            {showRight ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Footer toolbar */}
      {footer && (
        <div className="flex-shrink-0">{footer}</div>
      )}
    </div>
  );
};
