import React, { useState, useRef, useEffect } from 'react';
import { Settings, FolderSync, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentConfig } from '@/types/index.js';

interface ExtensionHeaderProps {
  agent: AgentConfig;
  projectPath: string | null;
  onSwitchProject: () => void;
  onLogout: () => void;
}

export const ExtensionHeader: React.FC<ExtensionHeaderProps> = ({
  agent,
  projectPath,
  onSwitchProject,
  onLogout,
}) => {
  const { t } = useTranslation('components');
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const projectName = projectPath?.split('/').pop() || null;

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shrink-0">
      {/* Agent name + project */}
      <div className="flex items-center gap-1.5 text-sm min-w-0">
      </div>

      {/* Settings menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
        >
          <Settings className="w-4 h-4" />
        </button>

        {showMenu && (
          <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
            <button
              onClick={() => {
                onSwitchProject();
                setShowMenu(false);
              }}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
            >
              <FolderSync className="w-4 h-4" />
              <span>{t('extensionHeader.switchProject', '切换项目')}</span>
            </button>
            <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
            <button
              onClick={() => {
                onLogout();
                setShowMenu(false);
              }}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-red-600 dark:text-red-400"
            >
              <LogOut className="w-4 h-4" />
              <span>{t('extensionHeader.logout', '退出登录')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
