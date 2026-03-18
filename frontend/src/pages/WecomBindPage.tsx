import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  ChevronDown,
  Folder,
  ExternalLink,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';
import { showSuccess, showError } from '../utils/toast';

type WizardStep = 'form' | 'auth' | 'processing' | 'result';

interface BindResult {
  callback_url: string;
  token: string;
  encoding_aes_key: string;
  bot_key: string;
  project_name: string;
  a2a_endpoint: string;
  access_mode: string;
}

interface PreflightData {
  auth: { ready: boolean };
  tunnel: {
    configured: boolean;
    connected: boolean;
    domain: string | null;
    server_url: string;
    has_token?: boolean;
    can_auto_provision?: boolean;
  };
}

interface ProcessingStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

const WEBHOOK_PATTERN = /https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-f0-9-]+/i;

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

export const WecomBindPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: projectsData, isLoading: isLoadingProjects } = useProjects();
  const projects = projectsData?.projects || [];

  const [step, setStep] = useState<WizardStep>('form');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [bindResult, setBindResult] = useState<BindResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [authPolling, setAuthPolling] = useState(false);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);

  const isWebhookValid = WEBHOOK_PATTERN.test(webhookUrl.trim());
  const canSubmit = selectedProject && isWebhookValid;

  const selectedProjectObj = projects.find((p) => p.path === selectedProject);

  useEffect(() => {
    checkPreflight();
  }, []);

  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].path);
    }
  }, [projects, selectedProject]);

  const checkPreflight = useCallback(async () => {
    try {
      const resp = await authFetch(`${API_BASE}/wecom/preflight`);
      const data = await resp.json();
      setPreflight(data);
      return data as PreflightData;
    } catch {
      return null;
    }
  }, []);

  const startAuth = async () => {
    try {
      const resp = await authFetch(`${API_BASE}/wecom/auth/start`, {
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
    } catch (err) {
      showError('认证失败', err instanceof Error ? err.message : '无法发起 OAuth 登录');
    }
  };

  const pollAuthStatus = useCallback(async () => {
    let attempts = 0;
    const maxAttempts = 60;
    const interval = 2000;

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
        showSuccess('认证成功', 'AS Enterprise 登录已完成');
        return;
      }
      setTimeout(poll, interval);
    };

    setTimeout(poll, interval);
  }, [checkPreflight]);

  const handleBind = async () => {
    if (!canSubmit) return;

    const pf = await checkPreflight();
    if (!pf?.auth?.ready) {
      startAuth();
      return;
    }

    setStep('processing');
    setErrorMessage('');

    const needsTunnel = !preflight?.tunnel.connected;
    const steps: ProcessingStep[] = [
      ...(needsTunnel ? [{ label: '建立隧道连接', status: 'active' as const }] : []),
      { label: '获取 A2A 端点', status: 'pending' as const },
      { label: '创建 API Key', status: 'pending' as const },
      { label: '注册企微机器人', status: 'pending' as const },
      { label: '生成回调配置', status: 'pending' as const },
    ];
    if (!needsTunnel) steps[0].status = 'active';
    setProcessingSteps(steps);

    try {
      const resp = await authFetch(`${API_BASE}/wecom/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: selectedProject,
          webhook_url: webhookUrl.trim(),
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        if (data.error === 'enterprise_auth_required') {
          startAuth();
          return;
        }
        throw new Error(data.error || data.message || `HTTP ${resp.status}`);
      }

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })));
      await new Promise((r) => setTimeout(r, 500));
      setBindResult(data);
      setStep('result');
      checkPreflight();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setProcessingSteps((prev) => {
        const lastDone = [...prev].reverse().findIndex((s) => s.status === 'done');
        const errorIdx = lastDone >= 0 ? prev.length - lastDone : prev.findIndex((s) => s.status !== 'done');
        return prev.map((s, i) => {
          if (i < errorIdx) return { ...s, status: 'done' as const };
          if (i === errorIdx) return { ...s, status: 'error' as const };
          return s;
        });
      });
    }
  };

  const handleReset = () => {
    setStep('form');
    setWebhookUrl('');
    setBindResult(null);
    setErrorMessage('');
    setProcessingSteps([]);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900 overflow-auto">
      <div className="flex-1 flex flex-col items-center px-6 py-8">
        {/* Header */}
        <div className="w-full max-w-xl mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-green-100 dark:bg-green-900/40 rounded-xl">
              <MessageSquare className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              企微机器人绑定
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 ml-[52px]">
            将 AgentStudio 项目连接到企业微信群，让 AI Agent 在群里回复消息
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

            {/* Tunnel status banner */}
            {preflight && preflight.auth.ready && !preflight.tunnel.connected && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/50 rounded-xl">
                <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    隧道未连接
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                    {preflight.tunnel.can_auto_provision
                      ? '点击绑定时将自动创建并连接隧道，无需手动配置。'
                      : '需要先在设置中配置隧道连接，确保外部能访问本地 Agent。'}
                  </p>
                </div>
              </div>
            )}

            {/* Connected tunnel info */}
            {preflight && preflight.tunnel.connected && preflight.tunnel.domain && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-xl">
                <Check className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    隧道已连接
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300 mt-1 font-mono">
                    {preflight.tunnel.domain}.tunnel
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Step 1: Project */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-bold text-blue-600 dark:text-blue-400">
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
                        {isLoadingProjects
                          ? '加载中...'
                          : selectedProjectObj?.name || '选择项目'}
                      </span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </button>

                  {showProjectDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowProjectDropdown(false)}
                      />
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-20 max-h-48 overflow-y-auto">
                        {projects.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => {
                              setSelectedProject(project.path);
                              setShowProjectDropdown(false);
                            }}
                            className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2.5 first:rounded-t-xl last:rounded-b-xl transition-colors ${
                              selectedProject === project.path
                                ? 'bg-blue-50 dark:bg-blue-900/20'
                                : ''
                            }`}
                          >
                            <Folder
                              className={`w-4 h-4 shrink-0 ${
                                selectedProject === project.path
                                  ? 'text-blue-500'
                                  : 'text-gray-400'
                              }`}
                            />
                            <div className="min-w-0">
                              <div
                                className={`text-sm truncate ${
                                  selectedProject === project.path
                                    ? 'text-blue-600 dark:text-blue-400 font-medium'
                                    : 'text-gray-700 dark:text-gray-300'
                                }`}
                              >
                                {project.name}
                              </div>
                              <div className="text-xs text-gray-400 truncate">{project.path}</div>
                            </div>
                          </button>
                        ))}
                        {projects.length === 0 && (
                          <div className="px-4 py-6 text-center text-sm text-gray-400">
                            暂无项目，请先在项目管理中创建
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Step 2: Webhook URL */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-bold text-blue-600 dark:text-blue-400">
                    2
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    粘贴企微机器人 Webhook 地址
                  </span>
                </div>

                <input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
                  className={`w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm font-mono outline-none transition-colors ${
                    webhookUrl && !isWebhookValid
                      ? 'border-red-300 dark:border-red-700 focus:border-red-400'
                      : 'border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500'
                  } text-gray-700 dark:text-gray-300 placeholder-gray-400`}
                />

                {webhookUrl && !isWebhookValid && (
                  <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    格式不正确，请粘贴完整的 Webhook 地址
                  </p>
                )}

                <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  获取方式：打开企微群 → 群设置（右上 ···） → 群机器人 → 添加 → 新建 → 复制
                  Webhook 地址
                </div>
              </div>

              {/* Submit */}
              <div className="p-6">
                <button
                  onClick={handleBind}
                  disabled={!canSubmit}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
                >
                  <MessageSquare className="w-4 h-4" />
                  一键绑定
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Processing step */}
        {step === 'processing' && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6 text-center">
                正在绑定...
              </h2>

              <div className="space-y-4">
                {processingSteps.map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                      {s.status === 'done' && (
                        <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                        </div>
                      )}
                      {s.status === 'active' && (
                        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                      )}
                      {s.status === 'pending' && (
                        <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-700" />
                      )}
                      {s.status === 'error' && (
                        <div className="w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                        </div>
                      )}
                    </div>
                    <span
                      className={`text-sm ${
                        s.status === 'done'
                          ? 'text-green-700 dark:text-green-400'
                          : s.status === 'active'
                            ? 'text-blue-700 dark:text-blue-400 font-medium'
                            : s.status === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {errorMessage && (
                <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                  <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
                  <button
                    onClick={() => {
                      setStep('form');
                      setErrorMessage('');
                    }}
                    className="mt-3 text-sm text-red-600 hover:text-red-800 dark:text-red-400 font-medium"
                  >
                    ← 返回修改
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result step */}
        {step === 'result' && bindResult && (
          <div className="w-full max-w-xl">
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Success header */}
              <div className="px-6 py-5 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center">
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-green-800 dark:text-green-200">
                      绑定成功！
                    </h2>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      {bindResult.project_name} 已绑定到企微群机器人
                    </p>
                  </div>
                </div>
              </div>

              {/* Values to copy */}
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
                  请将以下 3 个值填入企微群机器人的 <strong>「接收消息配置」</strong>：
                </p>

                <div className="space-y-4">
                  <CopyField label="URL" value={bindResult.callback_url} />
                  <CopyField label="Token" value={bindResult.token} />
                  <CopyField label="EncodingAESKey" value={bindResult.encoding_aes_key} />
                </div>

                <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                  <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                    <strong>操作指引：</strong>
                    企微群设置 → 群机器人 → 点击刚创建的机器人 → 接收消息配置 → 填入上方 3
                    个值 → 保存。
                    <br />
                    保存后在群里 @机器人 发一条消息测试。
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                <button
                  onClick={() => navigate('/dashboard')}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回首页
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  再绑定一个
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WecomBindPage;
