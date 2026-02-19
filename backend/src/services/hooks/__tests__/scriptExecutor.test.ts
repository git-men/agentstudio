import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ScriptExecutor } from '../executors/scriptExecutor.js';
import type { HookEvent, PlatformHook } from '../../../types/platformHooks.js';

let testDir: string;
const executor = new ScriptExecutor();

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

function makeScriptHook(scriptPath: string, overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-script',
    name: 'Test Script Hook',
    enabled: true,
    event: 'run.end',
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

describe('ScriptExecutor', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `script-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should execute valid .js file successfully', async () => {
    const scriptPath = join(testDir, 'test.js');
    await fs.writeFile(scriptPath, 'console.log("script-output");');

    const hook = makeScriptHook(scriptPath);
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('script-output');
    expect(result.exitCode).toBe(0);
  }, { timeout: 15000 });

  it('should return failure for script that exits non-zero', async () => {
    const scriptPath = join(testDir, 'fail.js');
    await fs.writeFile(scriptPath, 'process.exit(1);');

    const hook = makeScriptHook(scriptPath);
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  }, { timeout: 15000 });

  it('should return error for non-existent file', async () => {
    const hook = makeScriptHook(join(testDir, 'nonexistent.js'));
    const result = await executor.execute(hook, makeEvent(), { timeout: 5000 });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should kill long-running script on timeout', async () => {
    const scriptPath = join(testDir, 'slow.js');
    await fs.writeFile(scriptPath, 'setTimeout(() => {}, 60000);');

    const hook = makeScriptHook(scriptPath);
    const result = await executor.execute(hook, makeEvent(), { timeout: 500 });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  }, { timeout: 10000 });

  it('should pass event JSON as CLI argument', async () => {
    const scriptPath = join(testDir, 'args.js');
    await fs.writeFile(scriptPath, `
      const event = JSON.parse(process.argv[2]);
      console.log('type=' + event.type);
      console.log('engine=' + event.data.engine);
    `);

    const event = makeEvent({ data: { engine: 'cursor' } });
    const hook = makeScriptHook(scriptPath);
    const result = await executor.execute(hook, event, { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('type=run.end');
    expect(result.output).toContain('engine=cursor');
  }, { timeout: 15000 });

  it('should append additional args from config', async () => {
    const scriptPath = join(testDir, 'extra-args.js');
    await fs.writeFile(scriptPath, `
      console.log('arg3=' + process.argv[3]);
      console.log('arg4=' + process.argv[4]);
    `);

    const hook = makeScriptHook(scriptPath, {
      action: { type: 'script', path: scriptPath, runtime: 'node' as const, args: ['extra1', 'extra2'] },
    });
    const result = await executor.execute(hook, makeEvent(), { timeout: 10000 });

    expect(result.success).toBe(true);
    expect(result.output).toContain('arg3=extra1');
    expect(result.output).toContain('arg4=extra2');
  }, { timeout: 15000 });
});
