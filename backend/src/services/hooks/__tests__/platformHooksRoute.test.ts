import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { HookManager } from '../hookManager.js';
import { HookStorage, type HookStoragePaths } from '../hookStorage.js';
import { ShellExecutor } from '../executors/shellExecutor.js';
import type { ExecutorRegistry } from '../executors/types.js';
import type { PlatformHook } from '../../../types/platformHooks.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let app: express.Application;
let testDir: string;
let manager: HookManager;

async function setupTestApp() {
  testDir = join(tmpdir(), `hook-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });

  const hooksDir = join(testDir, 'hooks');
  const testPaths: HookStoragePaths = {
    globalHooksFile: join(hooksDir, 'global-hooks.json'),
    hooksDir,
    getProjectHooksFile: (pid: string) => join(hooksDir, 'projects', pid, 'hooks.json'),
  };

  const storage = new HookStorage(testPaths);
  const executors: ExecutorRegistry = new Map();
  executors.set('shell', new ShellExecutor());

  manager = new HookManager(storage, executors);
  await manager.initialize();

  // Mock the getHookManager to return our test manager
  vi.doMock('../index.js', () => ({
    getHookManager: () => manager,
    initHookSystem: vi.fn(),
    shutdownHookSystem: vi.fn(),
    platformEventBus: { subscribe: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn() },
    HookManager,
    HookStorage,
  }));

  // Re-import the route module so it picks up the mock
  const routeModule = await import('../../../routes/platformHooks.js?t=' + Date.now());
  const router = routeModule.default;

  app = express();
  app.use(express.json());
  app.use('/api/platform-hooks', router);
}

describe('Platform Hooks REST API', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupTestApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('GET /api/platform-hooks/events', () => {
    it('should return available event types', async () => {
      const res = await request(app).get('/api/platform-hooks/events');
      expect(res.status).toBe(200);
      expect(res.body.events).toBeInstanceOf(Array);
      expect(res.body.events.length).toBeGreaterThan(0);

      const types = res.body.events.map((e: { type: string }) => e.type);
      expect(types).toContain('run.start');
      expect(types).toContain('run.end');
      expect(types).toContain('run.error');
    });
  });

  describe('POST /api/platform-hooks', () => {
    const validBody = {
      name: 'Test Hook',
      event: 'run.end',
      action: { type: 'shell', command: 'echo test' },
      scope: 'global',
    };

    it('should create a hook with valid body', async () => {
      const res = await request(app)
        .post('/api/platform-hooks')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.hook.id).toMatch(/^hook_/);
      expect(res.body.hook.name).toBe('Test Hook');
      expect(res.body.hook.enabled).toBe(true);
      expect(res.body.hook.timeout).toBe(30000);
      expect(res.body.hook.failurePolicy).toBe('warn');
      expect(res.body.hook.priority).toBe(10);
      expect(res.body.hook.createdAt).toBeTruthy();
    });

    it('should return 400 when name is missing', async () => {
      const { name, ...body } = validBody;
      const res = await request(app)
        .post('/api/platform-hooks')
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('validation_error');
    });

    it('should return 400 for invalid event type', async () => {
      const res = await request(app)
        .post('/api/platform-hooks')
        .send({ ...validBody, event: 'invalid.event' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid event type');
    });

    it('should return 400 when scope=project but no projectId', async () => {
      const res = await request(app)
        .post('/api/platform-hooks')
        .send({ ...validBody, scope: 'project' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('projectId');
    });
  });

  describe('GET /api/platform-hooks', () => {
    it('should list all hooks', async () => {
      await request(app).post('/api/platform-hooks').send({
        name: 'Hook A', event: 'run.end', action: { type: 'shell', command: 'echo a' }, scope: 'global',
      });
      await request(app).post('/api/platform-hooks').send({
        name: 'Hook B', event: 'run.start', action: { type: 'shell', command: 'echo b' }, scope: 'global',
      });

      const res = await request(app).get('/api/platform-hooks');
      expect(res.status).toBe(200);
      expect(res.body.hooks).toHaveLength(2);
    });

    it('should filter by scope', async () => {
      await request(app).post('/api/platform-hooks').send({
        name: 'Global', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });
      await request(app).post('/api/platform-hooks').send({
        name: 'Project', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'project', projectId: 'proj-1',
      });

      const res = await request(app).get('/api/platform-hooks?scope=global');
      expect(res.status).toBe(200);
      expect(res.body.hooks).toHaveLength(1);
      expect(res.body.hooks[0].name).toBe('Global');
    });

    it('should filter by event', async () => {
      await request(app).post('/api/platform-hooks').send({
        name: 'End Hook', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });
      await request(app).post('/api/platform-hooks').send({
        name: 'Start Hook', event: 'run.start', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });

      const res = await request(app).get('/api/platform-hooks?event=run.end');
      expect(res.status).toBe(200);
      expect(res.body.hooks).toHaveLength(1);
      expect(res.body.hooks[0].name).toBe('End Hook');
    });
  });

  describe('GET /api/platform-hooks/:id', () => {
    it('should return a hook by ID', async () => {
      const createRes = await request(app).post('/api/platform-hooks').send({
        name: 'Find Me', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });

      const res = await request(app).get(`/api/platform-hooks/${createRes.body.hook.id}`);
      expect(res.status).toBe(200);
      expect(res.body.hook.name).toBe('Find Me');
    });

    it('should return 404 for unknown ID', async () => {
      const res = await request(app).get('/api/platform-hooks/hook_nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/platform-hooks/:id', () => {
    it('should update hook fields', async () => {
      const createRes = await request(app).post('/api/platform-hooks').send({
        name: 'Original', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });

      const res = await request(app)
        .put(`/api/platform-hooks/${createRes.body.hook.id}`)
        .send({ name: 'Updated', enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.hook.name).toBe('Updated');
      expect(res.body.hook.enabled).toBe(false);
    });

    it('should return 404 for unknown ID', async () => {
      const res = await request(app)
        .put('/api/platform-hooks/hook_nonexistent')
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('should reject immutable fields', async () => {
      const createRes = await request(app).post('/api/platform-hooks').send({
        name: 'Test', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });

      const res = await request(app)
        .put(`/api/platform-hooks/${createRes.body.hook.id}`)
        .send({ id: 'hook_new-id' });

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/platform-hooks/:id', () => {
    it('should delete a hook', async () => {
      const createRes = await request(app).post('/api/platform-hooks').send({
        name: 'Delete Me', event: 'run.end', action: { type: 'shell', command: 'echo' }, scope: 'global',
      });

      const res = await request(app).delete(`/api/platform-hooks/${createRes.body.hook.id}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app).get(`/api/platform-hooks/${createRes.body.hook.id}`);
      expect(getRes.status).toBe(404);
    });

    it('should return 404 for unknown ID', async () => {
      const res = await request(app).delete('/api/platform-hooks/hook_nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/platform-hooks/:id/test', () => {
    it('should test-execute a hook and return result', async () => {
      const createRes = await request(app).post('/api/platform-hooks').send({
        name: 'Testable', event: 'run.end', action: { type: 'shell', command: 'echo hook-test-output' }, scope: 'global',
      });

      const res = await request(app)
        .post(`/api/platform-hooks/${createRes.body.hook.id}/test`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.hookId).toBe(createRes.body.hook.id);
      expect(res.body.hookName).toBe('Testable');
      expect(res.body.result.success).toBe(true);
      expect(res.body.result.output).toContain('hook-test-output');
      expect(res.body.event.type).toBe('run.end');
    });

    it('should return 404 for unknown hook', async () => {
      const res = await request(app)
        .post('/api/platform-hooks/hook_nonexistent/test')
        .send();
      expect(res.status).toBe(404);
    });
  });
});
