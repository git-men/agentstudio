/**
 * Structured Logger with sensitive data redaction.
 *
 * Features:
 *   - Log level control via LOG_LEVEL env var / config
 *   - Automatic redaction of API keys, tokens, proxy credentials
 *   - Optional file output via LOG_DIR env var
 *   - JSON-structured log format for file output
 *   - Console output retains human-readable format
 */

import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// ─── Types ──────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}

// ─── Redaction Patterns ─────────────────────────────────────────────────────

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys (sk-ant-*, sk-*, key-*)
  { pattern: /\b(sk-ant-[a-zA-Z0-9_-]{10})[a-zA-Z0-9_-]*/g, replacement: '$1***' },
  { pattern: /\b(sk-[a-zA-Z0-9]{6})[a-zA-Z0-9]*/g, replacement: '$1***' },
  { pattern: /\b(key-[a-zA-Z0-9]{6})[a-zA-Z0-9]*/g, replacement: '$1***' },

  // Bearer tokens
  { pattern: /(Bearer\s+)[a-zA-Z0-9._\-/+=]{20,}/gi, replacement: '$1[REDACTED]' },
  { pattern: /(Authorization:\s*)[^\s"',}]+/gi, replacement: '$1[REDACTED]' },

  // Proxy URLs with credentials: http://user:pass@host
  { pattern: /(https?:\/\/)([^:]+):([^@]+)@/gi, replacement: '$1$2:[REDACTED]@' },

  // Generic long hex/base64 tokens (40+ chars)
  { pattern: /\b([a-f0-9]{8})[a-f0-9]{32,}\b/gi, replacement: '$1***[REDACTED]' },

  // JWT tokens (three base64 segments separated by dots)
  { pattern: /\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\b/g, replacement: '[JWT_REDACTED]' },

  // Encrypted values from SecretStore
  { pattern: /enc:[a-zA-Z0-9+/=]{20,}/g, replacement: 'enc:[ENCRYPTED]' },
];

/**
 * Redact sensitive data from a string.
 */
export function redact(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep-redact an object by converting to JSON, redacting, and parsing back.
 * Falls back to string redaction if parsing fails.
 */
function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redact(obj);
  if (typeof obj !== 'object') return obj;

  try {
    const json = JSON.stringify(obj);
    return JSON.parse(redact(json));
  } catch {
    return '[Object - redaction failed]';
  }
}

// ─── Logger Class ───────────────────────────────────────────────────────────

class Logger {
  private level: LogLevel = 'info';
  private logDir: string | null = null;
  private logFile: string | null = null;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Initialize the logger. Called once at startup.
   */
  init(options?: { level?: string; logDir?: string }) {
    const level = options?.level || process.env.LOG_LEVEL || 'info';
    if (level in LEVEL_PRIORITY) {
      this.level = level as LogLevel;
    }

    const logDir = options?.logDir || process.env.LOG_DIR;
    if (logDir) {
      this.logDir = logDir;
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
      const date = new Date().toISOString().split('T')[0];
      this.logFile = join(logDir, `agentstudio-${date}.log`);
    }

    this.initialized = true;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private formatConsole(level: LogLevel, module: string, message: string, data?: unknown): string {
    const prefix = `[${module}]`;
    const parts = [prefix, message];

    if (data !== undefined) {
      if (typeof data === 'string') {
        parts.push(data);
      } else if (data instanceof Error) {
        parts.push(data.message);
        if (data.stack) parts.push('\n' + data.stack);
      } else {
        try {
          parts.push(JSON.stringify(data, null, 2));
        } catch {
          parts.push(String(data));
        }
      }
    }

    return parts.join(' ');
  }

  private writeToFile(entry: LogEntry): void {
    if (!this.logFile) return;

    const line = JSON.stringify(entry) + '\n';
    this.writeQueue = this.writeQueue
      .then(() => appendFile(this.logFile!, line, 'utf-8'))
      .catch(() => { /* ignore file write errors */ });
  }

  private log(level: LogLevel, module: string, message: string, data?: unknown): void {
    if (!this.shouldLog(level)) return;

    // Redact sensitive data
    const safeMessage = redact(message);
    const safeData = data !== undefined ? redactObject(data) : undefined;

    // Console output (human-readable)
    const formatted = this.formatConsole(level, module, safeMessage, safeData);
    switch (level) {
      case 'debug': console.debug(formatted); break;
      case 'info': console.log(formatted); break;
      case 'warn': console.warn(formatted); break;
      case 'error': console.error(formatted); break;
    }

    // File output (JSON structured)
    if (this.logFile) {
      this.writeToFile({
        timestamp: new Date().toISOString(),
        level,
        module,
        message: safeMessage,
        ...(safeData !== undefined ? { data: safeData } : {}),
      });
    }
  }

  /**
   * Create a child logger scoped to a module name.
   */
  child(module: string) {
    return {
      debug: (message: string, data?: unknown) => this.log('debug', module, message, data),
      info: (message: string, data?: unknown) => this.log('info', module, message, data),
      warn: (message: string, data?: unknown) => this.log('warn', module, message, data),
      error: (message: string, data?: unknown) => this.log('error', module, message, data),
    };
  }

  debug(message: string, data?: unknown) { this.log('debug', 'app', message, data); }
  info(message: string, data?: unknown) { this.log('info', 'app', message, data); }
  warn(message: string, data?: unknown) { this.log('warn', 'app', message, data); }
  error(message: string, data?: unknown) { this.log('error', 'app', message, data); }

  /**
   * Get current log file path (for IT security log path documentation).
   */
  getLogFilePath(): string | null {
    return this.logFile;
  }

  /**
   * Get log directory path.
   */
  getLogDir(): string | null {
    return this.logDir;
  }
}

// Singleton instance
export const logger = new Logger();

export default logger;
