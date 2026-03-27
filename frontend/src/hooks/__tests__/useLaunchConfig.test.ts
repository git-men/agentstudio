import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLaunchConfig, ENGINE_OPTIONS } from '../useLaunchConfig';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../../lib/environment', () => ({
  isTauri: () => true,
}));

describe('useLaunchConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return Promise.resolve();
      }
      return Promise.resolve();
    });
  });

  it('loads config on mount', async () => {
    const { result } = renderHook(() => useLaunchConfig());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('load_launch_config');
    expect(result.current.config).toEqual({ engine: 'claude-sdk' });
  });

  it('exports engine option constants including claude-internal-sdk', () => {
    expect(ENGINE_OPTIONS.length).toBeGreaterThan(0);

    const engineValues = ENGINE_OPTIONS.map(e => e.value);
    expect(engineValues).toContain('claude-sdk');
    expect(engineValues).toContain('claude-internal-sdk');
    expect(engineValues).toContain('codebuddy-sdk');
    expect(engineValues).toContain('codex-cli');
    expect(engineValues).toContain('cursor-cli');
  });

  it('starts backend with engine only (no sdk)', async () => {
    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.startBackend({ engine: 'claude-internal-sdk' });
    });

    expect(mockInvoke).toHaveBeenCalledWith('start_backend', {
      engine: 'claude-internal-sdk',
    });
  });

  it('sets starting=true while invoke is pending', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return new Promise(() => {}); // never resolves
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.startBackend({ engine: 'claude-sdk' });
    });

    await waitFor(() => {
      expect(result.current.starting).toBe(true);
    });

    expect(result.current.error).toBeNull();
  });

  it('sets error and re-throws on start failure', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'start_backend') {
        return Promise.reject(new Error('Backend crashed'));
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(
        result.current.startBackend({ engine: 'claude-sdk' }),
      ).rejects.toThrow('Backend crashed');
    });

    expect(result.current.error).toBe('Backend crashed');
    expect(result.current.starting).toBe(false);
  });

  it('updates config via setConfig', async () => {
    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setConfig({ engine: 'codex-cli' });
    });

    expect(result.current.config).toEqual({ engine: 'codex-cli' });
  });

  it('handles load failure gracefully', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.reject(new Error('Config not found'));
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toEqual({ engine: 'claude-sdk' });
  });
});
