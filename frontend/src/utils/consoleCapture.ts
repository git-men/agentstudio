/**
 * consoleCapture
 *
 * Intercepts browser console methods (log, warn, error, info, debug) and
 * stores recent entries in a bounded ring buffer so the AI agent can read
 * them via the `collect_console_logs` frontend tool.
 *
 * Call `startConsoleCapture()` once at app startup.
 * Call `getCapturedLogs()` to retrieve current entries.
 * Call `clearCapturedLogs()` to reset the buffer.
 */

export type LogLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export interface CapturedLogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
}

const MAX_ENTRIES = 200;
const capturedLogs: CapturedLogEntry[] = [];
let capturing = false;

/** Stringify console args the same way DevTools would (roughly). */
function argsToString(args: unknown[]): string {
  return args
    .map(a => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a, null, 0);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * Start intercepting console output.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function startConsoleCapture(): void {
  if (capturing) return;
  capturing = true;

  const levels: LogLevel[] = ['log', 'warn', 'error', 'info', 'debug'];

  for (const level of levels) {
    const original = console[level].bind(console);

    console[level] = (...args: unknown[]) => {
      original(...args);

      const entry: CapturedLogEntry = {
        level,
        message: argsToString(args),
        timestamp: new Date().toISOString(),
      };

      capturedLogs.push(entry);
      // Keep the buffer bounded
      if (capturedLogs.length > MAX_ENTRIES) {
        capturedLogs.splice(0, capturedLogs.length - MAX_ENTRIES);
      }
    };
  }
}

/** Return a copy of captured entries, newest last. */
export function getCapturedLogs(limit?: number): CapturedLogEntry[] {
  const all = [...capturedLogs];
  return limit ? all.slice(-limit) : all;
}

/** Clear the capture buffer. */
export function clearCapturedLogs(): void {
  capturedLogs.length = 0;
}
