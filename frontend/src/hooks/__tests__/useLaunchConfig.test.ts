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
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
      }
      if (cmd === 'start_backend') {
        return Promise.resolve();
      }
      return Promise.resolve();
    });
  });

  it('loads config and checks domain on mount', async () => {
    const { result } = renderHook(() => useLaunchConfig());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockInvoke).toHaveBeenCalledWith('load_launch_config');
    expect(mockInvoke).toHaveBeenCalledWith('check_domain_accessible', { domain: 'agentstudio.woa.com' });
    expect(result.current.config).toEqual({ engine: 'claude-sdk' });
    expect(result.current.internalAccessible).toBe(true);
  });

  it('exports engine options including claude-internal-sdk with metadata', () => {
    expect(ENGINE_OPTIONS.length).toBeGreaterThan(0);

    const internal = ENGINE_OPTIONS.find(e => e.value === 'claude-internal-sdk');
    expect(internal).toBeTruthy();
    expect(internal!.cliName).toBe('claude-internal');
    expect(internal!.npmPackage).toBe('@anthropic-ai/claude-code-internal');
    expect(internal!.internalOnly).toBe(true);
    expect(internal!.internalDomain).toBe('agentstudio.woa.com');
  });

  it('filters out internal engine when domain is not accessible', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.resolve({ engine: 'claude-sdk' });
      }
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(false);
      }
      return Promise.resolve();
    });

    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.internalAccessible).toBe(false);
    const internalInList = result.current.availableEngines.find(e => e.value === 'claude-internal-sdk');
    expect(internalInList).toBeUndefined();
  });

  it('includes internal engine when domain is accessible', async () => {
    const { result } = renderHook(() => useLaunchConfig());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const internalInList = result.current.availableEngines.find(e => e.value === 'claude-internal-sdk');
    expect(internalInList).toBeTruthy();
  });

  it('starts backend with engine only', async () => {
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
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
      }
      if (cmd === 'start_backend') {
        return new Promise(() => {});
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
      if (cmd === 'check_domain_accessible') {
        return Promise.resolve(true);
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

  it('handles load failure gracefully', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'load_launch_config') {
        return Promise.reject(new Error('Config not found'));
      }
      if (cmd === 'check_domain_accessible') {
        return Promise.reject(new Error('Network error'));
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
