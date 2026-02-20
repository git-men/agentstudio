import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ScriptExecutor } from '../executors/scriptExecutor.js';
import type { HookContext, PlatformHook } from '../../../types/platformHooks.js';

let testDir: string;
const executor = new ScriptExecutor();

function makeContext(overrides: Partial<HookContext> = {}): HookContext {
  return {
    event: {
      type: 'message.pre_send',
      timestamp: new Date().toISOString(),
      source: 'TestRunner',
    },
    session: {
      sessionId: 'sess-1',
      projectId: 'proj-1',
    },
    data: {
      message: 'hello world',
    },
    hookId: 'hook_test-script',
    hookName: 'Test Script Hook',
    timeout: 5000,
    ...overrides,
  };
}

function makeScriptHook(scriptPath: string, overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-script',
    name: 'Test Script Hook',
    enabled: true,
    event: 'message.pre_send',
    action: { type: 'script', path: scriptPath, runtime: 'node' as const },
    scope: 'global',
    timeout: 5000,
    failurePolicy: 'warn',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ScriptExecutor.executeInterceptor', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `script-interceptor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return "allow" decision from a successful script', async () => {
    const scriptPath = join(testDir, 'allow.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        return { decision: 'allow' };
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.decision).toBeDefined();
    expect(result.decision!.decision).toBe('allow');
  }, { timeout: 15000 });

  it('should return "block" decision with reason', async () => {
    const scriptPath = join(testDir, 'block.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        return { decision: 'block', reason: 'Contains sensitive data' };
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.decision!.decision).toBe('block');
    expect(result.decision!.reason).toBe('Contains sensitive data');
  }, { timeout: 15000 });

  it('should return "rewrite" decision with rewrittenMessage', async () => {
    const scriptPath = join(testDir, 'rewrite.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        return {
          decision: 'rewrite',
          rewrittenMessage: context.data.message + ' [sanitized]',
        };
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.decision!.decision).toBe('rewrite');
    expect(result.decision!.rewrittenMessage).toBe('hello world [sanitized]');
  }, { timeout: 15000 });

  it('should return failed result when script throws an error', async () => {
    const scriptPath = join(testDir, 'throw.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        throw new Error('Script exploded');
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('Script exploded');
  }, { timeout: 15000 });

  it('should return failed result when script returns invalid decision', async () => {
    const scriptPath = join(testDir, 'invalid.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        return { decision: 'invalid_value' };
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid HookDecision');
  }, { timeout: 15000 });

  it('should return failed result when module is not found', async () => {
    const scriptPath = join(testDir, 'nonexistent.mjs');
    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toContain('Module not found');
  }, { timeout: 15000 });

  it('should return timed out result when script exceeds timeout', async () => {
    const scriptPath = join(testDir, 'slow.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return { decision: 'allow' };
      }
    `);

    const hook = makeScriptHook(scriptPath, { timeout: 200 });
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 200 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
  }, { timeout: 15000 });

  it('should return error for invalid action type', async () => {
    const hook = makeScriptHook('/tmp/test.js', {
      action: { type: 'webhook', url: 'http://example.com' } as any,
    });

    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid action type');
  });

  it('should return error when module has no default export function', async () => {
    const scriptPath = join(testDir, 'noexport.mjs');
    await fs.writeFile(scriptPath, `
      export const notAFunction = 'hello';
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('no default export function');
  }, { timeout: 15000 });

  it('should include rawOutput in result', async () => {
    const scriptPath = join(testDir, 'raw.mjs');
    await fs.writeFile(scriptPath, `
      export default async function(context) {
        return { decision: 'allow', reason: 'all good' };
      }
    `);

    const hook = makeScriptHook(scriptPath);
    const result = await executor.executeInterceptor(hook, makeContext(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.rawOutput).toBeDefined();
    expect(result.rawOutput).toContain('allow');
  }, { timeout: 15000 });
});
