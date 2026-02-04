/**
 * Voice Settings Page
 * 语音服务配置页面
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Mic,
  RefreshCw,
  Save,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authFetch } from '../../lib/authFetch';
import { API_BASE } from '../../lib/config';

// 供应商类型
type SpeechProvider = 'openai' | 'groq' | 'aliyun' | 'tencent' | 'google';

// 设置类型
interface SpeechToTextSettings {
  enabled: boolean;
  defaultProvider: SpeechProvider;
  providers: {
    openai: {
      enabled: boolean;
      apiKey: string;
      baseUrl: string;
      model: string;
    };
    groq: {
      enabled: boolean;
      apiKey: string;
      baseUrl: string;
      model: string;
    };
    aliyun: {
      enabled: boolean;
      accessKeyId: string;
      accessKeySecret: string;
      appKey: string;
    };
    tencent: {
      enabled: boolean;
      secretId: string;
      secretKey: string;
      appId: string;
    };
    google: {
      enabled: boolean;
      apiKey: string;
    };
  };
}

// 供应商信息
const PROVIDER_INFO: Record<
  SpeechProvider,
  { name: string; description: string; docsUrl: string }
> = {
  openai: {
    name: 'OpenAI Whisper',
    description: '高质量语音识别，支持多语言',
    docsUrl: 'https://platform.openai.com/docs/guides/speech-to-text',
  },
  groq: {
    name: 'Groq Whisper',
    description: '超快速度，价格便宜，兼容 OpenAI API',
    docsUrl: 'https://console.groq.com',
  },
  aliyun: {
    name: '阿里云语音识别',
    description: '国内访问快，中文识别准确',
    docsUrl: 'https://help.aliyun.com/document_detail/84435.html',
  },
  tencent: {
    name: '腾讯云语音识别',
    description: '国内访问快，支持多种语言',
    docsUrl: 'https://cloud.tencent.com/document/product/1093',
  },
  google: {
    name: 'Google Cloud Speech-to-Text',
    description: '高质量语音识别，支持 125+ 语言和变体',
    docsUrl: 'https://cloud.google.com/speech-to-text/docs',
  },
};

export const VoiceSettingsPage: React.FC = () => {
  const { t } = useTranslation(['pages', 'components']);
  const [settings, setSettings] = useState<SpeechToTextSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  // 加载设置
  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/speech-to-text/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings(data);
      } else {
        throw new Error('Failed to load settings');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载设置失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 保存设置
  const saveSettings = useCallback(async () => {
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch(`${API_BASE}/speech-to-text/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setSuccess('设置已保存');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存设置失败');
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  // 测试供应商
  const testProvider = useCallback(async (provider: SpeechProvider) => {
    setTestingProvider(provider);
    setError(null);
    setSuccess(null);

    try {
      const response = await authFetch(`${API_BASE}/speech-to-text/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });

      if (response.ok) {
        setSuccess(`${PROVIDER_INFO[provider].name} 配置验证成功`);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.message || '测试失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试失败');
    } finally {
      setTestingProvider(null);
    }
  }, []);

  // 初始化
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 更新设置
  const updateSettings = (path: string, value: any) => {
    if (!settings) return;

    const newSettings = { ...settings };
    const keys = path.split('.');
    let obj: any = newSettings;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    setSettings(newSettings);
  };

  // 切换密码显示
  const toggleShowSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // 渲染 OpenAI 兼容供应商配置
  const renderOpenAICompatibleConfig = (
    provider: 'openai' | 'groq',
    config: { enabled: boolean; apiKey: string; baseUrl: string; model: string }
  ) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              updateSettings(`providers.${provider}.enabled`, e.target.checked)
            }
            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            启用
          </span>
        </label>

        {config.enabled && (
          <button
            onClick={() => testProvider(provider)}
            disabled={testingProvider === provider}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            {testingProvider === provider ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>测试</span>
          </button>
        )}
      </div>

      {config.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API Key
            </label>
            <div className="relative">
              <input
                type={showSecrets[`${provider}.apiKey`] ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) =>
                  updateSettings(`providers.${provider}.apiKey`, e.target.value)
                }
                placeholder="sk-..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret(`${provider}.apiKey`)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets[`${provider}.apiKey`] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Base URL
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) =>
                updateSettings(`providers.${provider}.baseUrl`, e.target.value)
              }
              placeholder={
                provider === 'openai'
                  ? 'https://api.openai.com/v1'
                  : 'https://api.groq.com/openai/v1'
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Model
            </label>
            <input
              type="text"
              value={config.model}
              onChange={(e) =>
                updateSettings(`providers.${provider}.model`, e.target.value)
              }
              placeholder={
                provider === 'openai' ? 'whisper-1' : 'whisper-large-v3'
              }
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
        </>
      )}
    </div>
  );

  // 渲染阿里云配置
  const renderAliyunConfig = (config: {
    enabled: boolean;
    accessKeyId: string;
    accessKeySecret: string;
    appKey: string;
  }) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              updateSettings('providers.aliyun.enabled', e.target.checked)
            }
            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            启用
          </span>
        </label>

        {config.enabled && (
          <button
            onClick={() => testProvider('aliyun')}
            disabled={testingProvider === 'aliyun'}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            {testingProvider === 'aliyun' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>测试</span>
          </button>
        )}
      </div>

      {config.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              AccessKey ID
            </label>
            <div className="relative">
              <input
                type={showSecrets['aliyun.accessKeyId'] ? 'text' : 'password'}
                value={config.accessKeyId}
                onChange={(e) =>
                  updateSettings('providers.aliyun.accessKeyId', e.target.value)
                }
                placeholder="LTAI..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret('aliyun.accessKeyId')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets['aliyun.accessKeyId'] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              AccessKey Secret
            </label>
            <div className="relative">
              <input
                type={
                  showSecrets['aliyun.accessKeySecret'] ? 'text' : 'password'
                }
                value={config.accessKeySecret}
                onChange={(e) =>
                  updateSettings(
                    'providers.aliyun.accessKeySecret',
                    e.target.value
                  )
                }
                placeholder="..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret('aliyun.accessKeySecret')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets['aliyun.accessKeySecret'] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              AppKey
            </label>
            <input
              type="text"
              value={config.appKey}
              onChange={(e) =>
                updateSettings('providers.aliyun.appKey', e.target.value)
              }
              placeholder="..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
        </>
      )}
    </div>
  );

  // 渲染腾讯云配置
  const renderTencentConfig = (config: {
    enabled: boolean;
    secretId: string;
    secretKey: string;
    appId: string;
  }) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              updateSettings('providers.tencent.enabled', e.target.checked)
            }
            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            启用
          </span>
        </label>

        {config.enabled && (
          <button
            onClick={() => testProvider('tencent')}
            disabled={testingProvider === 'tencent'}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            {testingProvider === 'tencent' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>测试</span>
          </button>
        )}
      </div>

      {config.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              SecretId
            </label>
            <div className="relative">
              <input
                type={showSecrets['tencent.secretId'] ? 'text' : 'password'}
                value={config.secretId}
                onChange={(e) =>
                  updateSettings('providers.tencent.secretId', e.target.value)
                }
                placeholder="AKID..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret('tencent.secretId')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets['tencent.secretId'] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              SecretKey
            </label>
            <div className="relative">
              <input
                type={showSecrets['tencent.secretKey'] ? 'text' : 'password'}
                value={config.secretKey}
                onChange={(e) =>
                  updateSettings('providers.tencent.secretKey', e.target.value)
                }
                placeholder="..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret('tencent.secretKey')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets['tencent.secretKey'] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              AppId (可选)
            </label>
            <input
              type="text"
              value={config.appId}
              onChange={(e) =>
                updateSettings('providers.tencent.appId', e.target.value)
              }
              placeholder="..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
        </>
      )}
    </div>
  );

  // 渲染 Google Cloud 配置
  const renderGoogleConfig = (config: {
    enabled: boolean;
    apiKey: string;
  }) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              updateSettings('providers.google.enabled', e.target.checked)
            }
            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            启用
          </span>
        </label>

        {config.enabled && (
          <button
            onClick={() => testProvider('google')}
            disabled={testingProvider === 'google'}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
          >
            {testingProvider === 'google' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>测试</span>
          </button>
        )}
      </div>

      {config.enabled && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API Key
            </label>
            <div className="relative">
              <input
                type={showSecrets['google.apiKey'] ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) =>
                  updateSettings('providers.google.apiKey', e.target.value)
                }
                placeholder="AIza..."
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => toggleShowSecret('google.apiKey')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showSecrets['google.apiKey'] ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              在 Google Cloud Console 创建 API Key，并启用 Speech-to-Text API
            </p>
          </div>
        </>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12 text-red-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2" />
        <p>加载设置失败</p>
        <button
          onClick={loadSettings}
          className="mt-4 px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Mic className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              语音输入设置
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              配置语音转文字服务供应商
            </p>
          </div>
        </div>

        <button
          onClick={saveSettings}
          disabled={isSaving}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>保存设置</span>
        </button>
      </div>

      {/* 消息提示 */}
      {error && (
        <div className="flex items-center space-x-2 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-300">{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center space-x-2 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
          <span className="text-green-800 dark:text-green-300">{success}</span>
        </div>
      )}

      {/* 全局开关 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">
              启用语音输入
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              在聊天输入框显示语音输入按钮
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => updateSettings('enabled', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>

      {/* 默认供应商 */}
      {settings.enabled && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
            默认供应商
          </h2>
          <select
            value={settings.defaultProvider}
            onChange={(e) =>
              updateSettings('defaultProvider', e.target.value as SpeechProvider)
            }
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            {Object.entries(PROVIDER_INFO).map(([key, info]) => (
              <option key={key} value={key}>
                {info.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 供应商配置 */}
      {settings.enabled && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            供应商配置
          </h2>

          {/* OpenAI */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {PROVIDER_INFO.openai.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {PROVIDER_INFO.openai.description}
                </p>
              </div>
              <a
                href={PROVIDER_INFO.openai.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                文档
              </a>
            </div>
            {renderOpenAICompatibleConfig('openai', settings.providers.openai)}
          </div>

          {/* Groq */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {PROVIDER_INFO.groq.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {PROVIDER_INFO.groq.description}
                </p>
              </div>
              <a
                href={PROVIDER_INFO.groq.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                文档
              </a>
            </div>
            {renderOpenAICompatibleConfig('groq', settings.providers.groq)}
          </div>

          {/* Aliyun */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {PROVIDER_INFO.aliyun.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {PROVIDER_INFO.aliyun.description}
                </p>
              </div>
              <a
                href={PROVIDER_INFO.aliyun.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                文档
              </a>
            </div>
            {renderAliyunConfig(settings.providers.aliyun)}
          </div>

          {/* Tencent */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {PROVIDER_INFO.tencent.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {PROVIDER_INFO.tencent.description}
                </p>
              </div>
              <a
                href={PROVIDER_INFO.tencent.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                文档
              </a>
            </div>
            {renderTencentConfig(settings.providers.tencent)}
          </div>

          {/* Google */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {PROVIDER_INFO.google.name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {PROVIDER_INFO.google.description}
                </p>
              </div>
              <a
                href={PROVIDER_INFO.google.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                文档
              </a>
            </div>
            {renderGoogleConfig(settings.providers.google)}
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceSettingsPage;
