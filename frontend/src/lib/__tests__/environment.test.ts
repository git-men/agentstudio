/**
 * Unit tests for frontend/src/lib/environment.ts
 *
 * Tests:
 *  1. Web (browser) mode returns a static URL immediately
 *  2. Tauri mode polls invoke('get_backend_port') until the port is ready
 *  3. Tauri mode throws after 30-second timeout (mocked to ms)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

function setTauriInternals(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
      writable: true,
    });
  } else {
    // @ts-expect-error - removing property for test purposes
    delete window.__TAURI_INTERNALS__;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('isTauri()', () => {
  afterEach(() => {
    setTauriInternals(false);
    vi.resetModules();
  });

  it('returns false when __TAURI_INTERNALS__ is absent (browser mode)', async () => {
    setTauriInternals(false);
    const { isTauri } = await import('../environment');
    expect(isTauri()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ is present (Tauri mode)', async () => {
    setTauriInternals(true);
    const { isTauri } = await import('../environment');
    expect(isTauri()).toBe(true);
  });
});

describe('getBackendBaseUrl() — Web mode', () => {
  beforeEach(() => {
    setTauriInternals(false);
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns static URL with default port 4936 immediately', async () => {
    const { getBackendBaseUrl } = await import('../environment');
    const url = await getBackendBaseUrl();
    expect(url).toBe('http://127.0.0.1:4936');
  });
});

describe('getBackendBaseUrl() — Tauri mode', () => {
  beforeEach(() => {
    setTauriInternals(true);
    vi.resetModules();
  });

  afterEach(() => {
    setTauriInternals(false);
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('polls invoke until port is ready and returns correct URL', async () => {
    // First two calls return null, third returns 4936
    const mockInvoke = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(4936);

    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

    const { getBackendBaseUrl } = await import('../environment');
    const url = await getBackendBaseUrl();

    expect(url).toBe('http://127.0.0.1:4936');
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenCalledWith('get_backend_port');
  });

  it('throws after timeout when port never becomes available', async () => {
    // Always returns null — simulates a hung sidecar
    const mockInvoke = vi.fn().mockResolvedValue(null);
    vi.doMock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

    // Advance Date.now by 31 seconds on every call to exhaust the 30-second
    // timeout without waiting in real time. The delay() calls still await
    // microtask/Promise resolution, so we advance far enough that the loop
    // exits on the first check after the initial tick.
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call (loop condition check before first iteration) returns 0;
      // second call returns 31000 ms to trigger the timeout immediately.
      return callCount <= 1 ? 0 : 31_000;
    });

    const { getBackendBaseUrl } = await import('../environment');

    await expect(getBackendBaseUrl()).rejects.toThrow(
      /failed to start within/i,
    );
  }, 10_000);
});
