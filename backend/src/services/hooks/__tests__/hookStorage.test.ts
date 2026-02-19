import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HookStorage, type HookStoragePaths } from '../hookStorage.js';
import type { PlatformHook } from '../../../types/platformHooks.js';

function makeHook(overrides: Partial<PlatformHook> = {}): PlatformHook {
  return {
    id: 'hook_test-001',
    name: 'Test Hook',
    enabled: true,
    event: 'run.end',
    action: { type: 'shell', command: 'echo test' },
    scope: 'global',
    timeout: 30000,
    failurePolicy: 'warn',
    priority: 10,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

let testDir: string;
let testPaths: HookStoragePaths;
let storage: HookStorage;

describe('HookStorage', () => {
  beforeEach(async () => {
    testDir = join(tmpdir(), `hook-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });

    const hooksDir = join(testDir, 'hooks');
    testPaths = {
      globalHooksFile: join(hooksDir, 'global-hooks.json'),
      hooksDir,
      getProjectHooksFile: (projectId: string) => join(hooksDir, 'projects', projectId, 'hooks.json'),
    };
    storage = new HookStorage(testPaths);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return empty array when loading from missing global file', async () => {
    const hooks = await storage.loadGlobalHooks();
    expect(hooks).toEqual([]);
  });

  it('should return empty array when loading from missing project file', async () => {
    const hooks = await storage.loadProjectHooks('proj-1');
    expect(hooks).toEqual([]);
  });

  it('should save and load a global hook', async () => {
    const hook = makeHook();

    await storage.saveHook(hook);
    const loaded = await storage.loadGlobalHooks();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(hook);
  });

  it('should save and load a project-scoped hook', async () => {
    const hook = makeHook({
      id: 'hook_proj-001',
      scope: 'project',
      projectId: 'my-project',
    });

    await storage.saveHook(hook);
    const loaded = await storage.loadProjectHooks('my-project');

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(hook);
  });

  it('should update existing hook in place', async () => {
    const hook = makeHook();
    await storage.saveHook(hook);

    const updated = { ...hook, name: 'Updated Hook', updatedAt: '2026-06-01T00:00:00.000Z' };
    await storage.saveHook(updated);

    const loaded = await storage.loadGlobalHooks();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Updated Hook');
  });

  it('should delete hook by ID', async () => {
    const hook = makeHook();
    await storage.saveHook(hook);

    const deleted = await storage.deleteHook(hook.id);
    expect(deleted).toBe(true);

    const loaded = await storage.loadGlobalHooks();
    expect(loaded).toHaveLength(0);
  });

  it('should return false when deleting non-existent hook', async () => {
    const deleted = await storage.deleteHook('hook_nonexistent');
    expect(deleted).toBe(false);
  });

  it('should find hook by ID', async () => {
    const hook = makeHook();
    await storage.saveHook(hook);

    const found = await storage.findHookById(hook.id);
    expect(found).toEqual(hook);
  });

  it('should return null when hook not found by ID', async () => {
    const found = await storage.findHookById('hook_nonexistent');
    expect(found).toBeNull();
  });

  it('should load all hooks from global and multiple projects', async () => {
    const globalHook = makeHook({ id: 'hook_global-1' });
    const projHook1 = makeHook({ id: 'hook_proj-1', scope: 'project', projectId: 'project-a' });
    const projHook2 = makeHook({ id: 'hook_proj-2', scope: 'project', projectId: 'project-b' });

    await storage.saveHook(globalHook);
    await storage.saveHook(projHook1);
    await storage.saveHook(projHook2);

    const all = await storage.loadAllHooks();
    expect(all).toHaveLength(3);

    const ids = all.map(h => h.id).sort();
    expect(ids).toEqual(['hook_global-1', 'hook_proj-1', 'hook_proj-2']);
  });

  it('should create directories automatically on first write', async () => {
    const hook = makeHook({
      id: 'hook_auto-dir',
      scope: 'project',
      projectId: 'new-project',
    });

    await storage.saveHook(hook);
    const loaded = await storage.loadProjectHooks('new-project');
    expect(loaded).toHaveLength(1);
  });

  it('should persist version field in storage file', async () => {
    const hook = makeHook();
    await storage.saveHook(hook);

    const raw = await fs.readFile(testPaths.globalHooksFile, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe('1.0.0');
  });
});
