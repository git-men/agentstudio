import React, { useState, useEffect, useRef } from 'react';
import {
  Brain,
  Command,
  Bot,
  Shield,
  GitBranch,
  Settings,
  FolderTree,
  LayoutDashboard,
  Server,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { getApiBase } from '../../lib/config';
import { loadBackendServices, getCurrentService } from '../../utils/backendServiceStorage';

export type RightPanelView = 'files' | 'lavs';

interface ProjectToolbarProps {
  projectPath: string;
  rightPanelView: RightPanelView | null;
  hasLAVS: boolean;
  onSetRightPanelView: (view: RightPanelView | null) => void;
  onMemoryManagement: () => void;
  onCommandManagement: () => void;
  onSubAgentManagement: () => void;
  onA2AManagement: () => void;
  onVersionManagement: () => void;
  onSettings: () => void;
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

interface ServiceInfo {
  name: string;
  url: string;
  isConnected: boolean;
  isLoading: boolean;
  version?: string;
  backendName?: string;
}

/**
 * Compact backend info popover shown on click.
 */
const BackendInfoPopover: React.FC<{ info: ServiceInfo; onClose: () => void }> = ({ info, onClose }) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-64 p-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded-lg shadow-lg z-50"
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-sm">{info.name}</span>
          {info.isLoading ? (
            <div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : info.isConnected ? (
            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-400" />
          )}
        </div>

        <div className="text-gray-300 dark:text-gray-600 break-all">{info.url}</div>

        {info.version && (
          <div className="flex justify-between">
            <span>版本:</span>
            <span>v{info.version}</span>
          </div>
        )}

        {info.backendName && (
          <div className="flex justify-between">
            <span>服务端:</span>
            <span>{info.backendName}</span>
          </div>
        )}

        <div className="flex justify-between">
          <span>状态:</span>
          <span className={info.isConnected ? 'text-green-400 dark:text-green-600' : 'text-red-400 dark:text-red-600'}>
            {info.isConnected ? '已连接' : '未连接'}
          </span>
        </div>
      </div>
      <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-100" />
    </div>
  );
};

export const ProjectToolbar: React.FC<ProjectToolbarProps> = ({
  projectPath,
  rightPanelView,
  hasLAVS,
  onSetRightPanelView,
  onMemoryManagement,
  onCommandManagement,
  onSubAgentManagement,
  onA2AManagement,
  onVersionManagement,
  onSettings,
}) => {
  const toggleView = (view: RightPanelView) => {
    onSetRightPanelView(rightPanelView === view ? null : view);
  };

  // ---------- Backend service info ----------
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo>({
    name: '默认服务',
    url: '',
    isConnected: false,
    isLoading: true,
  });
  const [showBackendPopover, setShowBackendPopover] = useState(false);

  useEffect(() => {
    const backendServices = loadBackendServices();
    const currentService = getCurrentService(backendServices);
    const name = currentService?.name || '默认服务';
    const url = currentService?.url || '';

    setServiceInfo((prev) => ({ ...prev, name, url }));

    const checkHealth = async () => {
      try {
        const apiBase = getApiBase();
        const response = await fetch(`${apiBase}/health`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const data = await response.json();
          setServiceInfo({
            name,
            url,
            isConnected: true,
            isLoading: false,
            version: data.version,
            backendName: data.name,
          });
        } else {
          setServiceInfo({ name, url, isConnected: false, isLoading: false });
        }
      } catch {
        setServiceInfo({ name, url, isConnected: false, isLoading: false });
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      {/* Left: backend service indicator */}
      <div className="relative flex items-center gap-1.5 mr-2 pr-3 border-r border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowBackendPopover((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
          title="查看后端详情"
        >
          <Server className="w-3.5 h-3.5" />
          <span className="truncate max-w-[140px]">{serviceInfo.name}</span>
          {serviceInfo.isLoading ? (
            <div className="w-3 h-3 border-[1.5px] border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : serviceInfo.isConnected ? (
            <CheckCircle className="w-3 h-3 text-green-500" />
          ) : (
            <XCircle className="w-3 h-3 text-red-500" />
          )}
        </button>

        {showBackendPopover && (
          <BackendInfoPopover info={serviceInfo} onClose={() => setShowBackendPopover(false)} />
        )}
      </div>

      {/* View toggles */}
      <ToolbarButton
        icon={<FolderTree className="w-3.5 h-3.5" />}
        label="文件"
        onClick={() => toggleView('files')}
        active={rightPanelView === 'files'}
      />

      {hasLAVS && (
        <ToolbarButton
          icon={<LayoutDashboard className="w-3.5 h-3.5" />}
          label="Agent 视图"
          onClick={() => toggleView('lavs')}
          active={rightPanelView === 'lavs'}
        />
      )}

      {/* Spacer pushes management buttons to the right */}
      <div className="flex-1" />

      {/* Project management actions — right side */}
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

      <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />

      <ToolbarButton
        icon={<Settings className="w-3.5 h-3.5" />}
        label="项目设置"
        onClick={onSettings}
      />
    </div>
  );
};
