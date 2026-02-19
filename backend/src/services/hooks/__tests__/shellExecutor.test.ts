import { describe, it, expect } from 'vitest';
import { join, resolve } from 'path';
import { realpathSync } from 'fs';
import { tmpdir } from 'os';
import { ShellExecutor } from '../executors/shellExecutor.js';
import type { HookEvent, PlatformHook } from '../../../types/platformHooks.js';

function makeEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'run.end',
    timestamp: new Date().toISOString(),
    source: 'TestRunner',
    data: { engine: 'claude' },
    sessionId: 'sess-1',
    projectId: 'proj-1',
    ...overrides,
  };
}

function makeShellHook(command: string, overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-shell',
    name: 'Test Shell Hook',
    enabled: true,
    event: 'run.end',
    action: { type: 'shell', command },
    scope: 'global',
    timeout: 5000,
    failurePolicy: 'warn',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ShellExecutor', () => {
  const executor = new ShellExecutor();

  it('should execute simple command successfully', async () => {
    const hook = makeShellHook('echo hello');
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.output).toContain('hello');
    expect(result.exitCode).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
  }, { timeout: 15000 });

  it('should return failure for non-zero exit code', async () => {
    const hook = makeShellHook('exit 1');
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  }, { timeout: 15000 });

  it('should kill process on timeout', async () => {
    const hook = makeShellHook('sleep 60');
    const result = await executor.execute(hook, makeEvent(), { timeout: 500 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain('timed out');
  }, { timeout: 10000 });

  it('should pass HOOK_EVENT env var with serialized event', async () => {
    const event = makeEvent({ data: { engine: 'claude', custom: 'value' } });
    const hook = makeShellHook('echo $HOOK_EVENT');
    const result = await executor.execute(hook, event, { timeout: 10000 });

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output!.trim());
    expect(parsed.type).toBe('run.end');
    expect(parsed.data.engine).toBe('claude');
    expect(parsed.data.custom).toBe('value');
  }, { timeout: 15000 });

  it('should respect custom cwd', async () => {
    const hook = makeShellHook('pwd', {
      action: { type: 'shell', command: 'pwd', cwd: tmpdir() },
    });
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output!.trim()).toBe(realpathSync(tmpdir()));
  }, { timeout: 15000 });

  it('should pass custom env vars', async () => {
    const hook = makeShellHook('echo $MY_VAR', {
      action: { type: 'shell', command: 'echo $MY_VAR', env: { MY_VAR: 'custom-value' } },
    });
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output!.trim()).toBe('custom-value');
  }, { timeout: 15000 });

  it('should capture stderr', async () => {
    const hook = makeShellHook('echo error-msg >&2');
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('error-msg');
  }, { timeout: 15000 });
});
