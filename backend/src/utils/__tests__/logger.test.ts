/**
 * Unit tests for logger.ts — redaction patterns and structured logging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redact } from '../logger';

describe('Logger', () => {
  describe('redact', () => {
    it('should redact Anthropic API keys (sk-ant-*)', () => {
      const input = 'Using key sk-ant-api09-abcdef1234567890ABCDEF1234567890';
      const result = redact(input);
      expect(result).not.toContain('abcdef1234567890ABCDEF1234567890');
      expect(result).toContain('sk-ant-api09-abc');
      expect(result).toContain('***');
    });

    it('should redact OpenAI API keys (sk-*)', () => {
      const input = 'key is sk-abc123xyz789longkey';
      const result = redact(input);
      expect(result).not.toContain('xyz789longkey');
      expect(result).toContain('sk-abc123***');
    });

    it('should redact key-* prefixed keys', () => {
      const input = 'Using key-abcdef123456789';
      const result = redact(input);
      expect(result).toContain('key-abcdef***');
      expect(result).not.toContain('123456789');
    });

    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = redact(input);
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should redact proxy URLs with credentials', () => {
      const input = 'Using proxy http://user:p4ssw0rd@proxy.example.com:8080';
      const result = redact(input);
      expect(result).not.toContain('p4ssw0rd');
      expect(result).toContain('[REDACTED]@');
      expect(result).toContain('proxy.example.com');
    });

    it('should redact encrypted values from SecretStore', () => {
      const input = 'Stored: enc:YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=';
      const result = redact(input);
      expect(result).toContain('enc:[ENCRYPTED]');
      expect(result).not.toContain('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=');
    });

    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const input = `Token: ${jwt}`;
      const result = redact(input);
      expect(result).toContain('[JWT_REDACTED]');
      expect(result).not.toContain('dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
    });

    it('should not redact normal text', () => {
      const input = 'This is a normal log message with no secrets';
      expect(redact(input)).toBe(input);
    });

    it('should handle empty string', () => {
      expect(redact('')).toBe('');
    });

    it('should handle multiple sensitive values in one string', () => {
      const input = 'Key: sk-ant-api09-test123456 and proxy http://admin:secret@host:80';
      const result = redact(input);
      expect(result).not.toContain('secret');
      expect(result).toContain('***');
      expect(result).toContain('[REDACTED]@');
    });

    it('should redact Authorization headers', () => {
      const input = 'Authorization: sk-ant-super-secret-long-key-value-here';
      const result = redact(input);
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('Logger class', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      vi.resetModules();
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should log at correct levels', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'info' });

      logger.debug('should not appear');
      logger.info('should appear');
      logger.warn('warning message');
      logger.error('error message');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should log debug when level is debug', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'debug' });

      logger.debug('debug msg');
      expect(debugSpy).toHaveBeenCalledTimes(1);
    });

    it('should suppress all below error when level is error', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'error' });

      logger.debug('nope');
      logger.info('nope');
      logger.warn('nope');
      logger.error('yes');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('should create child loggers with module prefix', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'info' });

      const child = logger.child('myModule');
      child.info('test message');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[myModule]'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('test message'));
    });

    it('should redact sensitive data in log messages', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'info' });

      logger.info('Connecting with key sk-ant-api09-secretkey1234567890');

      const loggedMessage = logSpy.mock.calls[0][0] as string;
      expect(loggedMessage).not.toContain('secretkey1234567890');
      expect(loggedMessage).toContain('***');
    });

    it('should redact sensitive data in log data objects', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'info' });

      logger.info('Config', { apiKey: 'sk-ant-api09-realsecretvalue123' });

      const loggedMessage = logSpy.mock.calls[0][0] as string;
      expect(loggedMessage).not.toContain('realsecretvalue123');
    });

    it('should return null paths when LOG_DIR not set', async () => {
      const { logger } = await import('../logger');
      logger.init({ level: 'info' });

      expect(logger.getLogDir()).toBeNull();
      expect(logger.getLogFilePath()).toBeNull();
    });
  });
});
