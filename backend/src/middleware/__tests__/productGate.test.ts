import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../config/productConfig.js', () => ({
  getProductEdition: vi.fn(),
  getModuleAccess: vi.fn(),
  resolveModule: vi.fn(),
}));

import { productGateMiddleware, moduleGate } from '../productGate.js';
import {
  getProductEdition,
  getModuleAccess,
  resolveModule,
} from '../../config/productConfig.js';

const mockedGetProductEdition = vi.mocked(getProductEdition);
const mockedGetModuleAccess = vi.mocked(getModuleAccess);
const mockedResolveModule = vi.mocked(resolveModule);

function createApp(middleware: express.RequestHandler = productGateMiddleware) {
  const app = express();
  app.use(middleware);
  app.all('*', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// productGateMiddleware
// =============================================================================

describe('productGateMiddleware', () => {
  describe('full edition bypass', () => {
    beforeEach(() => {
      mockedGetProductEdition.mockReturnValue('full');
    });

    it('passes all requests through without checking modules', async () => {
      const app = createApp();
      const res = await request(app).get('/api/anything');
      expect(res.status).toBe(200);
      expect(mockedResolveModule).not.toHaveBeenCalled();
    });

    it('passes POST requests through', async () => {
      const app = createApp();
      const res = await request(app).post('/api/agents');
      expect(res.status).toBe(200);
    });
  });

  describe('infrastructure routes (no module match)', () => {
    beforeEach(() => {
      mockedGetProductEdition.mockReturnValue('chat-only');
      mockedResolveModule.mockReturnValue(null);
    });

    it('passes through GET to unmatched routes', async () => {
      const app = createApp();
      const res = await request(app).get('/api/engine');
      expect(res.status).toBe(200);
    });

    it('passes through POST to unmatched routes', async () => {
      const app = createApp();
      const res = await request(app).post('/api/games/publish');
      expect(res.status).toBe(200);
    });
  });

  describe('module with full access', () => {
    beforeEach(() => {
      mockedGetProductEdition.mockReturnValue('chat-only');
      mockedResolveModule.mockReturnValue('core.chat');
      mockedGetModuleAccess.mockReturnValue('full');
    });

    it('allows GET requests', async () => {
      const app = createApp();
      const res = await request(app).get('/api/agents/chat');
      expect(res.status).toBe(200);
    });

    it('allows POST requests', async () => {
      const app = createApp();
      const res = await request(app).post('/api/agents/chat');
      expect(res.status).toBe(200);
    });

    it('allows PUT requests', async () => {
      const app = createApp();
      const res = await request(app).put('/api/agents/chat');
      expect(res.status).toBe(200);
    });

    it('allows DELETE requests', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/agents/chat');
      expect(res.status).toBe(200);
    });
  });

  describe('module with readonly access', () => {
    beforeEach(() => {
      mockedGetProductEdition.mockReturnValue('chat-only');
      mockedResolveModule.mockReturnValue('manage.agents');
      mockedGetModuleAccess.mockReturnValue('readonly');
    });

    it('allows GET requests', async () => {
      const app = createApp();
      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(200);
    });

    it('allows HEAD requests', async () => {
      const app = createApp();
      const res = await request(app).head('/api/agents');
      expect(res.status).toBe(200);
    });

    it('allows OPTIONS requests', async () => {
      const app = createApp();
      const res = await request(app).options('/api/agents');
      expect(res.status).toBe(200);
    });

    it('blocks POST with 403 and module info', async () => {
      const app = createApp();
      const res = await request(app).post('/api/agents');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Readonly access');
      expect(res.body.module).toBe('manage.agents');
      expect(res.body.edition).toBe('chat-only');
    });

    it('blocks PUT with 403', async () => {
      const app = createApp();
      const res = await request(app).put('/api/agents/agent-1');
      expect(res.status).toBe(403);
    });

    it('blocks DELETE with 403', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/agents/agent-1');
      expect(res.status).toBe(403);
    });
  });

  describe('module with disabled access', () => {
    beforeEach(() => {
      mockedGetProductEdition.mockReturnValue('chat-only');
      mockedResolveModule.mockReturnValue('core.files');
      mockedGetModuleAccess.mockReturnValue('disabled');
    });

    it('blocks GET with 403', async () => {
      const app = createApp();
      const res = await request(app).get('/api/files/read');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Feature not available');
      expect(res.body.module).toBe('core.files');
      expect(res.body.edition).toBe('chat-only');
    });

    it('blocks POST with 403', async () => {
      const app = createApp();
      const res = await request(app).post('/api/files/write');
      expect(res.status).toBe(403);
    });
  });
});

// =============================================================================
// moduleGate (per-route guard)
// =============================================================================

describe('moduleGate', () => {
  it('passes in full edition regardless of module access', async () => {
    mockedGetProductEdition.mockReturnValue('full');
    const app = createApp(moduleGate('core.files'));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(200);
  });

  it('passes when module has full access', async () => {
    mockedGetProductEdition.mockReturnValue('chat-only');
    mockedGetModuleAccess.mockReturnValue('full');
    const app = createApp(moduleGate('core.chat'));
    const res = await request(app).post('/anything');
    expect(res.status).toBe(200);
  });

  it('allows GET when module is readonly', async () => {
    mockedGetProductEdition.mockReturnValue('chat-only');
    mockedGetModuleAccess.mockReturnValue('readonly');
    const app = createApp(moduleGate('manage.agents'));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(200);
  });

  it('blocks POST when module is readonly', async () => {
    mockedGetProductEdition.mockReturnValue('chat-only');
    mockedGetModuleAccess.mockReturnValue('readonly');
    const app = createApp(moduleGate('manage.agents'));
    const res = await request(app).post('/anything');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Readonly access');
  });

  it('blocks all methods when module is disabled', async () => {
    mockedGetProductEdition.mockReturnValue('chat-only');
    mockedGetModuleAccess.mockReturnValue('disabled');
    const app = createApp(moduleGate('system.scheduler'));
    const res = await request(app).get('/anything');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Feature not available');
  });
});
