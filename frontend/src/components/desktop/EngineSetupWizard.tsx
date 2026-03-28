import React, { useState, useEffect, useCallback } from 'react';
import type { EngineOption } from '../../hooks/useLaunchConfig';

type WizardStep = 'checking' | 'not_installed' | 'installing' | 'install_failed' | 'ready';

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
  const [step, setStep] = useState<WizardStep>('checking');
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const canAutoInstall = !!(engine.npmPackage || engine.installCmd);
  const installCommand = engine.npmPackage
    ? `npm install -g ${engine.npmPackage}`
    : engine.installCmd || '';

  const checkCli = useCallback(async () => {
    if (!engine.cliName) {
      onReady('');
      return;
    }

    setStep('checking');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string | null>('check_cli_installed', { cliName: engine.cliName });

      if (path) {
        setCliPath(path);
        setStep('ready');
      } else {
        setStep('not_installed');
      }
    } catch {
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
      } else if (engine.installCmd) {
        output = await invoke<string>('run_shell_command', {
          command: engine.installCmd,
        });
      } else {
        setErrorMsg('No install method available');
        setStep('install_failed');
        return;
      }

      setInstallLog(output);

      const path = await invoke<string | null>('check_cli_installed', { cliName: engine.cliName });
      if (path) {
        setCliPath(path);
        setStep('ready');
      } else {
        setErrorMsg('Installation completed but CLI not found in PATH. Try restarting your terminal.');
        setStep('install_failed');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep('install_failed');
    }
  };

  const handleProceed = () => {
    onReady(cliPath || '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-2xl bg-[#1e293b] border border-[#334155] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#334155]">
          <h2 className="text-lg font-semibold text-[#e2e8f0]">
            {engine.label} Setup
          </h2>
          <p className="text-xs text-[#64748b] mt-1">
            Checking environment for {engine.label}...
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {step === 'checking' && (
            <div className="flex items-center gap-3 text-[#94a3b8]">
              <div className="w-5 h-5 border-2 border-[#475569] border-t-[#6366f1] rounded-full animate-spin" />
              <span className="text-sm">Checking if <code className="text-[#a78bfa]">{engine.cliName}</code> is installed...</span>
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
                    <code className="text-[#a78bfa]">{engine.cliName}</code> is not installed
                  </p>
                  <p className="text-xs text-[#64748b] mt-1">
                    {canAutoInstall
                      ? 'Install it to continue.'
                      : 'Please install it manually and try again.'}
                  </p>
                </div>
              </div>

              {installCommand && (
                <div className="rounded-lg bg-[#0f172a] border border-[#334155] px-4 py-3">
                  <p className="text-[10px] text-[#64748b] mb-1">Command:</p>
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
                <span className="text-sm">Installing <code className="text-[#a78bfa]">{engine.label}</code>...</span>
              </div>
              <p className="text-[10px] text-[#475569]">This may take a minute...</p>
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
                  <p className="text-sm font-medium text-[#e2e8f0]">Installation failed</p>
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
                    <code className="text-[#a78bfa]">{engine.cliName}</code> is ready
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
            Cancel
          </button>

          {step === 'not_installed' && canAutoInstall && (
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium hover:from-[#4f46e5] hover:to-[#7c3aed] transition-all"
            >
              Install Now
            </button>
          )}

          {step === 'install_failed' && (
            <button
              onClick={handleInstall}
              className="px-4 py-2 text-sm rounded-lg bg-[#475569] text-[#e2e8f0] hover:bg-[#64748b] transition-colors"
            >
              Retry
            </button>
          )}

          {step === 'ready' && (
            <button
              onClick={handleProceed}
              className="px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] text-white font-medium hover:from-[#4f46e5] hover:to-[#7c3aed] transition-all"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
