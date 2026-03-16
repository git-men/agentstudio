import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSharedStore } from '../../stores/useSharedStore';

interface WorkspaceLayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

const MIN_WIDTH = 200;
const MAX_WIDTH = 600;

/**
 * Resizable two-panel layout for the workspace view.
 * Left panel: session list sidebar. Right panel: main chat area.
 * Sidebar width is persisted in useSharedStore.
 */
export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  sidebar,
  children,
}) => {
  const sidebarWidth = useSharedStore((s) => s.workspaceSidebarWidth);
  const setSidebarWidth = useSharedStore((s) => s.setWorkspaceSidebarWidth);
  const sidebarCollapsed = useSharedStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSharedStore((s) => s.setSidebarCollapsed);

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      setSidebarWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
    },
    [isDragging, setSidebarWidth],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

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

  return (
    <div ref={containerRef} className="flex h-full bg-gray-100 dark:bg-gray-900">
      {/* Sidebar */}
      {!sidebarCollapsed && (
        <div
          className="flex-shrink-0 flex flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
          style={{ width: sidebarWidth }}
        >
          {sidebar}
        </div>
      )}

      {/* Drag handle */}
      {!sidebarCollapsed && (
        <div
          className={`
            flex-shrink-0 w-1 cursor-col-resize group relative
            ${isDragging ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-500'}
            transition-colors
          `}
          onMouseDown={handleMouseDown}
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* Collapse/expand toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="absolute top-3 left-2 z-20 p-1 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm transition-colors"
        style={!sidebarCollapsed ? { left: sidebarWidth - 28 } : undefined}
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen className="w-4 h-4" />
        ) : (
          <PanelLeftClose className="w-4 h-4" />
        )}
      </button>

      {/* Main panel */}
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
      </div>
    </div>
  );
};
