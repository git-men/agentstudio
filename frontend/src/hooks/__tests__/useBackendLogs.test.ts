import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBackendLogs } from '../useBackendLogs';

const mockUnlisten = vi.fn();
const mockListen = vi.fn(() => Promise.resolve(mockUnlisten));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('../../lib/environment', () => ({
  isTauri: () => true,
}));

const mockGetCapturedLogs = vi.fn(() => [] as Array<{ level: string; message: string; timestamp: string }>);
const mockClearCapturedLogs = vi.fn();
const mockOnConsoleEntry = vi.fn(() => () => {});
vi.mock('../../utils/consoleCapture', () => ({
  getCapturedLogs: () => mockGetCapturedLogs(),
  clearCapturedLogs: () => mockClearCapturedLogs(),
  onConsoleEntry: (cb: unknown) => mockOnConsoleEntry(cb),
}));

describe('useBackendLogs', () => {
  let backendLogCallback: ((event: { payload: Array<{ level: string; message: string }> }) => void) | null = null;
  let consoleEntryCallback: ((entry: { level: string; message: string; timestamp: string }) => void) | null = null;

  beforeEach(() => {
    backendLogCallback = null;
    consoleEntryCallback = null;
    mockListen.mockClear();
    mockUnlisten.mockClear();
    mockGetCapturedLogs.mockClear();
    mockClearCapturedLogs.mockClear();
    mockOnConsoleEntry.mockClear();

    mockGetCapturedLogs.mockReturnValue([]);

    mockListen.mockImplementation((_event: string, callback: typeof backendLogCallback) => {
      backendLogCallback = callback;
      return Promise.resolve(mockUnlisten);
    });

    mockOnConsoleEntry.mockImplementation((cb: typeof consoleEntryCallback) => {
      consoleEntryCallback = cb;
      return () => {};
    });
  });

  it('initializes with empty logs and hidden state', () => {
    const { result } = renderHook(() => useBackendLogs());

    expect(result.current.logs).toEqual([]);
    expect(result.current.frontendLogs).toEqual([]);
    expect(result.current.visible).toBe(false);
  });

  it('subscribes to backend-log-batch events', async () => {
    renderHook(() => useBackendLogs());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('backend-log-batch', expect.any(Function));
    });
  });

  it('subscribes to console entry events', () => {
    renderHook(() => useBackendLogs());

    expect(mockOnConsoleEntry).toHaveBeenCalledWith(expect.any(Function));
  });

  it('processes backend log batch events', async () => {
    const { result } = renderHook(() => useBackendLogs());

    await waitFor(() => {
      expect(backendLogCallback).not.toBeNull();
    });

    act(() => {
      backendLogCallback!({
        payload: [
          { level: 'stdout', message: 'hello world' },
          { level: 'stderr', message: 'a warning' },
        ],
      });
    });

    expect(result.current.logs).toHaveLength(2);
    expect(result.current.logs[0].message).toBe('hello world');
    expect(result.current.logs[0].source).toBe('backend');
    expect(result.current.logs[1].level).toBe('stderr');
  });

  it('strips trailing newline from backend log messages', async () => {
    const { result } = renderHook(() => useBackendLogs());

    await waitFor(() => {
      expect(backendLogCallback).not.toBeNull();
    });

    act(() => {
      backendLogCallback!({
        payload: [{ level: 'stdout', message: 'line with newline\n' }],
      });
    });

    expect(result.current.logs[0].message).toBe('line with newline');
  });

  it('processes frontend console entries', () => {
    const { result } = renderHook(() => useBackendLogs());

    act(() => {
      consoleEntryCallback?.({
        level: 'log',
        message: 'Test message',
        timestamp: new Date().toISOString(),
      });
    });

    expect(result.current.frontendLogs).toHaveLength(1);
    expect(result.current.frontendLogs[0].level).toBe('log');
    expect(result.current.frontendLogs[0].source).toBe('frontend');
  });

  it('toggles visibility', () => {
    const { result } = renderHook(() => useBackendLogs());

    act(() => result.current.setVisible(true));
    expect(result.current.visible).toBe(true);

    act(() => result.current.setVisible(false));
    expect(result.current.visible).toBe(false);
  });

  it('provides toggleVisible helper', () => {
    const { result } = renderHook(() => useBackendLogs());

    act(() => result.current.toggleVisible());
    expect(result.current.visible).toBe(true);

    act(() => result.current.toggleVisible());
    expect(result.current.visible).toBe(false);
  });

  it('clears backend logs', async () => {
    const { result } = renderHook(() => useBackendLogs());

    await waitFor(() => {
      expect(backendLogCallback).not.toBeNull();
    });

    act(() => {
      backendLogCallback!({
        payload: [{ level: 'stdout', message: 'something' }],
      });
    });
    expect(result.current.logs).toHaveLength(1);

    act(() => result.current.clearLogs());
    expect(result.current.logs).toEqual([]);
  });

  it('clears frontend logs and captured buffer', () => {
    const { result } = renderHook(() => useBackendLogs());

    act(() => {
      consoleEntryCallback?.({
        level: 'warn',
        message: 'Warning!',
        timestamp: new Date().toISOString(),
      });
    });
    expect(result.current.frontendLogs).toHaveLength(1);

    act(() => result.current.clearFrontendLogs());
    expect(result.current.frontendLogs).toEqual([]);
    expect(mockClearCapturedLogs).toHaveBeenCalled();
  });

  it('loads existing captured logs on mount', () => {
    mockGetCapturedLogs.mockReturnValue([
      { level: 'log', message: 'pre-existing', timestamp: '2026-01-01T00:00:00Z' },
    ]);

    const { result } = renderHook(() => useBackendLogs());

    expect(result.current.frontendLogs).toHaveLength(1);
    expect(result.current.frontendLogs[0].message).toBe('pre-existing');
    expect(result.current.frontendLogs[0].source).toBe('frontend');
  });
});
