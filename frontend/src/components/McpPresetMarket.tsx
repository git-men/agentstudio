import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API_BASE } from '../lib/config';
import { authFetch } from '../lib/authFetch';
import { showError, showSuccess } from '../utils/toast';
import {
  Search,
  Download,
  CheckCircle,
  Loader2,
  ExternalLink,
  Shield,
  X,
} from 'lucide-react';

interface PresetEnvVar {
  key: string;
  label: string;
  description: string;
  placeholder?: string;
  isSecret?: boolean;
}

interface PresetMcpServer {
  id: string;
  name: string;
  serverName: string;
  description: string;
  category: string;
  type: 'stdio' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  requiredEnvVars?: PresetEnvVar[];
  documentationUrl?: string;
  official?: boolean;
  installed: boolean;
}

interface PresetCategory {
  id: string;
  label: string;
  labelZh: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  development: '🛠️',
  productivity: '📋',
  database: '🗄️',
  infrastructure: '☁️',
  search: '🔍',
  reference: '📚',
  ai: '🤖',
  internal: '🏢',
};

interface McpPresetMarketProps {
  onInstalled?: () => void;
}

export const McpPresetMarket: React.FC<McpPresetMarketProps> = ({ onInstalled }) => {
  const { t, i18n } = useTranslation('pages');
  const isZh = i18n.language?.startsWith('zh');

  const [presets, setPresets] = useState<PresetMcpServer[]>([]);
  const [categories, setCategories] = useState<PresetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [installingId, setInstallingId] = useState<string | null>(null);

  // Install dialog state
  const [showInstallDialog, setShowInstallDialog] = useState(false);
  const [installTarget, setInstallTarget] = useState<PresetMcpServer | null>(null);
  const [envVarValues, setEnvVarValues] = useState<Record<string, string>>({});

  const loadPresets = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authFetch(`${API_BASE}/mcp/presets`);
      if (response.ok) {
        const data = await response.json();
        setPresets(data.presets || []);
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Failed to load MCP presets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const filteredPresets = useMemo(() => {
    return presets.filter(p => {
      const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
      const matchesSearch = !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.serverName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [presets, selectedCategory, searchQuery]);

  const handleInstallClick = (preset: PresetMcpServer) => {
    if (preset.installed) return;

    if (preset.requiredEnvVars && preset.requiredEnvVars.length > 0) {
      setInstallTarget(preset);
      setEnvVarValues({});
      setShowInstallDialog(true);
    } else {
      doInstall(preset, {});
    }
  };

  const doInstall = async (preset: PresetMcpServer, envValues: Record<string, string>) => {
    setInstallingId(preset.id);
    try {
      let config: Record<string, any>;

      if (preset.type === 'stdio') {
        let args = preset.args ? [...preset.args] : [];
        args = args.map(arg => {
          for (const [key, value] of Object.entries(envValues)) {
            arg = arg.replace(`\${${key}}`, value);
          }
          return arg;
        });

        const env: Record<string, string> = { ...(preset.env || {}) };
        for (const [key, value] of Object.entries(envValues)) {
          if (!args.some(a => a.includes(value))) {
            env[key] = value;
          }
        }

        config = {
          type: 'stdio',
          source: 'local',
          command: preset.command,
          args,
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };
      } else {
        const headers: Record<string, string> = { ...(preset.headers || {}) };
        let url = preset.url || '';

        for (const [key, value] of Object.entries(envValues)) {
          if (key.startsWith('HEADER_')) {
            const headerName = preset.requiredEnvVars?.find(v => v.key === key)?.label || key.replace('HEADER_', '');
            headers[headerName] = value;
          } else if (key.startsWith('URLPARAM_')) {
            const paramName = preset.requiredEnvVars?.find(v => v.key === key)?.label || key.replace('URLPARAM_', '');
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}${paramName}=${encodeURIComponent(value)}`;
          } else {
            url = url.replace(`<${key}>`, value).replace(`<${key.toLowerCase()}>`, value);
          }
        }

        config = {
          type: 'http',
          source: 'local',
          url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      }

      const response = await authFetch(`${API_BASE}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: preset.serverName, ...config }),
      });

      if (response.ok) {
        showSuccess(t('mcp.presets.installSuccess', { name: preset.name, defaultValue: `${preset.name} installed successfully` }));
        setPresets(prev => prev.map(p =>
          p.id === preset.id ? { ...p, installed: true } : p
        ));
        onInstalled?.();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Installation failed');
      }
    } catch (error) {
      console.error('Failed to install preset MCP:', error);
      showError(
        t('mcp.presets.installFailed', { defaultValue: 'Installation failed' }),
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      setInstallingId(null);
      setShowInstallDialog(false);
      setInstallTarget(null);
    }
  };

  const handleInstallSubmit = () => {
    if (!installTarget) return;

    const missing = installTarget.requiredEnvVars?.filter(v => !envVarValues[v.key]?.trim());
    if (missing && missing.length > 0) {
      showError(t('mcp.presets.missingEnvVars', { defaultValue: 'Please fill in all required fields' }));
      return;
    }

    doInstall(installTarget, envVarValues);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-600" />
          <p className="text-gray-500 dark:text-gray-400">
            {t('mcp.presets.loading', { defaultValue: 'Loading recommended MCPs...' })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Search + Category Filter */}
      <div className="mb-6 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder={t('mcp.presets.searchPlaceholder', { defaultValue: 'Search MCP servers...' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-4 py-3 w-full border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {cat.id !== 'all' && (
                <span className="mr-1">{CATEGORY_ICONS[cat.id] || '📦'}</span>
              )}
              {isZh ? cat.labelZh : cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Grid */}
      {filteredPresets.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔌</div>
          <p className="text-gray-500 dark:text-gray-400">
            {t('mcp.presets.noResults', { defaultValue: 'No matching MCP servers found' })}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPresets.map(preset => (
            <div
              key={preset.id}
              className={`bg-white dark:bg-gray-800 rounded-lg border p-5 transition-all hover:shadow-md ${
                preset.installed
                  ? 'border-green-200 dark:border-green-800'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{CATEGORY_ICONS[preset.category] || '📦'}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                      {preset.name}
                      {preset.official && (
                        <Shield className="w-3.5 h-3.5 text-blue-500" title="Official" />
                      )}
                    </h3>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      preset.type === 'http'
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                    }`}>
                      {preset.type.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">
                {preset.description}
              </p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                {preset.documentationUrl && (
                  <a
                    href={preset.documentationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Docs
                  </a>
                )}
                <div className="ml-auto">
                  {preset.installed ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 rounded-md">
                      <CheckCircle className="w-3.5 h-3.5" />
                      {t('mcp.presets.installed', { defaultValue: 'Installed' })}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleInstallClick(preset)}
                      disabled={installingId === preset.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {installingId === preset.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      {t('mcp.presets.install', { defaultValue: 'Install' })}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Install Dialog */}
      {showInstallDialog && installTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('mcp.presets.configureTitle', { name: installTarget.name, defaultValue: `Configure ${installTarget.name}` })}
                </h3>
                <button
                  onClick={() => { setShowInstallDialog(false); setInstallTarget(null); }}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t('mcp.presets.configureDescription', { defaultValue: 'Please fill in the required configuration to install this MCP server.' })}
              </p>

              <div className="space-y-4">
                {installTarget.requiredEnvVars?.map(envVar => (
                  <div key={envVar.key}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {envVar.label}
                    </label>
                    <input
                      type={envVar.isSecret ? 'password' : 'text'}
                      value={envVarValues[envVar.key] || ''}
                      onChange={(e) => setEnvVarValues(prev => ({ ...prev, [envVar.key]: e.target.value }))}
                      placeholder={envVar.placeholder || envVar.description}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white text-sm"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{envVar.description}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => { setShowInstallDialog(false); setInstallTarget(null); }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  {t('common:actions.cancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  onClick={handleInstallSubmit}
                  disabled={installingId !== null}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {installingId ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {t('mcp.presets.install', { defaultValue: 'Install' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
