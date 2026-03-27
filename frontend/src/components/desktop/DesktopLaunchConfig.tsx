import React, { useState } from 'react';
import { useLaunchConfig, ENGINE_OPTIONS, type LaunchConfig } from '../../hooks/useLaunchConfig';

interface DesktopLaunchConfigProps {
  onStarted: () => void;
}

export const DesktopLaunchConfig: React.FC<DesktopLaunchConfigProps> = ({ onStarted }) => {
  const { config, loading, starting, error, startBackend } = useLaunchConfig();
  const [engine, setEngine] = useState<string | null>(null);

  React.useEffect(() => {
    if (!loading && engine === null) {
      setEngine(config.engine);
    }
  }, [loading, config, engine]);

  const handleLaunch = async () => {
    const selectedConfig: LaunchConfig = {
      engine: engine ?? config.engine,
    };
    try {
      await startBackend(selectedConfig);
      onStarted();
    } catch {
      // error state is set inside the hook
    }
  };

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
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] flex items-center justify-center text-2xl">
            🦀
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-[#6366f1] to-[#a78bfa] bg-clip-text text-transparent">
            ClawStudio
          </span>
        </div>

        {/* Engine Selection */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-[#94a3b8] mb-3">Execution Engine</h3>
          <div className="grid grid-cols-1 gap-2">
            {ENGINE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setEngine(opt.value)}
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
                <div>
                  <div className="text-sm font-medium text-[#e2e8f0]">{opt.label}</div>
                  <div className="text-xs text-[#64748b]">{opt.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

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
          ) : (
            'Launch'
          )}
        </button>

        <p className="text-center text-[10px] text-[#475569] mt-4">
          v{__APP_VERSION__ || '0.1.0'}
        </p>
      </div>
    </div>
  );
};

declare const __APP_VERSION__: string | undefined;
