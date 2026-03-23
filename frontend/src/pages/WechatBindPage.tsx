import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  ChevronDown,
  Folder,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Wifi,
  Smartphone,
  QrCode,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useProjects } from '../hooks/useProjects';
import { useEnterpriseProfile } from '../hooks/useEnterpriseProfile';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { DashboardShell } from '../components/DashboardShell';

type WizardStep = 'form' | 'auth' | 'registering' | 'qr-scan' | 'qr-confirming' | 'starting' | 'result';

interface BindResult {
  bot_key: string;
  bot_name: string;
  project_name: string;
  a2a_endpoint: string;
}

interface PreflightData {
  auth: { ready: boolean; name?: string; email?: string };
  tunnel: { connected: boolean; domain: string | null };
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div>
      <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg font-mono text-sm text-gray-800 dark:text-gray-200 break-all select-all">
          {value}
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="复制"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>
    </div>
  );
}

export const WechatBindPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: projectsData, isLoading: isLoadingProjects } = useProjects();
  const projects = projectsData?.projects || [];
  const { isAuthenticated: isEnterpriseAuth, startLogin: enterpriseLogin } = useEnterpriseProfile();

  const [step, setStep] = useState<WizardStep>('form');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [bindResult, setBindResult] = useState<BindResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [authPolling, setAuthPolling] = useState(false);

  // QR code state
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [qrStatus, setQrStatus] = useState<string>('');
  const [botKey, setBotKey] = useState('');
  const qrPollingRef = useRef(false);

  const canSubmit = !!selectedProject;
  const selectedProjectObj = projects.find((p) => p.path === selectedProject);

  useEffect(() => {
    checkPreflight();
  }, []);

  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].path);
    }
  }, [projects, selectedProject]);

  // Cleanup QR polling on unmount
  useEffect(() => {
    return () => {
      qrPollingRef.current = false;
    };
  }, []);

  const checkPreflight = useCallback(async () => {
    try {
      const resp = await authFetch(`${API_BASE}/wechat/preflight`);
      const data = await resp.json();
      setPreflight(data);
      return data as PreflightData;
    } catch {
      return null;
    }
  }, []);

  const startAuth = async () => {
    try {
      const resp = await authFetch(`${API_BASE}/enterprise/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (data.auth_url) {
        window.open(data.auth_url, '_blank', 'noopener,noreferrer');
        setStep('auth');
        setAuthPolling(true);
        pollAuthStatus();
      }
    } catch {
      setErrorMessage('无法发起 OAuth 登录');
    }
  };

  const pollAuthStatus = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 60;
    const poll = async () => {
      if (attempts >= maxAttempts) {
        setAuthPolling(false);
        setErrorMessage('OAuth 登录超时，请重试');
        return;
      }
      attempts++;
      const result = await checkPreflight();
      if (result?.auth?.ready) {
        setAuthPolling(false);
        setPreflight(result);
        setStep('form');
        return;
      }
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 2000);
  }, [checkPreflight]);

  const pollQrStatus = useCallback(async (bk: string) => {
    qrPollingRef.current = true;
    let attempts = 0;
    const maxAttempts = 150; // ~5 min at 2s intervals

    const poll = async () => {
      if (!qrPollingRef.current || attempts >= maxAttempts) {
        if (attempts >= maxAttempts) {
          setErrorMessage('二维码已超时，请重新获取');
          setStep('form');
        }
        return;
      }
      attempts++;

      try {
        const resp = await authFetch(`${API_BASE}/wechat/qr-status?bot_key=${encodeURIComponent(bk)}`);
        const data = await resp.json();

        if (data.status === 'expired') {
          qrPollingRef.current = false;
          setErrorMessage('二维码已过期，请重新获取');
          setStep('form');
          return;
        }

        if (data.status === 'scaned') {
          setQrStatus('scaned');
          setStep('qr-confirming');
        }

        if (data.status === 'confirmed' && data.success) {
          qrPollingRef.current = false;
          setQrStatus('confirmed');
          // Auto-start the bot
          await startBot(bk);
          return;
        }

        if (data.success === false && data.error) {
          qrPollingRef.current = false;
          setErrorMessage(data.error);
          setStep('form');
          return;
        }

        setTimeout(poll, 2000);
      } catch {
        setTimeout(poll, 3000);
      }
    };

    setTimeout(poll, 1500);
  }, []);

  const startBot = async (bk: string) => {
    setStep('starting');

    try {
      const resp = await authFetch(`${API_BASE}/wechat/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_key: bk }),
      });
      const data = await resp.json();

      if (data.success === false) {
        setErrorMessage(data.error || '启动失败');
        setStep('form');
        return;
      }

      setBindResult((prev) => prev ? { ...prev } : null);
      setStep('result');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStep('form');
    }
  };

  const handleBind = async () => {
    if (!canSubmit) return;

    const pf = await checkPreflight();
    if (!pf?.auth?.ready) {
      startAuth();
      return;
    }

    setStep('registering');
    setErrorMessage('');

    try {
      // Step 1: Register bot
      const bindResp = await authFetch(`${API_BASE}/wechat/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: selectedProject }),
      });
      const bindData = await bindResp.json();

      if (!bindResp.ok || !bindData.success) {
        if (bindData.error === 'enterprise_auth_required') {
          startAuth();
          return;
        }
        throw new Error(bindData.error || bindData.message || `HTTP ${bindResp.status}`);
      }

      const bk = bindData.bot_key;
      setBotKey(bk);
      setBindResult({
        bot_key: bk,
        bot_name: bindData.bot_name,
        project_name: bindData.project_name,
        a2a_endpoint: bindData.a2a_endpoint,
      });

      // Step 2: Get QR code
      const qrResp = await authFetch(`${API_BASE}/wechat/qr-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_key: bk }),
      });
      const qrData = await qrResp.json();

      if (!qrResp.ok || !qrData.success) {
        throw new Error(qrData.error || 'QR 码获取失败');
      }

      setQrCodeUrl(qrData.qrcode_url);
      setQrStatus('wait');
      setStep('qr-scan');

      // Step 3: Start polling QR status
      pollQrStatus(bk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStep('form');
    }
  };

  const handleRefreshQr = async () => {
    if (!botKey) return;
    qrPollingRef.current = false;
    setQrStatus('');
    setErrorMessage('');

    try {
      const qrResp = await authFetch(`${API_BASE}/wechat/qr-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_key: botKey }),
      });
      const qrData = await qrResp.json();

      if (!qrResp.ok || !qrData.success) {
        throw new Error(qrData.error || 'QR 码刷新失败');
      }

      setQrCodeUrl(qrData.qrcode_url);
      setQrStatus('wait');
      setStep('qr-scan');
      pollQrStatus(botKey);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReset = () => {
    qrPollingRef.current = false;
    setStep('form');
    setSelectedProject(projects.length > 0 ? projects[0].path : '');
    setBindResult(null);
    setErrorMessage('');
    setQrCodeUrl('');
    setQrStatus('');
    setBotKey('');
  };

  return (
    <DashboardShell environmentContext="用户当前所在页面：微信绑定向导">
      <div className="flex-1 flex flex-col items-center px-6 py-8">
        {/* Header */}
        <div className="w-full max-w-xl mb-8">
          <button
            onClick={() => { qrPollingRef.current = false; navigate('/dashboard'); }}
            className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl">
              <Smartphone className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              微信绑定
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 ml-[52px]">
            将 AgentStudio 项目连接到微信个人号，让 AI Agent 在微信中回复消息
          </p>
        </div>

        {/* Auth step */}
        {step === 'auth' && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div className="inline-flex p-4 bg-blue-50 dark:bg-blue-900/30 rounded-2xl mb-4">
                <ShieldCheck className="w-10 h-10 text-blue-500" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                等待登录确认
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                已在新窗口打开 iOA 登录页面。
                <br />
                完成授权后，此页面会自动继续。
              </p>
              {authPolling && (
                <div className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在等待登录...
                </div>
              )}
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  onClick={startAuth}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  重新打开登录页
                </button>
                <button
                  onClick={() => setStep('form')}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  返回
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form step */}
        {step === 'form' && (
          <div className="w-full max-w-xl">
            {/* Error banner */}
            {errorMessage && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
                  <button onClick={() => setErrorMessage('')} className="mt-1 text-xs text-red-500 hover:text-red-700">
                    关闭
                  </button>
                </div>
              </div>
            )}

            {/* Auth status banner */}
            {preflight && !preflight.auth.ready && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    需要先登录 AS Enterprise
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-300 mt-1">
                    绑定前需要认证身份。点击下方按钮开始登录。
                  </p>
                  <button
                    onClick={startAuth}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 dark:bg-amber-800/50 dark:hover:bg-amber-700/50 dark:text-amber-200 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    登录 AS Enterprise
                  </button>
                </div>
              </div>
            )}

            {/* Tunnel + dispatch status */}
            {preflight && preflight.auth.ready && !preflight.tunnel.connected && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">隧道未连接</p>
                  <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                    请先在设置中配置并连接隧道，确保外部能访问本地 Agent。
                  </p>
                </div>
              </div>
            )}

            {preflight && preflight.auth.ready && preflight.tunnel.connected && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-xl">
                <Wifi className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">就绪</p>
                  <p className="text-xs text-green-600 dark:text-green-300 mt-1 font-mono">
                    {preflight.tunnel.domain}.tunnel — {preflight.auth.name || 'Enterprise'}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Step 1: Project */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    1
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    选择要绑定的项目
                  </span>
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowProjectDropdown(!showProjectDropdown)}
                    disabled={isLoadingProjects}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <Folder className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {isLoadingProjects ? '加载中...' : selectedProjectObj?.name || '选择项目'}
                      </span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>

                  {showProjectDropdown && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowProjectDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-20 max-h-48 overflow-y-auto">
                        {projects.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => { setSelectedProject(project.path); setShowProjectDropdown(false); }}
                            className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2.5 first:rounded-t-xl last:rounded-b-xl transition-colors ${selectedProject === project.path ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}
                          >
                            <Folder className={`w-4 h-4 shrink-0 ${selectedProject === project.path ? 'text-emerald-500' : 'text-gray-400'}`} />
                            <div className="min-w-0">
                              <div className={`text-sm truncate ${selectedProject === project.path ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                                {project.name}
                              </div>
                              <div className="text-xs text-gray-400 truncate">{project.path}</div>
                            </div>
                          </button>
                        ))}
                        {projects.length === 0 && (
                          <div className="px-4 py-6 text-center text-sm text-gray-400">暂无项目</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    2
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    微信扫码登录
                  </span>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                  点击下方按钮后，系统将生成一个二维码。请使用你要作为 Bot 的微信号扫描该二维码完成登录。
                  登录成功后，Agent 将自动开始接收和回复该微信号的私聊消息。
                </p>
              </div>

              {/* Submit */}
              <div className="p-6">
                <button
                  onClick={handleBind}
                  disabled={!canSubmit}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
                >
                  <QrCode className="w-4 h-4" />
                  获取登录二维码
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Registering step */}
        {step === 'registering' && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
              <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                正在注册 Bot...
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                创建 A2A 端点并注册微信 Bot，请稍候
              </p>
            </div>
          </div>
        )}

        {/* QR Scan step */}
        {(step === 'qr-scan' || step === 'qr-confirming') && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="p-8 flex flex-col items-center">
                <div className="inline-flex p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-2xl mb-5">
                  {step === 'qr-confirming' ? (
                    <Smartphone className="w-8 h-8 text-emerald-500" />
                  ) : (
                    <QrCode className="w-8 h-8 text-emerald-500" />
                  )}
                </div>

                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {step === 'qr-confirming' ? '请在手机上确认登录' : '请用微信扫描二维码'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center">
                  {step === 'qr-confirming'
                    ? '已检测到扫描，请在手机微信上点击确认登录'
                    : '打开微信 → 扫一扫 → 扫描下方二维码'}
                </p>

                {/* QR Code */}
                <div className="relative mb-6">
                  <div className={`p-4 bg-white rounded-2xl border-2 transition-colors ${step === 'qr-confirming' ? 'border-emerald-300' : 'border-gray-200'}`}>
                    {qrCodeUrl ? (
                      <QRCodeSVG
                        value={qrCodeUrl}
                        size={208}
                        level="M"
                        includeMargin={false}
                      />
                    ) : (
                      <div className="w-52 h-52 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-gray-300 animate-spin" />
                      </div>
                    )}
                  </div>
                  {step === 'qr-confirming' && (
                    <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>

                {/* Status indicator */}
                <div className="flex items-center gap-2 text-sm">
                  {step === 'qr-confirming' ? (
                    <>
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                        已扫描，等待确认...
                      </span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                      <span className="text-gray-500 dark:text-gray-400">
                        等待扫码...
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <button
                  onClick={() => { qrPollingRef.current = false; setStep('form'); setErrorMessage(''); }}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  取消
                </button>
                <button
                  onClick={handleRefreshQr}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  刷新二维码
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Starting step */}
        {step === 'starting' && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
              <Loader2 className="w-10 h-10 text-emerald-500 animate-spin mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                正在启动 Bot...
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                微信登录成功，正在启动消息接收服务
              </p>
            </div>
          </div>
        )}

        {/* Result step */}
        {step === 'result' && bindResult && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-6 py-5 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                    <Wifi className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                      微信 Bot 已上线！
                    </h2>
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                      {bindResult.project_name} 已绑定到微信
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    消息接收状态：<span className="text-green-600 dark:text-green-400 ml-1">运行中</span>
                  </span>
                </div>
                <div className="space-y-3">
                  <CopyField label="Bot Key" value={bindResult.bot_key} />
                  <CopyField label="A2A 端点" value={bindResult.a2a_endpoint} />
                </div>
              </div>

              <div className="p-6">
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 rounded-xl">
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                    <strong>测试方式：</strong>
                    使用任意微信号向绑定的微信 Bot 发送一条私聊消息，即可测试 AI Agent 是否正常回复。
                    <br />
                    <strong>注意：</strong>当前仅支持私聊消息，暂不支持群聊。
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
                  <ArrowLeft className="w-4 h-4" /> 返回首页
                </button>
                <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 rounded-lg transition-colors">
                  <RefreshCw className="w-4 h-4" /> 再绑定一个
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
};

export default WechatBindPage;
