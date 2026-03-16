import React from 'react';
import {
  Brain,
  Command,
  Bot,
  Shield,
  GitBranch,
  Settings,
  FolderTree,
  ExternalLink,
} from 'lucide-react';

interface ProjectToolbarProps {
  projectName: string;
  projectPath: string;
  fileBrowserOpen: boolean;
  onToggleFileBrowser: () => void;
  onMemoryManagement: () => void;
  onCommandManagement: () => void;
  onSubAgentManagement: () => void;
  onA2AManagement: () => void;
  onVersionManagement: () => void;
  onSettings: () => void;
  onOpenInChat?: () => void;
}

const ToolbarButton: React.FC<{
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}> = ({ icon, label, onClick, active }) => (
  <button
    onClick={onClick}
    className={`
      flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
      ${active
        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}
    `}
    title={label}
  >
    {icon}
    <span className="hidden lg:inline">{label}</span>
  </button>
);

export const ProjectToolbar: React.FC<ProjectToolbarProps> = ({
  projectName,
  projectPath,
  fileBrowserOpen,
  onToggleFileBrowser,
  onMemoryManagement,
  onCommandManagement,
  onSubAgentManagement,
  onA2AManagement,
  onVersionManagement,
  onSettings,
  onOpenInChat,
}) => {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      {/* Project indicator */}
      <div className="flex items-center gap-1.5 mr-2 pr-3 border-r border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
          {projectName}
        </span>
        {onOpenInChat && (
          <button
            onClick={onOpenInChat}
            className="text-gray-400 hover:text-blue-500 transition-colors"
            title="在聊天页面打开"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* File browser toggle */}
      <ToolbarButton
        icon={<FolderTree className="w-3.5 h-3.5" />}
        label="文件"
        onClick={onToggleFileBrowser}
        active={fileBrowserOpen}
      />

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

      {/* Project management actions */}
      <ToolbarButton
        icon={<Brain className="w-3.5 h-3.5" />}
        label="记忆"
        onClick={onMemoryManagement}
      />
      <ToolbarButton
        icon={<Command className="w-3.5 h-3.5" />}
        label="命令"
        onClick={onCommandManagement}
      />
      <ToolbarButton
        icon={<Bot className="w-3.5 h-3.5" />}
        label="子Agent"
        onClick={onSubAgentManagement}
      />
      <ToolbarButton
        icon={<Shield className="w-3.5 h-3.5" />}
        label="A2A"
        onClick={onA2AManagement}
      />
      <ToolbarButton
        icon={<GitBranch className="w-3.5 h-3.5" />}
        label="版本"
        onClick={onVersionManagement}
      />

      <div className="flex-1" />

      {/* Settings on far right */}
      <ToolbarButton
        icon={<Settings className="w-3.5 h-3.5" />}
        label="项目设置"
        onClick={onSettings}
      />

      {/* Project path tooltip */}
      <span
        className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[200px] hidden xl:inline"
        title={projectPath}
      >
        {projectPath}
      </span>
    </div>
  );
};
