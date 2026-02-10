/**
 * Tests for ScriptExecutor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptExecutor } from './script-executor.js';
import { ScriptHandler, ExecutionContext, LAVSError, LAVSErrorCode } from './types.js';

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    endpointId: 'test-endpoint',
    agentId: 'test-agent',
    workdir: process.cwd(),
    permissions: {},
    ...overrides,
  };
}

describe('ScriptExecutor', () => {
  let executor: ScriptExecutor;

  beforeEach(() => {
    executor = new ScriptExecutor();
  });

  // ─── Basic execution ─────────────────────────────────────

  describe('basic execution', () => {
    it('should execute a simple command and return JSON', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        args: ['{"result": "ok"}'],
        input: 'args',
      };
      const result = await executor.execute(handler, null, makeContext());
      expect(result).toEqual({ result: 'ok' });
    });

    it('should return null for empty output', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        args: ['-n', ''],
        input: 'args',
      };
      const result = await executor.execute(handler, null, makeContext());
      expect(result).toBeNull();
    });

    it('should handle array JSON output', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        args: ['[1, 2, 3]'],
        input: 'args',
      };
      const result = await executor.execute(handler, null, makeContext());
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ─── stdin input mode ────────────────────────────────────

  describe('stdin input mode', () => {
    it('should pass input via stdin as JSON', async () => {
      // Use node to read stdin and echo it back
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', `
          let data = '';
          process.stdin.on('data', (chunk) => data += chunk);
          process.stdin.on('end', () => {
            const parsed = JSON.parse(data);
            console.log(JSON.stringify({ received: parsed }));
          });
        `],
        input: 'stdin',
      };
      const input = { text: 'hello', priority: 1 };
      const result = await executor.execute(handler, input, makeContext());
      expect(result).toEqual({ received: { text: 'hello', priority: 1 } });
    });
  });

  // ─── env input mode ──────────────────────────────────────

  describe('env input mode', () => {
    it('should pass input as environment variables', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify({ name: process.env.NAME, age: process.env.AGE }))'],
        input: 'env',
      };
      const input = { name: 'Alice', age: 30 };
      const result = await executor.execute(handler, input, makeContext());
      expect(result).toEqual({ name: 'Alice', age: '30' }); // env vars are strings
    });
  });

  // ─── args input mode with templates ──────────────────────

  describe('args input mode', () => {
    it('should resolve {{template}} in args', async () => {
      // With node -e, extra args start at process.argv[1]
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify({ arg: process.argv[1] }))', '{{name}}'],
        input: 'args',
      };
      const result = await executor.execute(handler, { name: 'Bob' }, makeContext());
      expect(result).toEqual({ arg: 'Bob' });
    });
  });

  // ─── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('should throw HandlerError for non-zero exit code', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'process.exit(1)'],
      };

      try {
        await executor.execute(handler, null, makeContext());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
        expect((err as LAVSError).message).toContain('exited with code 1');
      }
    });

    it('should throw HandlerError for non-JSON output', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        args: ['not json at all'],
      };

      try {
        await executor.execute(handler, null, makeContext());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
        expect((err as LAVSError).message).toContain('not valid JSON');
      }
    });

    it('should throw Timeout for scripts exceeding timeout', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        timeout: 500, // 500ms timeout
      };

      try {
        await executor.execute(handler, null, makeContext());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.Timeout);
      }
    }, 10000);

    it('should throw HandlerError for non-existent command', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'nonexistent-command-12345',
      };

      try {
        await executor.execute(handler, null, makeContext());
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.HandlerError);
      }
    });
  });

  // ─── Environment variable filtering ──────────────────────

  describe('environment variables', () => {
    it('should pass safe environment variables like PATH and HOME', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify({ hasPath: !!process.env.PATH, hasHome: !!process.env.HOME }))'],
      };
      const result = await executor.execute(handler, null, makeContext());
      expect(result.hasPath).toBe(true);
      expect(result.hasHome).toBe(true);
    });

    it('should pass handler-declared env vars', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify({ custom: process.env.MY_CUSTOM_VAR }))'],
        env: { MY_CUSTOM_VAR: 'hello' },
      };
      const result = await executor.execute(handler, null, makeContext());
      expect(result.custom).toBe('hello');
    });

    it('should pass context env vars', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', 'console.log(JSON.stringify({ project: process.env.LAVS_PROJECT_PATH }))'],
      };
      const result = await executor.execute(handler, null, makeContext({
        env: { LAVS_PROJECT_PATH: '/my/project' },
      }));
      expect(result.project).toBe('/my/project');
    });
  });

  // ─── Sensitive env var filtering ───────────────────────────

  describe('sensitive environment variable filtering', () => {
    it('should filter out sensitive variables from inherited env', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', `
          const vars = Object.keys(process.env).filter(k =>
            k.includes('SECRET') || k.includes('TOKEN') || k.includes('API_KEY') || k.includes('PASSWORD')
          );
          console.log(JSON.stringify({ sensitiveVars: vars }));
        `],
      };

      // Even if host has these, they should be filtered
      const originalEnv = { ...process.env };
      process.env.OPENAI_API_KEY = 'sk-test123';
      process.env.MY_SECRET_VALUE = 'secret';
      process.env.DB_PASSWORD = 'pass123';

      try {
        const result = await executor.execute(handler, null, makeContext());
        expect(result.sensitiveVars).toEqual([]);
      } finally {
        // Restore
        if (!originalEnv.OPENAI_API_KEY) delete process.env.OPENAI_API_KEY;
        if (!originalEnv.MY_SECRET_VALUE) delete process.env.MY_SECRET_VALUE;
        if (!originalEnv.DB_PASSWORD) delete process.env.DB_PASSWORD;
      }
    });

    it('should pass LAVS context variables', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', `console.log(JSON.stringify({
          agentId: process.env.LAVS_AGENT_ID,
          endpointId: process.env.LAVS_ENDPOINT_ID,
        }))`],
      };
      const result = await executor.execute(handler, null, makeContext({
        agentId: 'my-agent',
        endpointId: 'my-endpoint',
      }));
      expect(result.agentId).toBe('my-agent');
      expect(result.endpointId).toBe('my-endpoint');
    });
  });

  // ─── filterSensitiveVars unit test ───────────────────────

  describe('filterSensitiveVars', () => {
    it('should remove vars matching sensitive patterns', () => {
      const env = {
        PATH: '/usr/bin',
        HOME: '/home/user',
        OPENAI_API_KEY: 'sk-test',
        MY_SECRET: 'hidden',
        DB_PASSWORD: 'pass',
        AWS_ACCESS_KEY: 'AKIA...',
        AUTH_TOKEN: 'abc',
        MY_CREDENTIAL: 'cred',
      };
      const filtered = executor.filterSensitiveVars(env);
      expect(filtered.PATH).toBe('/usr/bin');
      expect(filtered.HOME).toBe('/home/user');
      expect(filtered.OPENAI_API_KEY).toBeUndefined();
      expect(filtered.MY_SECRET).toBeUndefined();
      expect(filtered.DB_PASSWORD).toBeUndefined();
      expect(filtered.AWS_ACCESS_KEY).toBeUndefined();
      expect(filtered.AUTH_TOKEN).toBeUndefined();
      expect(filtered.MY_CREDENTIAL).toBeUndefined();
    });

    it('should preserve LAVS safe overrides', () => {
      const env = {
        LAVS_AGENT_ID: 'agent1',
        LAVS_ENDPOINT_ID: 'ep1',
        LAVS_PROJECT_PATH: '/project',
        NODE_ENV: 'test',
      };
      const filtered = executor.filterSensitiveVars(env);
      expect(filtered).toEqual(env);
    });

    it('should preserve non-sensitive custom vars', () => {
      const env = {
        MY_CUSTOM_VAR: 'hello',
        DATA_DIR: '/data',
        FEATURE_FLAG: 'on',
      };
      const filtered = executor.filterSensitiveVars(env);
      expect(filtered).toEqual(env);
    });
  });

  // ─── JSON extraction from noisy output ───────────────────

  describe('JSON extraction', () => {
    it('should extract JSON from output with extra text', async () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['-e', `
          console.error('Loading...');
          console.log('Some prefix text');
          console.log(JSON.stringify({ data: 42 }));
          console.log('Some suffix text');
        `],
      };
      // The script outputs non-JSON lines too, but parseOutput should extract JSON
      // Note: since the whole stdout is not valid JSON, it will try to extract { ... }
      const result = await executor.execute(handler, null, makeContext());
      expect(result).toEqual({ data: 42 });
    });
  });
});
