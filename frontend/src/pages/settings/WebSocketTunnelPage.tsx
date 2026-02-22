import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Wifi,
  WifiOff,
  Play,
  Square,
  Settings,
  Info,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { showSuccess, showError, showInfo } from '../../utils/toast';
import { useConfirm } from '../../hooks/useConfirm';

// Tunely (WebSocket) tunnel types
interface TunnelConfig {
  enabled: boolean;
  serverUrl: string;
  token: string;
  tunnelName?: string;
  domainSuffix?: string;
  protocol?: 'https' | 'http';
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface TunnelStatus {
  enabled: boolean;
  connected: boolean;
  domain: string | null;
  lastError: string | null;
  connectedAt: string | null;
  reconnectCount: number;
  configSource: 'port-specific' | 'default' | 'none';
  localPort: number;
}

// Tunnel server info (from /api/info)
interface TunnelServerInfo {
  name: string;
  version: string;
  domain: {
    pattern: string;      // e.g., "{subdomain}.agentstudio.woa.com"
    customizable: string; // e.g., "subdomain"
    suffix: string;       // e.g., ".agentstudio.woa.com"
  };
  websocket: {
    url: string;          // e.g., "wss://agentstudio.woa.com/ws/tunnel"
  };
  protocols: string[];    // e.g., ["https", "http"]
  instruction?: string;   // Optional instruction message from server
}

type TunelyConfigStep = 'server' | 'domain' | 'connected' | 'edit';

export const WebSocketTunnelPage: React.FC = () => {
  const confirm = useConfirm();

  // Tunely state
  const [config, setConfig] = useState<TunnelConfig | null>(null);
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [serverUrl, setServerUrl] = useState('https://agentstudio.woa.com');
  const [tunnelName, setTunnelName] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'http'>('https');
  const [autoConnect, setAutoConnect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason?: string } | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  // HTTP proxy URL copy state (for the proxy URL shown in Tunely connected step)
  const [copiedProxyUrl, setCopiedProxyUrl] = useState(false);

  // Tunely server info state
  const [tunelyStep, setTunelyStep] = useState<TunelyConfigStep>('server');
  const [serverInfo, setServerInfo] = useState<TunnelServerInfo | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);

  // Load config and status on mount
  useEffect(() => {
    loadConfig();
    loadStatus();
  }, []);

  // Poll status while connected
  useEffect(() => {
    if (!status?.connected) return;

    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [status?.connected]);

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/tunnel/config', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        }
      });

      if (!response.ok) throw new Error('Failed to load configuration');

      const data = await response.json();
      setConfig(data);
      setServerUrl(data.serverUrl || 'https://agentstudio.woa.com');
      setTunnelName(data.tunnelName || '');
      setProtocol(data.protocol || 'https');
      setAutoConnect(data.enabled || false);

      // Determine step based on config
      if (data.token && data.tunnelName) {
        setTunelyStep('connected');
        // Fetch server info if we have a serverUrl (without showing feedback)
        if (data.serverUrl) {
          fetchServerInfo(data.serverUrl, false);
        }
      } else {
        setTunelyStep('server');
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
  };

  // Fetch tunnel server info via backend proxy (to avoid CORS issues)
  const fetchServerInfo = async (url: string, showFeedback = true) => {
    setFetchingInfo(true);

    try {
      // Call backend proxy to fetch server info
      const response = await fetch('/api/tunnel/server-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        },
        body: JSON.stringify({ serverUrl: url })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `服务器返回错误: HTTP ${response.status}`);
      }

      const data = result.data;

      // Map API response to our interface
      const serverInfo: TunnelServerInfo = {
        name: data.name || 'Tunely Server',
        version: data.version || '1.0.0',
        domain: {
          pattern: data.domain?.pattern || '{subdomain}.tunnel',
          customizable: data.domain?.customizable || 'subdomain',
          suffix: data.domain?.suffix || '.tunnel'
        },
        websocket: {
          url: data.websocket?.url || url.replace(/\/+$/, '').replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/tunnel'
        },
        protocols: data.protocols || ['https', 'http'],
        instruction: data.instruction // Save instruction if present
      };

      setServerInfo(serverInfo);
      if (showFeedback) {
        showSuccess(`已连接到 ${serverInfo.name} v${serverInfo.version}`);
        setTunelyStep('domain');
      }
    } catch (err) {
      console.error('Error fetching server info:', err);
      // Only show error if showFeedback is true (user-initiated action)
      if (showFeedback) {
        showError(err instanceof Error ? err.message : '获取服务器信息失败');
      }
    } finally {
      setFetchingInfo(false);
    }
  };

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/tunnel/status', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        }
      });

      if (!response.ok) throw new Error('Failed to load status');

      const data = await response.json();
      setStatus(data);
    } catch (err) {
      console.error('Error loading status:', err);
    }
  }, []);

  const checkNameAvailability = async () => {
    if (!tunnelName.trim()) {
      setCheckResult({ available: false, reason: '请输入隧道名称' });
      return;
    }

    setChecking(true);
    setCheckResult(null);

    try {
      const response = await fetch(`/api/tunnel/check-name?name=${encodeURIComponent(tunnelName.trim())}&serverUrl=${encodeURIComponent(serverUrl)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        }
      });

      const data = await response.json();
      setCheckResult(data);
    } catch (err) {
      setCheckResult({ available: false, reason: '检查失败，请重试' });
    } finally {
      setChecking(false);
    }
  };

  const saveConfig = async () => {
    if (!tunnelName.trim()) {
      showError('请输入隧道名称');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch('/api/tunnel/create-tunnel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        },
        body: JSON.stringify({
          name: tunnelName.trim(),
          serverUrl,
          autoConnect,
          protocol,
          websocketUrl: serverInfo?.websocket?.url,
          domainSuffix: serverInfo?.domain?.suffix,
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create tunnel');
      }

      setConfig(data.config);
      setStatus(data.status);
      setCheckResult(null);

      // Switch to connected step
      setTunelyStep('connected');

      // Show success message
      showSuccess(`隧道 "${tunnelName}" 创建成功！域名: ${data.domain}`);

      // Auto-connect after tunnel is created
      if (autoConnect) {
        showInfo('正在连接隧道...');
        // Backend will auto-connect if autoConnect is true
        // Poll status to show real-time connection state
        let pollCount = 0;
        const maxPollCount = 15; // Poll for max 15 seconds
        const pollInterval = setInterval(async () => {
          pollCount++;
          await loadStatus();

          // Check current status from state (will be updated by loadStatus)
          const response = await fetch('/api/tunnel/status', {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('jwt')}`
            }
          });
          const currentStatus = await response.json();

          if (currentStatus?.connected) {
            showSuccess('隧道已连接！');
            clearInterval(pollInterval);
          } else if (pollCount >= maxPollCount) {
            clearInterval(pollInterval);
          }
        }, 1000); // Poll every second
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create tunnel');
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);

    try {
      const response = await fetch('/api/tunnel/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to connect');
      }

      const data = await response.json();
      setStatus(data.status);
      showInfo('隧道连接中...');

      // Wait a moment and refresh status
      setTimeout(loadStatus, 2000);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);

    try {
      const response = await fetch('/api/tunnel/disconnect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jwt')}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to disconnect');
      }

      const data = await response.json();
      setStatus(data.status);
      showSuccess('已断开隧道连接');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setConnecting(false);
    }
  };

  // Get full domain with suffix
  const getFullDomain = () => {
    if (!config?.tunnelName) return null;
    const suffix = config.domainSuffix || serverInfo?.domain?.suffix || '.agentstudio.woa.com';
    return `${config.tunnelName}${suffix}`;
  };

  // Get HTTP proxy URL (for web access via path-prefix)
  const getHttpProxyUrl = () => {
    if (!config?.tunnelName || !config?.serverUrl) return null;
    const baseUrl = config.serverUrl.replace(/\/+$/, '');
    return `${baseUrl}/t/${config.tunnelName}/`;
  };

  const copyDomain = () => {
    const fullDomain = getFullDomain();
    if (fullDomain) {
      navigator.clipboard.writeText(`${config?.protocol || 'https'}://${fullDomain}`);
      setCopiedDomain(true);
      setTimeout(() => setCopiedDomain(false), 2000);
    }
  };

  const copyProxyUrl = () => {
    const proxyUrl = getHttpProxyUrl();
    if (proxyUrl) {
      navigator.clipboard.writeText(proxyUrl);
      setCopiedProxyUrl(true);
      setTimeout(() => setCopiedProxyUrl(false), 2000);
    }
  };

  // Tunely content renderer
  const renderTunelyContent = () => {
    // Step 1: Server URL configuration
    const renderServerStep = () => (
      <>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <Settings className="w-5 h-5" />
            配置隧道服务
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                隧道服务器地址
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://agentstudio.woa.com"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  onClick={() => fetchServerInfo(serverUrl)}
                  disabled={fetchingInfo || !serverUrl.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  {fetchingInfo ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  连接
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                输入隧道服务的地址，点击"连接"获取服务信息
              </p>
            </div>
          </div>
        </div>
      </>
    );

    // Step 2: Domain configuration (after server info is fetched)
    const renderDomainStep = () => (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Settings className="w-5 h-5" />
            配置隧道域名
          </h2>
          <button
            onClick={() => {
              setServerInfo(null);
              setTunelyStep('server');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            更换服务器
          </button>
        </div>

        {/* Server Info Banner */}
        {serverInfo && (
          <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
            <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
              <CheckCircle2 className="w-4 h-4" />
              <span>已连接到 <strong>{serverInfo.name}</strong> v{serverInfo.version}</span>
            </div>
          </div>
        )}

        {/* Server Instruction (if provided) */}
        {serverInfo?.instruction && (
          <div className="mb-4 p-4 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <p className="font-medium mb-1">服务器说明</p>
                <p className="whitespace-pre-wrap">{serverInfo.instruction}</p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Domain Name Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              隧道域名
            </label>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center">
                <select
                  value={protocol}
                  onChange={(e) => setProtocol(e.target.value as 'https' | 'http')}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-lg text-gray-700 dark:text-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                >
                  {(serverInfo?.protocols || ['https', 'http']).map(p => (
                    <option key={p} value={p}>{p}://</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={tunnelName}
                  onChange={(e) => {
                    setTunnelName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                    setCheckResult(null);
                  }}
                  placeholder="my-agent"
                  className="flex-1 px-3 py-2 border-y border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <span className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-lg text-gray-500 dark:text-gray-400 text-sm whitespace-nowrap">
                  {serverInfo?.domain.suffix || '.agentstudio.woa.com'}
                </span>
              </div>
              <button
                onClick={checkNameAvailability}
                disabled={checking || !tunnelName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 transition-colors"
              >
                {checking ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                检测
              </button>
            </div>

            {/* Check result */}
            {checkResult && (
              <div className={`mt-2 text-sm flex items-center gap-1 ${checkResult.available
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
                }`}>
                {checkResult.available ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>名称可用！完整域名: {protocol}://{tunnelName}{serverInfo?.domain.suffix}</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>{checkResult.reason || '名称不可用'}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Auto Connect */}
          <div className="flex items-center justify-between py-3">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                启动时自动连接
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Agent Studio 启动时自动建立隧道连接
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoConnect}
                onChange={(e) => setAutoConnect(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Create Button */}
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={saveConfig}
              disabled={saving || !tunnelName.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              创建隧道
            </button>
          </div>
        </div>
      </div>
    );

    // Delete tunnel handler
    const handleDeleteTunnel = async () => {
      const confirmed = await confirm({
        title: '确认删除',
        message: '确定要删除隧道配置吗？删除后需要重新配置隧道。',
        confirmText: '删除',
        cancelText: '取消',
        variant: 'danger'
      });
      if (!confirmed) {
        return;
      }

      setSaving(true);
      try {
        const response = await fetch('/api/tunnel/config', {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('jwt')}`
          }
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to delete tunnel');
        }

        const data = await response.json();
        setConfig(data.config);
        setStatus(data.status);
        setTunnelName('');
        setServerInfo(null);
        setTunelyStep('server');
        showSuccess('隧道配置已删除');
      } catch (err) {
        showError(err instanceof Error ? err.message : 'Failed to delete tunnel');
      } finally {
        setSaving(false);
      }
    };

    // Connected state: show status and controls
    const renderConnectedStep = () => (
      <>
        {/* Status Card */}
        <div className={`rounded-lg border p-4 ${status?.connected
          ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
          : 'bg-gray-50 border-gray-200 dark:bg-gray-800/50 dark:border-gray-700'
          }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              {/* Status Icon */}
              {status?.connected ? (
                <Wifi className="w-6 h-6 text-green-500 flex-shrink-0" />
              ) : (
                <WifiOff className="w-6 h-6 text-gray-400 flex-shrink-0" />
              )}

              {/* Status Info - Horizontal Layout */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="font-medium text-gray-900 dark:text-white">
                  {status?.connected ? '已连接' : '未连接'}
                </div>

                {status?.connected && getFullDomain() && (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        {config?.protocol || 'https'}://{getFullDomain()}
                      </span>
                      <button
                        onClick={copyDomain}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        title="复制"
                      >
                        {copiedDomain ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      <a
                        href={`${config?.protocol || 'https'}://${getFullDomain()}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        title="在新窗口打开"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>

                    {status.connectedAt && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        连接时间: {new Date(status.connectedAt).toLocaleString()}
                      </div>
                    )}
                  </>
                )}

                {status?.lastError && (
                  <div className="text-sm text-red-500">
                    {status.lastError}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={loadStatus}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                title="刷新状态"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              {status?.connected ? (
                <button
                  onClick={handleDisconnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-50"
                >
                  <Square className="w-4 h-4" />
                  断开
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  {connecting ? '连接中...' : '连接'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Current Config Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              隧道配置
            </h2>
            <button
              onClick={() => {
                setTunelyStep('edit');
              }}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              编辑配置
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">隧道名称</span>
              <p className="font-medium text-gray-900 dark:text-white">{config?.tunnelName}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">协议</span>
              <p className="font-medium text-gray-900 dark:text-white">{config?.protocol?.toUpperCase()}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">服务器</span>
              <p className="font-medium text-gray-900 dark:text-white">{config?.serverUrl}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">自动连接</span>
              <p className="font-medium text-gray-900 dark:text-white">{config?.enabled ? '是' : '否'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500 dark:text-gray-400">本地转发目标</span>
              <p className="font-mono font-medium text-gray-900 dark:text-white">http://localhost:{status?.localPort || 4936}</p>
            </div>
          </div>

          {/* Server Instruction (if available) */}
          {serverInfo?.instruction && (
            <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">服务器说明</p>
                  <p className="whitespace-pre-wrap">{serverInfo.instruction}</p>
                </div>
              </div>
            </div>
          )}

          {/* Delete Tunnel Button */}
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleDeleteTunnel}
              disabled={saving}
              className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
            >
              删除隧道配置
            </button>
          </div>
        </div>
      </>
    );

    // Edit configuration step
    const renderEditStep = () => {
      const handleSaveConfig = async () => {
        setSaving(true);
        try {
          const response = await fetch('/api/tunnel/config', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('jwt')}`
            },
            body: JSON.stringify({
              enabled: autoConnect,
              serverUrl,
              protocol,
            })
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to save config');
          }

          const data = await response.json();
          setConfig(data.config);
          showSuccess('配置已保存');
          setTunelyStep('connected');
        } catch (err) {
          showError(err instanceof Error ? err.message : 'Failed to save config');
        } finally {
          setSaving(false);
        }
      };

      return (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              编辑隧道配置
            </h2>
            <button
              onClick={() => setTunelyStep('connected')}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              取消
            </button>
          </div>

          <div className="space-y-4">
            {/* Tunnel Name (Read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                隧道名称 <span className="text-gray-400">(不可修改)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={config?.tunnelName || ''}
                  disabled
                  className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
                <span className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 text-sm">
                  {config?.domainSuffix || serverInfo?.domain?.suffix || '.agentstudio.woa.com'}
                </span>
              </div>
            </div>

            {/* Server URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                服务器地址
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="https://agentstudio.woa.com"
              />
            </div>

            {/* Protocol */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                访问协议
              </label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as 'https' | 'http')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="https">HTTPS</option>
                <option value="http">HTTP</option>
              </select>
            </div>

            {/* Auto-connect */}
            <div className="flex items-center justify-between py-2">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  自动连接
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  启动时自动连接隧道
                </p>
              </div>
              <button
                onClick={() => setAutoConnect(!autoConnect)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoConnect ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoConnect ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>

            {/* Save Button */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setTunelyStep('connected')}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                取消
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  '保存配置'
                )}
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-6">
        {/* Step-based content */}
        {tunelyStep === 'server' && renderServerStep()}
        {tunelyStep === 'domain' && renderDomainStep()}
        {tunelyStep === 'connected' && renderConnectedStep()}
        {tunelyStep === 'edit' && renderEditStep()}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Globe className="w-7 h-7" />
          隧道接入
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          通过隧道让外部网络可以访问本地 Agent Studio
        </p>
      </div>

      {/* Security Warning */}
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium mb-1">安全提示</p>
            <p>隧道接入会将本地 Agent Studio 服务暴露到公网，存在一定的安全风险。请确保您了解相关风险后再进行配置。</p>
          </div>
        </div>
      </div>

      {renderTunelyContent()}
    </div>
  );
};

export default WebSocketTunnelPage;
