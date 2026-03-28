import { useState, useEffect, useCallback } from 'react';
import { isTauri } from '../lib/environment';

export interface LaunchConfig {
  engine: string;
}

export interface EngineOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly cliName?: string;
  readonly npmPackage?: string;
  readonly installCmd?: string;
  readonly internalOnly?: boolean;
  readonly internalDomain?: string;
}

const ENGINE_OPTIONS: EngineOption[] = [
  {
    value: 'claude-sdk',
    label: 'Claude Agent SDK',
    description: 'Official Claude Code SDK',
    cliName: 'claude',
    npmPackage: '@anthropic-ai/claude-code',
  },
  {
    value: 'claude-internal-sdk',
    label: 'Claude Internal',
    description: 'Claude Internal SDK (~/.claude-internal)',
    cliName: 'claude-internal',
    npmPackage: '@tencent/claude-code-internal',
    internalOnly: true,
    internalDomain: 'agentstudio.woa.com',
  },
  {
    value: 'codebuddy-sdk',
    label: 'CodeBuddy',
    description: 'CodeBuddy Agent SDK',
    cliName: 'codebuddy',
    npmPackage: '@tencent-ai/codebuddy-code',
  },
  {
    value: 'codex-cli',
    label: 'Codex CLI',
    description: 'OpenAI Codex CLI',
    cliName: 'codex',
    npmPackage: '@openai/codex',
  },
  {
    value: 'codex-sdk',
    label: 'Codex SDK',
    description: 'OpenAI Codex SDK',
    cliName: 'codex',
    npmPackage: '@openai/codex',
  },
  {
    value: 'cursor-cli',
    label: 'Cursor CLI',
    description: 'Cursor Agent CLI',
    cliName: 'agent',
    installCmd: 'curl https://cursor.com/install -fsS | bash',
  },
];

export { ENGINE_OPTIONS };

export function useLaunchConfig() {
  const [config, setConfig] = useState<LaunchConfig>({ engine: 'claude-sdk' });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalAccessible, setInternalAccessible] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        const [saved, accessible] = await Promise.all([
          invoke<LaunchConfig>('load_launch_config').catch(() => null),
          invoke<boolean>('check_domain_accessible', { domain: 'agentstudio.woa.com' }).catch(() => false),
        ]);

        if (saved) setConfig(saved);
        setInternalAccessible(accessible);
      } catch (e) {
        console.warn('Failed to load launch config:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const availableEngines = ENGINE_OPTIONS.filter((opt) => {
    if (opt.internalOnly && internalAccessible === false) return false;
    return true;
  });

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

  return { config, setConfig, loading, starting, error, startBackend, availableEngines, internalAccessible };
}
