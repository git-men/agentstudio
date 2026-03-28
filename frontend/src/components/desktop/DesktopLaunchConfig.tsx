import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLaunchConfig, ENGINE_OPTIONS, type LaunchConfig, type EngineOption } from '../../hooks/useLaunchConfig';
import { EngineSetupWizard } from './EngineSetupWizard';

const AUTO_LAUNCH_SECONDS = 10;

interface DesktopLaunchConfigProps {
  onStarted: () => void;
}

export const DesktopLaunchConfig: React.FC<DesktopLaunchConfigProps> = ({ onStarted }) => {
  const { config, loading, starting, error, startBackend, availableEngines } = useLaunchConfig();
  const [engine, setEngine] = useState<string | null>(null);
  const [setupEngine, setSetupEngine] = useState<EngineOption | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLaunchedRef = useRef(false);
  const hasAttemptedAutoLaunchRef = useRef(false);

  useEffect(() => {
    if (!loading && engine === null) {
      setEngine(config.engine);
    }
  }, [loading, config, engine]);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }, []);

  const doLaunch = useCallback(async (engineValue: string) => {
    const selectedConfig: LaunchConfig = { engine: engineValue };
    try {
      await startBackend(selectedConfig);
      onStarted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already running')) {
        onStarted();
      } else {
        hasLaunchedRef.current = false;
      }
    }
  }, [startBackend, onStarted]);

  const handleLaunch = useCallback(async () => {
    stopCountdown();
    if (hasLaunchedRef.current) return;
    hasLaunchedRef.current = true;

    const currentEngine = engine ?? config.engine;
    const engineDef = ENGINE_OPTIONS.find(e => e.value === currentEngine);

    if (engineDef?.cliName) {
      setSetupEngine(engineDef);
      hasLaunchedRef.current = false;
      return;
    }

    await doLaunch(currentEngine);
  }, [engine, config.engine, stopCountdown, doLaunch]);

  // Auto-launch countdown — only triggers once per mount
  useEffect(() => {
    if (loading || !config.engine || starting || hasAttemptedAutoLaunchRef.current) return;
    hasAttemptedAutoLaunchRef.current = true;

    setCountdown(AUTO_LAUNCH_SECONDS);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [loading, config.engine, starting]);

  useEffect(() => {
    if (countdown === 0 && !starting && !hasLaunchedRef.current) {
      handleLaunch();
    }
  }, [countdown, starting, handleLaunch]);

  const handleEngineChange = (value: string) => {
    setEngine(value);
    stopCountdown();
    hasAttemptedAutoLaunchRef.current = true;
  };

  const isDevMode = import.meta.env.DEV;

  const handleSetupReady = useCallback(async (_cliPath: string) => {
    setSetupEngine(null);
    const currentEngine = engine ?? config.engine;
    try {
      await doLaunch(currentEngine);
    } catch {
      // error surfaced via hook's error state
    }
  }, [engine, config.engine, doLaunch]);

  const handleSetupCancel = useCallback(() => {
    setSetupEngine(null);
    hasLaunchedRef.current = false;
  }, []);

  const currentEngine = engine ?? config.engine;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0f172a]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#1e293b] border-t-[#6366f1]" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f172a] text-[#e2e8f0] select-none">
      <div className="w-full max-w-lg px-8 py-10">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <img src="/cc-studio.png" alt="ClawStudio" className="w-12 h-12 rounded-xl" />
          <span className="text-2xl font-bold bg-gradient-to-r from-[#6366f1] to-[#a78bfa] bg-clip-text text-transparent">
            ClawStudio
          </span>
        </div>

        {/* Engine Selection */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-[#94a3b8] mb-3">Execution Engine</h3>
          <div className="grid grid-cols-1 gap-2">
            {availableEngines.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleEngineChange(opt.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
                  currentEngine === opt.value
                    ? 'border-[#6366f1] bg-[#6366f1]/10 shadow-[0_0_0_1px_rgba(99,102,241,0.3)]'
                    : 'border-[#1e293b] bg-[#0f172a] hover:border-[#334155] hover:bg-[#1e293b]/50'
                }`}
                disabled={starting}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  currentEngine === opt.value ? 'border-[#6366f1]' : 'border-[#475569]'
                }`}>
                  {currentEngine === opt.value && <div className="w-2 h-2 rounded-full bg-[#6366f1]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#e2e8f0]">{opt.label}</div>
                  <div className="text-xs text-[#64748b]">{opt.description}</div>
                </div>
                {opt.internalOnly && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#6366f1]/15 text-[#a78bfa] border border-[#6366f1]/20 shrink-0">
                    Internal
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Dev mode engine switch hint */}
        {isDevMode && config.engine && engine && engine !== config.engine && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs">
            Dev mode: engine change will take effect on next restart.
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-[#f87171]/10 border border-[#f87171]/20 text-[#f87171] text-sm">
            {error}
          </div>
        )}

        {/* Launch Button */}
        <button
          onClick={handleLaunch}
          disabled={starting}
          className={`w-full py-3 rounded-xl font-semibold text-white transition-all ${
            starting
              ? 'bg-[#4f46e5]/50 cursor-wait'
              : 'bg-gradient-to-r from-[#6366f1] to-[#8b5cf6] hover:from-[#4f46e5] hover:to-[#7c3aed] shadow-lg shadow-[#6366f1]/25 hover:shadow-[#6366f1]/40'
          }`}
        >
          {starting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Starting...
            </span>
          ) : countdown !== null && countdown > 0 ? (
            `Launch (${countdown}s)`
          ) : (
            'Launch'
          )}
        </button>

        <p className="text-center text-[10px] text-[#475569] mt-4">
          v{__APP_VERSION__ || '0.1.0'}
        </p>
      </div>

      {/* Engine Setup Wizard (modal overlay) */}
      {setupEngine && (
        <EngineSetupWizard
          engine={setupEngine}
          onReady={handleSetupReady}
          onCancel={handleSetupCancel}
        />
      )}
    </div>
  );
};

declare const __APP_VERSION__: string | undefined;
