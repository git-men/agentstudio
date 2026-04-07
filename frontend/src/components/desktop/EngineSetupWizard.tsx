import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { EngineOption } from '../../hooks/useLaunchConfig';

type WizardStep = 'checking' | 'not_installed' | 'installing' | 'install_failed' | 'ready';

const ENGINE_LABEL_KEY_MAP: Record<string, string> = {
  'claude-sdk': 'claudeSdk',
  'claude-internal-sdk': 'claudeInternalSdk',
};

interface EngineSetupWizardProps {
  engine: EngineOption;
  onReady: (cliPath: string) => void;
  onCancel: () => void;
}

export const EngineSetupWizard: React.FC<EngineSetupWizardProps> = ({
  engine,
  onReady,
  onCancel,
}) => {
  const { t } = useTranslation('components');
  const engineLabel = (() => {
    const key = ENGINE_LABEL_KEY_MAP[engine.value];
    if (key) return t(`engineOptions.${key}.label`, { defaultValue: engine.label });
    return engine.label;
  })();
  const [step, setStep] = useState<WizardStep>('checking');
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const canAutoInstall = !!engine.npmPackage;
  const installCommand = engine.npmPackage
    ? `npm install -g ${engine.npmPackage}`
    : engine.installCmd || '';

  const checkCli = useCallback(async () => {
    if (!engine.cliName) {
      onReady('');
      return;
    }

    setStep('checking');
    console.log(`[EngineSetupWizard] Checking CLI: ${engine.cliName} (engine=${engine.value})`);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string | null>('check_cli_installed', { cliName: engine.cliName });

      console.log(`[EngineSetupWizard] check_cli_installed result: ${path ?? 'null'}`);
      if (path) {
        onReady(path);
      } else {
        console.warn(`[EngineSetupWizard] CLI not found: ${engine.cliName}`);
        setStep('not_installed');
      }
    } catch (err) {
      console.error(`[EngineSetupWizard] check_cli_installed threw:`, err);
      setStep('not_installed');
    }
  }, [engine, onReady]);

  useEffect(() => {
    checkCli();
  }, [checkCli]);

  const handleInstall = async () => {
    setStep('installing');
    setInstallLog('');
    setErrorMsg('');

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      let output: string;
      if (engine.npmPackage) {
        output = await invoke<string>('install_npm_package', {
          packageName: engine.npmPackage,
        });
      } else {
        setErrorMsg(t('engineSetupWizard.noAutoInstall'));
        setStep('install_failed');
        return;
      }

      setInstallLog(output);

      const path = await invoke<string | null>('check_cli_installed', { cliName: engine.cliName });
      console.log(`[EngineSetupWizard] Post-install check_cli_installed result: ${path ?? 'null'}`);
      if (path) {
        setCliPath(path);
        setStep('ready');
      } else {
        console.warn(`[EngineSetupWizard] CLI still not found after install: ${engine.cliName}`);
        setErrorMsg(t('engineSetupWizard.cliNotFoundAfterInstall'));
        setStep('install_failed');
      }
    } catch (e) {
      console.error(`[EngineSetupWizard] Install failed:`, e);
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep('install_failed');
    }
  };

  const handleProceed = () => {
    onReady(cliPath || '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="engine-setup-title">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-[#1e293b] border border-[#334155] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#334155]">
          <h2 id="engine-setup-title" className="text-lg font-semibold text-[#e2e8f0]">
            {t('engineSetupWizard.setupTitle', { engine: engineLabel })}
          </h2>
          <p className="text-xs text-[#64748b] mt-1">
            {step === 'checking' && t('engineSetupWizard.subtitle.checking', { engine: engineLabel })}
            {step === 'not_installed' && t('engineSetupWizard.subtitle.notInstalled', { engine: engineLabel })}
            {step === 'installing' && t('engineSetupWizard.subtitle.installing', { engine: engineLabel })}
            {step === 'install_failed' && t('engineSetupWizard.subtitle.installFailed')}
            {step === 'ready' && t('engineSetupWizard.subtitle.ready', { engine: engineLabel })}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {step === 'checking' && (
            <div className="flex items-center gap-3 text-[#94a3b8]">
              <div className="w-5 h-5 border-2 border-[#475569] border-t-[#6366f1] rounded-full animate-spin" />
              <span className="text-sm">{t('engineSetupWizard.checking', { cliName: engine.cliName })}</span>
            </div>
          )}

          {step === 'not_installed' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#f59e0b]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#e2e8f0]">
                    {t('engineSetupWizard.notInstalled', { cliName: engine.cliName })}
                  </p>
                  <p className="text-xs text-[#64748b] mt-1">
                    {canAutoInstall
                      ? t('engineSetupWizard.installHint')
                      : t('engineSetupWizard.manualInstallHint')}
                  </p>
                </div>
              </div>

              {installCommand && (
                <div className="rounded-lg bg-[#0f172a] border border-[#334155] px-4 py-3">
                  <p className="text-[10px] text-[#64748b] mb-1">{t('engineSetupWizard.commandLabel')}</p>
                  <code className="text-sm text-[#a78bfa] select-all break-all">
                    {installCommand}
                  </code>
                </div>
              )}
            </div>
          )}

          {step === 'installing' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-[#94a3b8]">
                <div className="w-5 h-5 border-2 border-[#475569] border-t-[#6366f1] rounded-full animate-spin" />
                <span className="text-sm">{t('engineSetupWizard.installing', { engine: engineLabel })}</span>
              </div>
              <p className="text-[10px] text-[#475569]">{t('engineSetupWizard.installWait')}</p>
            </div>
          )}

          {step === 'install_failed' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#f87171]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#e2e8f0]">{t('engineSetupWizard.installFailed')}</p>
                  <p className="text-xs text-[#f87171] mt-1 break-all">{errorMsg}</p>
                </div>
              </div>
              {installLog && (
                <pre className="text-[10px] text-[#64748b] bg-[#0f172a] rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap">
                  {installLog}
                </pre>
              )}
            </div>
          )}

          {step === 'ready' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#22c55e]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#e2e8f0]">
                    {t('engineSetupWizard.ready', { cliName: engine.cliName })}
                  </p>
                  {cliPath && (
                    <p className="text-xs text-[#64748b] mt-1 font-mono break-all">{cliPath}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#334155] flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#334155] transition-colors"
          >
            {t('engineSetupWizard.cancel')}
          </button>

          {step === 'not_installed' && canAutoInstall && (
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium hover:from-[#4f46e5] hover:to-[#7c3aed] transition-all"
            >
              {t('engineSetupWizard.installNow')}
            </button>
          )}

          {step === 'install_failed' && (
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm rounded-lg bg-[#475569] text-[#e2e8f0] hover:bg-[#64748b] transition-colors"
            >
              {t('engineSetupWizard.retry')}
            </button>
          )}

          {step === 'ready' && (
            <button
              onClick={handleProceed}
              className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium hover:from-[#4f46e5] hover:to-[#7c3aed] transition-all"
            >
              {t('engineSetupWizard.continue')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
