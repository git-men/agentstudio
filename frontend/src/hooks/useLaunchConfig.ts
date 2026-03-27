import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../lib/environment';

export interface LaunchConfig {
  engine: string;
}

const ENGINE_OPTIONS = [
  { value: 'claude-sdk', label: 'Claude Agent SDK', description: 'Official Claude Code SDK' },
  { value: 'claude-internal-sdk', label: 'Claude Internal', description: 'Claude Internal SDK (~/.claude-internal)' },
  { value: 'codebuddy-sdk', label: 'CodeBuddy', description: 'CodeBuddy SDK engine' },
  { value: 'codex-cli', label: 'Codex CLI', description: 'OpenAI Codex CLI' },
  { value: 'codex-sdk', label: 'Codex SDK', description: 'OpenAI Codex SDK' },
  { value: 'cursor-cli', label: 'Cursor CLI', description: 'Cursor CLI engine' },
] as const;

export { ENGINE_OPTIONS };

export function useLaunchConfig() {
  const [config, setConfig] = useState<LaunchConfig>({ engine: 'claude-sdk' });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const saved = await invoke<LaunchConfig>('load_launch_config');
        if (saved) setConfig(saved);
      } catch (e) {
        console.warn('Failed to load launch config:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const startBackend = useCallback(async (selectedConfig: LaunchConfig) => {
    setStarting(true);
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_backend', {
        engine: selectedConfig.engine,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStarting(false);
      throw e;
    }
  }, []);

  return { config, setConfig, loading, starting, error, startBackend };
}
