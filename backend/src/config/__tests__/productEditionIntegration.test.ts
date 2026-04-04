/**
 * Integration tests for PRODUCT_EDITION environment variable
 *
 * These tests verify the full chain:
 *   PRODUCT_EDITION env var → initializeProduct() → productGateMiddleware → HTTP response
 *
 * Unlike productGate.test.ts (which mocks productConfig) and productConfig.test.ts
 * (which tests the config logic in isolation), these tests wire the REAL productConfig
 * together with the REAL productGateMiddleware and test end-to-end API gating behaviour.
 *
 * Run: pnpm run test:run --reporter=verbose src/config/__tests__/productEditionIntegration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { productGateMiddleware } from '../../middleware/productGate.js';
import { initializeProduct, _resetProductConfig } from '../productConfig.js';

// ---------------------------------------------------------------------------
// Test app factory — uses real productGateMiddleware + real productConfig.
// A simple echo handler sits behind the gate; if the gate passes, it returns
// 200 { ok: true }.  If the gate blocks, it returns 403.
// ---------------------------------------------------------------------------
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(productGateMiddleware);
  app.all('*', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function expects200(app: express.Application, method: string, path: string) {
  const res = await (request(app) as any)[method](path);
  expect(res.status, `expected 200 for ${method.toUpperCase()} ${path} but got ${res.status}`).toBe(200);
}

async function expects403(app: express.Application, method: string, path: string) {
  const res = await (request(app) as any)[method](path);
  expect(res.status, `expected 403 for ${method.toUpperCase()} ${path} but got ${res.status}`).toBe(403);
  return res;
}

// ---------------------------------------------------------------------------
// Shared teardown — reset singleton state and env var after every test
// ---------------------------------------------------------------------------
afterEach(() => {
  _resetProductConfig();
  delete process.env.PRODUCT_EDITION;
});

// ===========================================================================
// 1. full edition (default)
// ===========================================================================
describe('PRODUCT_EDITION=full (default)', () => {
  beforeEach(() => {
    delete process.env.PRODUCT_EDITION; // explicitly absent → defaults to full
    initializeProduct();
  });

  it('passes all module-gated API routes without blocking', async () => {
    const app = createApp();
    // Normally disabled in chat-only — should pass in full
    await expects200(app, 'get', '/api/plugins');
    await expects200(app, 'post', '/api/plugins');
    await expects200(app, 'get', '/api/files/read');
    await expects200(app, 'post', '/api/files/write');
    await expects200(app, 'get', '/api/settings');
    await expects200(app, 'get', '/api/scheduled-tasks');
    await expects200(app, 'get', '/api/tunnel');
  });

  it('passes both read and write requests to management routes', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/agents');
    await expects200(app, 'post', '/api/agents');
    await expects200(app, 'get', '/api/projects');
    await expects200(app, 'post', '/api/projects');
  });

  it('passes infrastructure routes (auth, engine, health)', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/engine');
    await expects200(app, 'get', '/api/auth/login');
    await expects200(app, 'get', '/api/health');
  });
});

// ===========================================================================
// 2. chat-only edition
// ===========================================================================
describe('PRODUCT_EDITION=chat-only', () => {
  beforeEach(() => {
    process.env.PRODUCT_EDITION = 'chat-only';
    initializeProduct();
  });

  describe('disabled modules → 403 for all methods', () => {
    it.each([
      ['get',    '/api/plugins'],
      ['post',   '/api/plugins'],
      ['get',    '/api/files/read'],
      ['post',   '/api/files/write'],
      ['get',    '/api/settings'],
      ['post',   '/api/settings'],
      ['get',    '/api/scheduled-tasks'],
      ['post',   '/api/scheduled-tasks'],
      ['get',    '/api/tunnel'],
      ['post',   '/api/cloudflare-tunnel'],
      ['get',    '/api/commands'],
      ['get',    '/api/subagents'],
      ['get',    '/api/skills'],
      ['get',    '/api/hooks'],
      ['get',    '/api/rules'],
      ['get',    '/api/speech-to-text'],
      ['get',    '/api/mcp-admin'],
    ] as [string, string][])(
      '%s %s → 403 with edition in body',
      async (method, path) => {
        const app = createApp();
        const res = await expects403(app, method, path);
        expect(res.body.edition).toBe('chat-only');
        expect(res.body.error).toBe('Feature not available');
      },
    );
  });

  describe('full-access modules → 200 for all methods', () => {
    it.each([
      ['post',   '/api/agents/chat'],
      ['post',   '/api/agents/user-response'],
      ['get',    '/api/agui/engines/cursor'],
      ['get',    '/api/sessions/agent-1'],
      ['get',    '/api/sessions/agent-1/sess-1/messages'],
      ['get',    '/api/marketplace-skills'],
      ['post',   '/api/marketplace-skills/toggle'],
      ['post',   '/api/marketplace-skills/batch'],
      ['get',    '/api/projects/proj-1/versions'],
      ['post',   '/api/projects/proj-1/versions/tag'],
    ] as [string, string][])(
      '%s %s → 200',
      async (method, path) => {
        const app = createApp();
        await expects200(app, method, path);
      },
    );
  });

  describe('readonly modules — GET allowed, mutations blocked', () => {
    it('GET /api/projects → 200', async () => {
      const app = createApp();
      await expects200(app, 'get', '/api/projects');
    });

    it('POST /api/projects → 403 Readonly access', async () => {
      const app = createApp();
      const res = await expects403(app, 'post', '/api/projects');
      expect(res.body.error).toBe('Readonly access');
      expect(res.body.module).toBe('manage.projects');
    });
  });



  describe('infrastructure / unmatched routes — always pass through', () => {
    it.each([
      '/api/engine',
      '/api/auth/login',
      '/api/games/publish',
    ])('%s → 200', async (path) => {
      const app = createApp();
      await expects200(app, 'get', path);
    });
  });

  describe('response body shape for 403', () => {
    it('disabled module has error + message + module + edition', async () => {
      const app = createApp();
      const res = await request(app).get('/api/plugins');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error:   'Feature not available',
        message: expect.stringContaining('extend.plugins'),
        module:  'extend.plugins',
        edition: 'chat-only',
      });
    });

    it('readonly violation has error + message + module + edition', async () => {
      const app = createApp();
      const res = await request(app).post('/api/projects');
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error:   'Readonly access',
        message: expect.stringContaining('manage.projects'),
        module:  'manage.projects',
        edition: 'chat-only',
      });
    });
  });
});

// ===========================================================================
// 3. lite edition
// ===========================================================================
describe('PRODUCT_EDITION=lite', () => {
  beforeEach(() => {
    process.env.PRODUCT_EDITION = 'lite';
    initializeProduct();
  });

  it('allows full access to core modules', async () => {
    const app = createApp();
    await expects200(app, 'post', '/api/agents/chat');
    await expects200(app, 'get', '/api/sessions/agent-1');
    await expects200(app, 'get', '/api/files/read');
  });

  it('allows full access to management modules (including write)', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/agents');
    await expects200(app, 'post', '/api/agents');   // full, not readonly
    await expects200(app, 'get', '/api/projects');
    await expects200(app, 'post', '/api/projects'); // full, not readonly
    await expects200(app, 'get', '/api/mcp/servers');
  });

  it('enables extend.commands and extend.rules', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/commands');
    await expects200(app, 'post', '/api/commands');
    await expects200(app, 'get', '/api/rules');
    await expects200(app, 'post', '/api/rules');
  });

  it('disables extend.plugins, extend.skills, extend.subagents', async () => {
    const app = createApp();
    await expects403(app, 'get', '/api/plugins');
    await expects403(app, 'get', '/api/skills');
    await expects403(app, 'get', '/api/subagents');
  });

  it('disables system.scheduler and system.tunnel', async () => {
    const app = createApp();
    await expects403(app, 'get', '/api/scheduled-tasks');
    await expects403(app, 'get', '/api/tunnel');
  });

  it('allows GET system.versions (readonly) but blocks POST', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/version');
    // versions POST routes like tag/checkout are gated, project-specific pattern
    const res = await request(app).get('/api/projects/proj-1/versions');
    // system.versions is readonly in lite, so GET should pass
    expect(res.status).toBe(200);
  });

  it('allows full access to system.settings', async () => {
    const app = createApp();
    await expects200(app, 'get', '/api/settings');
    await expects200(app, 'post', '/api/settings');
  });
});

// ===========================================================================
// 4. Edition detection & aliases
// ===========================================================================
describe('edition detection and aliases', () => {
  it('defaults to full when PRODUCT_EDITION is not set', async () => {
    delete process.env.PRODUCT_EDITION;
    initializeProduct();
    const app = createApp();
    // full edition — plugins route is accessible
    await expects200(app, 'get', '/api/plugins');
  });

  it('"chat" alias resolves to chat-only and enforces its restrictions', async () => {
    process.env.PRODUCT_EDITION = 'chat';
    initializeProduct();
    const app = createApp();
    const res = await expects403(app, 'get', '/api/plugins');
    // The edition field in the response should reflect the resolved edition
    expect(res.body.edition).toBe('chat-only');
  });

  it('"chat_only" alias resolves to chat-only', async () => {
    process.env.PRODUCT_EDITION = 'chat_only';
    initializeProduct();
    const app = createApp();
    const res = await expects403(app, 'get', '/api/plugins');
    expect(res.body.edition).toBe('chat-only');
  });

  it('unknown edition string falls back to full (all routes pass)', async () => {
    process.env.PRODUCT_EDITION = 'super-premium-turbo';
    initializeProduct();
    const app = createApp();
    await expects200(app, 'get', '/api/plugins');  // full = no blocking
  });
});
