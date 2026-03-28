import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Since consoleCapture modifies global console state and uses module-level
 * variables, we need to re-import it fresh for each test group using
 * vi.resetModules(). This file tests the exported functions directly.
 */

describe('consoleCapture', () => {
  let originalConsole: Record<string, (...args: unknown[]) => void>;

  beforeEach(() => {
    vi.resetModules();
    originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
  });

  it('getCapturedLogs returns empty array before capture starts', async () => {
    const { getCapturedLogs } = await import('../consoleCapture');
    expect(getCapturedLogs()).toEqual([]);
  });

  it('captures console.log entries after startConsoleCapture', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    console.log('test message');

    const logs = getCapturedLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('log');
    expect(logs[0].message).toBe('test message');
    expect(logs[0].timestamp).toBeTruthy();
  });

  it('captures multiple log levels', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    console.log('log msg');
    console.warn('warn msg');
    console.error('error msg');
    console.info('info msg');
    console.debug('debug msg');

    const logs = getCapturedLogs();
    expect(logs).toHaveLength(5);
    expect(logs.map(l => l.level)).toEqual(['log', 'warn', 'error', 'info', 'debug']);
  });

  it('stringifies non-string arguments', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    console.log('count:', 42, { key: 'val' });

    const logs = getCapturedLogs();
    expect(logs[0].message).toBe('count: 42 {"key":"val"}');
  });

  it('clearCapturedLogs empties the buffer', async () => {
    const { startConsoleCapture, getCapturedLogs, clearCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    console.log('first');
    console.log('second');
    expect(getCapturedLogs()).toHaveLength(2);

    clearCapturedLogs();
    expect(getCapturedLogs()).toHaveLength(0);
  });

  it('getCapturedLogs respects limit parameter', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    for (let i = 0; i < 10; i++) {
      console.log(`message ${i}`);
    }

    const last3 = getCapturedLogs(3);
    expect(last3).toHaveLength(3);
    expect(last3[0].message).toBe('message 7');
    expect(last3[2].message).toBe('message 9');
  });

  it('onConsoleEntry receives new entries in real-time', async () => {
    const { startConsoleCapture, onConsoleEntry } = await import('../consoleCapture');
    startConsoleCapture();

    const received: unknown[] = [];
    const unsub = onConsoleEntry((entry) => received.push(entry));

    console.log('live entry');

    expect(received).toHaveLength(1);
    expect((received[0] as { message: string }).message).toBe('live entry');

    unsub();

    console.log('after unsub');
    expect(received).toHaveLength(1);
  });

  it('multiple listeners receive the same entries', async () => {
    const { startConsoleCapture, onConsoleEntry } = await import('../consoleCapture');
    startConsoleCapture();

    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = onConsoleEntry((e) => a.push(e));
    const unsubB = onConsoleEntry((e) => b.push(e));

    console.warn('shared');

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    unsubA();
    unsubB();
  });

  it('startConsoleCapture is idempotent', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();
    startConsoleCapture();
    startConsoleCapture();

    console.log('once');

    expect(getCapturedLogs()).toHaveLength(1);
  });

  it('returns copies from getCapturedLogs', async () => {
    const { startConsoleCapture, getCapturedLogs } = await import('../consoleCapture');
    startConsoleCapture();

    console.log('entry');

    const first = getCapturedLogs();
    const second = getCapturedLogs();
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
