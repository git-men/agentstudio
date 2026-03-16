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
  Plus,
  Trash2,
  ArrowLeft,
  LinkIcon,
  Unlink,
} from 'lucide-react';
import { showSuccess, showError, showInfo } from '../../utils/toast';
import { useConfirm } from '../../hooks/useConfirm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TunnelConfig {
  id: string;
  label: string;
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
  id: string;
  label: string;
  enabled: boolean;
  connected: boolean;
  domain: string | null;
  lastError: string | null;
  connectedAt: string | null;
  reconnectCount: number;
  serverUrl: string;
  localPort: number;
}

interface TunnelItem {
  config: TunnelConfig;
  status?: TunnelStatus;
}

interface TunnelServerInfo {
  name: string;
  version: string;
  domain: {
    pattern: string;
    customizable: string;
    suffix: string;
  };
  websocket: { url: string };
  protocols: string[];
  instruction?: string;
}

type WizardStep = 'server' | 'domain';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WebSocketTunnelPage: React.FC = () => {
  const confirm = useConfirm();

  const [tunnels, setTunnels] = useState<TunnelItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Wizard state (for adding new tunnel)
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('server');
  const [serverUrl, setServerUrl] = useState('https://agentstudio.woa.com');
  const [tunnelName, setTunnelName] = useState('');
  const [tunnelLabel, setTunnelLabel] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'http'>('https');
  const [autoConnect, setAutoConnect] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [serverInfo, setServerInfo] = useState<TunnelServerInfo | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Batch-action loading
  const [batchConnecting, setBatchConnecting] = useState(false);
  const [batchDisconnecting, setBatchDisconnecting] = useState(false);

  // Per-tunnel connecting
  const [connectingIds, setConnectingIds] = useState<Set<string>>(new Set());

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // JWT helper
  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${localStorage.getItem('jwt')}`,
    }),
    [],
  );

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const loadTunnels = useCallback(async () => {
    try {
      const res = await fetch('/api/tunnel/list', { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to load tunnels');
      const data = await res.json();
      setTunnels(data.tunnels ?? []);
    } catch (err) {
      console.error('Error loading tunnels:', err);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadTunnels();
  }, [loadTunnels]);

  // Poll while any tunnel is connected
  useEffect(() => {
    const hasConnected = tunnels.some((t) => t.status?.connected);
    if (!hasConnected) return;
    const interval = setInterval(loadTunnels, 5000);
    return () => clearInterval(interval);
  }, [tunnels, loadTunnels]);

  // ---------------------------------------------------------------------------
  // Per-tunnel actions
  // ---------------------------------------------------------------------------

  const handleConnect = async (id: string) => {
    setConnectingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/tunnel/${id}/connect`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to connect');
      }
      showInfo('隧道连接中...');
      setTimeout(loadTunnels, 2000);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDisconnect = async (id: string) => {
    setConnectingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/tunnel/${id}/disconnect`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      showSuccess('已断开连接');
      await loadTunnels();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setConnectingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string, label: string) => {
    const confirmed = await confirm({
      title: '确认删除',
      message: `确定要删除隧道「${label}」吗？删除后需要重新配置。`,
      confirmText: '删除',
      cancelText: '取消',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/tunnel/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete');
      showSuccess('隧道已删除');
      await loadTunnels();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete tunnel');
    }
  };

  const handleToggleAutoConnect = async (item: TunnelItem) => {
    const newEnabled = !item.config.enabled;
    try {
      await fetch(`/api/tunnel/${item.config.id}/config`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });
      await loadTunnels();
    } catch (err) {
      showError('切换自动连接失败');
    }
  };

  // ---------------------------------------------------------------------------
  // Batch actions
  // ---------------------------------------------------------------------------

  const handleConnectAll = async () => {
    setBatchConnecting(true);
    try {
      await fetch('/api/tunnel/connect-all', {
        method: 'POST',
        headers: authHeaders(),
      });
      showInfo('正在连接所有隧道...');
      setTimeout(loadTunnels, 2000);
    } catch (err) {
      showError('批量连接失败');
    } finally {
      setBatchConnecting(false);
    }
  };

  const handleDisconnectAll = async () => {
    setBatchDisconnecting(true);
    try {
      await fetch('/api/tunnel/disconnect-all', {
        method: 'POST',
        headers: authHeaders(),
      });
      showSuccess('已断开所有隧道');
      await loadTunnels();
    } catch (err) {
      showError('批量断开失败');
    } finally {
      setBatchDisconnecting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Wizard: add new tunnel
  // ---------------------------------------------------------------------------

  const resetWizard = () => {
    setShowWizard(false);
    setWizardStep('server');
    setServerUrl('https://agentstudio.woa.com');
    setTunnelName('');
    setTunnelLabel('');
    setProtocol('https');
    setAutoConnect(false);
    setAccessToken('');
    setServerInfo(null);
    setCheckResult(null);
  };

  const fetchServerInfoFn = async (url: string) => {
    setFetchingInfo(true);
    try {
      const res = await fetch('/api/tunnel/server-info', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: url }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || '获取服务器信息失败');

      const data = result.data;
      const info: TunnelServerInfo = {
        name: data.name || 'Tunely Server',
        version: data.version || '1.0.0',
        domain: {
          pattern: data.domain?.pattern || '{subdomain}.tunnel',
          customizable: data.domain?.customizable || 'subdomain',
          suffix: data.domain?.suffix || '.tunnel',
        },
        websocket: {
          url: data.websocket?.url || url.replace(/\/+$/, '').replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/tunnel',
        },
        protocols: data.protocols || ['https', 'http'],
        instruction: data.instruction,
      };
      setServerInfo(info);
      showSuccess(`已连接到 ${info.name} v${info.version}`);
      setWizardStep('domain');
    } catch (err) {
      showError(err instanceof Error ? err.message : '获取服务器信息失败');
    } finally {
      setFetchingInfo(false);
    }
  };

  const checkNameAvailability = async () => {
    if (!tunnelName.trim()) {
      setCheckResult({ available: false, reason: '请输入隧道名称' });
      return;
    }
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch(
        `/api/tunnel/check-name?name=${encodeURIComponent(tunnelName.trim())}&serverUrl=${encodeURIComponent(serverUrl)}`,
        { headers: authHeaders() },
      );
      const data = await res.json();
      setCheckResult(data);
    } catch {
      setCheckResult({ available: false, reason: '检查失败，请重试' });
    } finally {
      setChecking(false);
    }
  };

  const handleCreateTunnel = async () => {
    if (!tunnelName.trim()) {
      showError('请输入隧道名称');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/tunnel/create-tunnel', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tunnelName.trim(),
          serverUrl,
          label: tunnelLabel.trim() || tunnelName.trim(),
          autoConnect,
          protocol,
          websocketUrl: serverInfo?.websocket?.url,
          domainSuffix: serverInfo?.domain?.suffix,
          ...(accessToken.trim() && { accessToken: accessToken.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create tunnel');

      showSuccess(`隧道「${tunnelLabel || tunnelName}」创建成功！`);
      resetWizard();
      await loadTunnels();

      // Poll for connection status if auto-connect
      if (autoConnect && data.tunnelId) {
        let pollCount = 0;
        const interval = setInterval(async () => {
          pollCount++;
          await loadTunnels();
          if (pollCount >= 10) clearInterval(interval);
        }, 1000);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to create tunnel');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const getFullDomain = (cfg: TunnelConfig) => {
    if (!cfg.tunnelName) return null;
    const suffix = cfg.domainSuffix || '.agentstudio.woa.com';
    return `${cfg.tunnelName}${suffix}`;
  };

  const copyDomain = (cfg: TunnelConfig) => {
    const fullDomain = getFullDomain(cfg);
    if (fullDomain) {
      navigator.clipboard.writeText(`${cfg.protocol || 'https'}://${fullDomain}`);
      setCopiedId(cfg.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // ---------------------------------------------------------------------------
  // Render: Tunnel Card
  // ---------------------------------------------------------------------------

  const renderTunnelCard = (item: TunnelItem) => {
    const { config: cfg, status: st } = item;
    const connected = st?.connected ?? false;
    const isConnecting = connectingIds.has(cfg.id);
    const fullDomain = getFullDomain(cfg);

    return (
      <div
        key={cfg.id}
        className={`rounded-lg border p-4 transition-colors ${
          connected
            ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
            : 'bg-white border-gray-200 dark:bg-gray-800 dark:border-gray-700'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left: icon + info */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {connected ? (
              <Wifi className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
            ) : (
              <WifiOff className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-gray-900 dark:text-white truncate">
                  {cfg.label}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    connected
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {connected ? '已连接' : '未连接'}
                </span>
                {cfg.enabled && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                    自动连接
                  </span>
                )}
              </div>

              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                {cfg.serverUrl}
              </div>

              {connected && fullDomain && (
                <div className="mt-1.5 flex items-center gap-2 text-sm">
                  <span className="text-gray-600 dark:text-gray-300 truncate">
                    {cfg.protocol || 'https'}://{fullDomain}
                  </span>
                  <button
                    onClick={() => copyDomain(cfg)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                    title="复制"
                  >
                    {copiedId === cfg.id ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <a
                    href={`${cfg.protocol || 'https'}://${fullDomain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
                    title="在新窗口打开"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {st?.lastError && !connected && (
                <div className="mt-1 text-xs text-red-500 truncate">{st.lastError}</div>
              )}

              {connected && st?.connectedAt && (
                <div className="mt-1 text-xs text-gray-400">
                  连接时间: {new Date(st.connectedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Toggle auto-connect */}
            <button
              onClick={() => handleToggleAutoConnect(item)}
              className={`p-1.5 rounded-lg transition-colors ${
                cfg.enabled
                  ? 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                  : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title={cfg.enabled ? '关闭自动连接' : '开启自动连接'}
            >
              <Settings className="w-4 h-4" />
            </button>

            {connected ? (
              <button
                onClick={() => handleDisconnect(cfg.id)}
                disabled={isConnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5" />
                断开
              </button>
            ) : (
              <button
                onClick={() => handleConnect(cfg.id)}
                disabled={isConnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
              >
                {isConnecting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                连接
              </button>
            )}

            <button
              onClick={() => handleDelete(cfg.id, cfg.label)}
              className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Wizard
  // ---------------------------------------------------------------------------

  const renderWizard = () => (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={resetWizard}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      {/* Step 1: Server */}
      {wizardStep === 'server' && (
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
                  onClick={() => fetchServerInfoFn(serverUrl)}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Access Token <span className="font-normal text-gray-400">（可选）</span>
              </label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="由 AgentStudio Enterprise 颁发，内网部署可留空"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                外网部署时隧道服务器启用了 JWT 鉴权，需提供此 Token；内网/未启用鉴权时可留空
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Domain */}
      {wizardStep === 'domain' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings className="w-5 h-5" />
              配置隧道域名
            </h2>
            <button
              onClick={() => { setServerInfo(null); setWizardStep('server'); }}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              更换服务器
            </button>
          </div>

          {serverInfo && (
            <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
              <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
                <CheckCircle2 className="w-4 h-4" />
                <span>已连接到 <strong>{serverInfo.name}</strong> v{serverInfo.version}</span>
              </div>
            </div>
          )}

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
            {/* Label */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                隧道名称 <span className="font-normal text-gray-400">（显示用）</span>
              </label>
              <input
                type="text"
                value={tunnelLabel}
                onChange={(e) => setTunnelLabel(e.target.value)}
                placeholder="如：生产隧道、测试隧道"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Domain name */}
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
                    {(serverInfo?.protocols || ['https', 'http']).map((p) => (
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
                  {checking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  检测
                </button>
              </div>

              {checkResult && (
                <div
                  className={`mt-2 text-sm flex items-center gap-1 ${
                    checkResult.available
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
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

            {/* Auto-connect toggle */}
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

            {/* Create button */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={handleCreateTunnel}
                disabled={saving || !tunnelName.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                创建隧道
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render: Tunnel List
  // ---------------------------------------------------------------------------

  const renderTunnelList = () => {
    const connectedCount = tunnels.filter((t) => t.status?.connected).length;
    const hasAnyTunnel = tunnels.length > 0;

    return (
      <div className="space-y-4">
        {/* Summary + batch actions */}
        {hasAnyTunnel && (
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              共 {tunnels.length} 条隧道
              {connectedCount > 0 && (
                <span className="ml-2 text-green-600 dark:text-green-400">
                  {connectedCount} 已连接
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadTunnels}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                title="刷新"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleConnectAll}
                disabled={batchConnecting || tunnels.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50"
              >
                {batchConnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
                全部连接
              </button>
              <button
                onClick={handleDisconnectAll}
                disabled={batchDisconnecting || connectedCount === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {batchDisconnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
                全部断开
              </button>
            </div>
          </div>
        )}

        {/* Tunnel cards */}
        {hasAnyTunnel ? (
          <div className="space-y-3">
            {tunnels.map(renderTunnelCard)}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium mb-1">还没有配置隧道</p>
            <p className="text-sm">点击下方按钮添加第一条隧道</p>
          </div>
        )}

        {/* Add button */}
        <button
          onClick={() => setShowWizard(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors"
        >
          <Plus className="w-5 h-5" />
          添加隧道
        </button>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Globe className="w-7 h-7" />
          隧道接入
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          通过隧道让外部网络可以访问本地 Agent Studio，支持同时接入多个隧道服务
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

      {/* Content */}
      {showWizard ? renderWizard() : renderTunnelList()}
    </div>
  );
};

export default WebSocketTunnelPage;
