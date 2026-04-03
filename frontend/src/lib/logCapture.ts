/**
 * Frontend log capture.
 *
 * Hooks console.log/warn/error/info and window error events,
 * stores the most recent MAX_LINES in a ring buffer.
 * Call `installFrontendLogCapture()` once at app startup,
 * then `getFrontendLogSnapshot()` to retrieve the captured text.
 */

const MAX_LINES = 3000;
const buffer: string[] = [];
let installed = false;

function push(level: string, args: any[]): void {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
  buffer.push(`[${ts}] [${level}] ${msg}`);
  if (buffer.length > MAX_LINES) {
    buffer.splice(0, buffer.length - MAX_LINES);
  }
}

export function installFrontendLogCapture(): void {
  if (installed) return;
  installed = true;

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;

  console.log = (...args: any[]) => { origLog.apply(console, args); push('LOG', args); };
  console.warn = (...args: any[]) => { origWarn.apply(console, args); push('WARN', args); };
  console.error = (...args: any[]) => { origError.apply(console, args); push('ERROR', args); };
  console.info = (...args: any[]) => { origInfo.apply(console, args); push('INFO', args); };

  window.addEventListener('error', (ev) => {
    push('UNCAUGHT', [`${ev.message} at ${ev.filename}:${ev.lineno}:${ev.colno}`]);
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    push('UNHANDLED_REJECTION', [reason]);
  });
}

export function getFrontendLogSnapshot(): string {
  return buffer.join('\n');
}
