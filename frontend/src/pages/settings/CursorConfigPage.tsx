/**
 * Cursor Configuration Overview Page
 * 
 * Displays configuration information read from ~/.cursor/
 * Only visible when running with cursor-cli engine.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Server,
  FileCode,
  Command,
  Zap,
  Package,
  FolderOpen,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { API_BASE } from '../../lib/config';
import useEngine from '../../hooks/useEngine';
import { NotSupportedMessage } from '../../components/EngineGate';

// API response types
interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
}

interface RuleConfig {
  name: string;
  path: string;
  scope: string;
  frontmatter: {
    description?: string;
    alwaysApply?: boolean;
  };
}

interface CommandConfig {
  name: string;
  path: string;
  scope: string;
}

interface SkillConfig {
  name: string;
  path: string;
  scope: string;
  isBuiltin: boolean;
  frontmatter: {
    name: string;
    description: string;
  };
}

interface CursorConfigResponse {
  mcp: McpServer[];
  rules: RuleConfig[];
  commands: CommandConfig[];
  skills: SkillConfig[];
  plugins: {
    version: number;
    user: string[];
  } | null;
  marketplaces: Record<string, { repo: string; branch: string }> | null;
}

// Fetch cursor config from backend
async function fetchCursorConfig(): Promise<CursorConfigResponse> {
  const response = await fetch(`${API_BASE}/engine/cursor-config`);
  if (!response.ok) {
    throw new Error('Failed to fetch Cursor config');
  }
  return response.json();
}

export const CursorConfigPage: React.FC = () => {
  // TODO: Add i18n support for this page
  const { paths, isCursorEngine } = useEngine();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cursor-config'],
    queryFn: fetchCursorConfig,
    enabled: isCursorEngine,
    staleTime: 30000,
  });

  // If not cursor engine, show not supported message
  if (!isCursorEngine) {
    return (
      <div className="p-6">
        <NotSupportedMessage 
          feature="Cursor 配置"
          description="此页面仅在使用 Cursor CLI 引擎时可用。"
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Cursor 配置概览
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            读取自 {paths?.userConfigDir}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>加载配置失败: {(error as Error).message}</span>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      )}

      {/* Content */}
      {config && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MCP Servers */}
          <ConfigCard
            title="MCP 服务器"
            icon={Server}
            count={config.mcp.length}
            emptyText="未配置 MCP 服务器"
          >
            {config.mcp.map((server) => (
              <div
                key={server.name}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {server.name}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                    {server.url || server.command}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">
                  {server.url ? 'HTTP' : 'stdio'}
                </span>
              </div>
            ))}
          </ConfigCard>

          {/* Rules */}
          <ConfigCard
            title="规则"
            icon={FileCode}
            count={config.rules.length}
            emptyText="未配置规则"
          >
            {config.rules.map((rule) => (
              <div
                key={rule.path}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {rule.name}
                  </span>
                  {rule.frontmatter.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                      {rule.frontmatter.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {rule.frontmatter.alwaysApply && (
                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded">
                      始终应用
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {rule.scope}
                  </span>
                </div>
              </div>
            ))}
          </ConfigCard>

          {/* Commands */}
          <ConfigCard
            title="命令"
            icon={Command}
            count={config.commands.length}
            emptyText="未配置命令"
          >
            {config.commands.map((cmd) => (
              <div
                key={cmd.path}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  /{cmd.name}
                </span>
                <span className="text-xs text-gray-400">
                  {cmd.scope}
                </span>
              </div>
            ))}
          </ConfigCard>

          {/* Skills */}
          <ConfigCard
            title="技能"
            icon={Zap}
            count={config.skills.length}
            emptyText="未配置技能"
          >
            {config.skills.map((skill) => (
              <div
                key={skill.path}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {skill.frontmatter.name || skill.name}
                  </span>
                  {skill.frontmatter.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                      {skill.frontmatter.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {skill.isBuiltin && (
                    <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded">
                      内置
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {skill.scope}
                  </span>
                </div>
              </div>
            ))}
          </ConfigCard>

          {/* Plugins */}
          <ConfigCard
            title="插件"
            icon={Package}
            count={config.plugins?.user?.length || 0}
            emptyText="未安装插件"
          >
            {config.plugins?.user?.map((plugin) => (
              <div
                key={plugin}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {plugin}
                </span>
                <CheckCircle className="w-4 h-4 text-green-500" />
              </div>
            ))}
          </ConfigCard>

          {/* Marketplaces */}
          <ConfigCard
            title="市场源"
            icon={FolderOpen}
            count={config.marketplaces ? Object.keys(config.marketplaces).length : 0}
            emptyText="未配置市场源"
          >
            {config.marketplaces && Object.entries(config.marketplaces).map(([name, market]) => (
              <div
                key={name}
                className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {name}
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {market.repo}
                  </p>
                </div>
                <a
                  href={`https://github.com/${market.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ))}
          </ConfigCard>
        </div>
      )}
    </div>
  );
};

// Helper component for config cards
interface ConfigCardProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  emptyText: string;
  children: React.ReactNode;
}

function ConfigCard({ title, icon: Icon, count, emptyText, children }: ConfigCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="font-medium text-gray-900 dark:text-white">{title}</span>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {count} 项
        </span>
      </div>
      <div className="px-4 py-2 max-h-64 overflow-y-auto">
        {count === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
            {emptyText}
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export default CursorConfigPage;
