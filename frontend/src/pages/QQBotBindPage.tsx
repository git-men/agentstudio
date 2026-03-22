import React, { useState, useEffect, useCallback } from 'react';
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
  Bot,
  Eye,
  EyeOff,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useProjects } from '../hooks/useProjects';
import { authFetch } from '../lib/authFetch';
import { API_BASE } from '../lib/config';

type WizardStep = 'form' | 'processing' | 'result';

interface BindResult {
  bot_key: string;
  bot_name: string;
  project_name: string;
  a2a_endpoint: string;
  app_id: string;
  connection: {
    success: boolean;
    connected: boolean;
    session_id?: string;
  };
}

interface PreflightData {
  dispatch: {
    reachable: boolean;
    url: string;
  };
}

interface ProcessingStep {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
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

export const QQBotBindPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: projectsData, isLoading: isLoadingProjects } = useProjects();
  const projects = projectsData?.projects || [];

  const [step, setStep] = useState<WizardStep>('form');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [appId, setAppId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [botName, setBotName] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [bindResult, setBindResult] = useState<BindResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [preflight, setPreflight] = useState<PreflightData | null>(null);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);

  const isAppIdValid = /^\d{6,20}$/.test(appId.trim());
  const isSecretValid = clientSecret.trim().length >= 8;
  const canSubmit = selectedProject && isAppIdValid && isSecretValid;

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
      const resp = await authFetch(`${API_BASE}/qqbot/preflight`);
      const data = await resp.json();
      setPreflight(data);
      return data as PreflightData;
    } catch {
      return null;
    }
  }, []);

  const handleBind = async () => {
    if (!canSubmit) return;

    setStep('processing');
    setErrorMessage('');

    const steps: ProcessingStep[] = [
      { label: '获取 A2A 端点', status: 'active' },
      { label: '创建 API Key', status: 'pending' },
      { label: '注册 QQ Bot', status: 'pending' },
      { label: '启动 WebSocket 连接', status: 'pending' },
    ];
    setProcessingSteps(steps);

    try {
      const resp = await authFetch(`${API_BASE}/qqbot/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: selectedProject,
          app_id: appId.trim(),
          client_secret: clientSecret.trim(),
          bot_name: botName.trim() || undefined,
        }),
      });

      const data = await resp.json();

      if (!resp.ok || !data.success) {
        throw new Error(data.error || data.message || `HTTP ${resp.status}`);
      }

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: 'done' as const })));
      await new Promise((r) => setTimeout(r, 500));
      setBindResult(data);
      setStep('result');
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
    setAppId('');
    setClientSecret('');
    setBotName('');
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
            <div className="p-2.5 bg-blue-100 dark:bg-blue-900/40 rounded-xl">
              <Bot className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              QQ Bot 绑定
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 ml-[52px]">
            将 AgentStudio 项目连接到 QQ，让 AI Agent 在 QQ 中回复消息
          </p>
        </div>

        {/* Form step */}
        {step === 'form' && (
          <div className="w-full max-w-xl">
            {/* Dispatch status banner */}
            {preflight && !preflight.dispatch.reachable && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl">
                <WifiOff className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-800 dark:text-red-200">
                    as-dispatch 服务不可达
                  </p>
                  <p className="text-xs text-red-600 dark:text-red-300 mt-1">
                    无法连接 {preflight.dispatch.url}。请确保 as-dispatch 正在运行。
                  </p>
                  <button
                    onClick={checkPreflight}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-800/50 dark:hover:bg-red-700/50 dark:text-red-200 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    重新检测
                  </button>
                </div>
              </div>
            )}

            {preflight && preflight.dispatch.reachable && (
              <div className="mb-4 flex items-start gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-xl">
                <Wifi className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    as-dispatch 已连接
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300 mt-1 font-mono">
                    {preflight.dispatch.url}
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

              {/* Step 2: QQ Bot Credentials */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-xs font-bold text-blue-600 dark:text-blue-400">
                    2
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    填写 QQ Bot 凭据
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      AppID
                    </label>
                    <input
                      type="text"
                      value={appId}
                      onChange={(e) => setAppId(e.target.value)}
                      placeholder="例如: 1903102623"
                      className={`w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm font-mono outline-none transition-colors ${
                        appId && !isAppIdValid
                          ? 'border-red-300 dark:border-red-700 focus:border-red-400'
                          : 'border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500'
                      } text-gray-700 dark:text-gray-300 placeholder-gray-400`}
                    />
                    {appId && !isAppIdValid && (
                      <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        AppID 应为 6-20 位数字
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      ClientSecret
                    </label>
                    <div className="relative">
                      <input
                        type={showSecret ? 'text' : 'password'}
                        value={clientSecret}
                        onChange={(e) => setClientSecret(e.target.value)}
                        placeholder="QQ 开放平台获取的 AppSecret"
                        className={`w-full px-4 py-3 pr-12 bg-gray-50 dark:bg-gray-900 rounded-xl border text-sm font-mono outline-none transition-colors ${
                          clientSecret && !isSecretValid
                            ? 'border-red-300 dark:border-red-700 focus:border-red-400'
                            : 'border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500'
                        } text-gray-700 dark:text-gray-300 placeholder-gray-400`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowSecret(!showSecret)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {clientSecret && !isSecretValid && (
                      <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        ClientSecret 长度不足
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  获取方式：
                  <a
                    href="https://q.qq.com/qqbot/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600 underline"
                  >
                    QQ 开放平台
                  </a>
                  {' → 应用管理 → 选择应用 → AppID / AppSecret'}
                </div>
              </div>

              {/* Step 3: Bot Name (optional) */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-bold text-gray-500 dark:text-gray-400">
                    3
                  </span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    Bot 名称
                    <span className="ml-1.5 text-xs font-normal text-gray-400">（可选）</span>
                  </span>
                </div>

                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder={selectedProjectObj ? `${selectedProjectObj.name} QQ Bot` : 'My QQ Bot'}
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 focus:border-blue-400 dark:focus:border-blue-500 text-sm outline-none transition-colors text-gray-700 dark:text-gray-300 placeholder-gray-400"
                />
              </div>

              {/* Submit */}
              <div className="p-6">
                <button
                  onClick={handleBind}
                  disabled={!canSubmit || (preflight !== null && !preflight.dispatch.reachable)}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
                >
                  <Bot className="w-4 h-4" />
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
              <div className="px-6 py-5 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                    {bindResult.connection?.connected ? (
                      <Wifi className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Check className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-200">
                      {bindResult.connection?.connected ? 'QQ Bot 已上线！' : '绑定成功！'}
                    </h2>
                    <p className="text-sm text-blue-600 dark:text-blue-400">
                      {bindResult.project_name} 已绑定到 QQ Bot
                    </p>
                  </div>
                </div>
              </div>

              {/* Connection status */}
              <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    bindResult.connection?.connected
                      ? 'bg-green-500 animate-pulse'
                      : 'bg-yellow-500'
                  }`} />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    WebSocket 连接状态：
                    {bindResult.connection?.connected ? (
                      <span className="text-green-600 dark:text-green-400 ml-1">已连接</span>
                    ) : (
                      <span className="text-yellow-600 dark:text-yellow-400 ml-1">连接中...</span>
                    )}
                  </span>
                </div>

                <div className="space-y-3">
                  <CopyField label="Bot Key" value={bindResult.bot_key} />
                  <CopyField label="AppID" value={bindResult.app_id} />
                  <CopyField label="A2A 端点" value={bindResult.a2a_endpoint} />
                  {bindResult.connection?.session_id && (
                    <CopyField label="Session ID" value={bindResult.connection.session_id} />
                  )}
                </div>
              </div>

              {/* Instructions */}
              <div className="p-6">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                  <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                    <strong>测试方式：</strong>
                    {bindResult.connection?.connected ? (
                      <>在 QQ 中找到你的 Bot，直接发送消息即可测试。Bot 会通过 AgentStudio 项目中的 AI Agent 回复。</>
                    ) : (
                      <>Bot 已注册但 WebSocket 连接可能仍在建立中。请稍等几秒后在 QQ 中测试。如果无法收到回复，请检查 as-dispatch 的日志。</>
                    )}
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
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
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

export default QQBotBindPage;
