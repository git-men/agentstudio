import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/imBindingService.js', () => ({
  imBindingService: {
    list: vi.fn(),
    listByPlatform: vi.fn(),
    remove: vi.fn(),
  },
}));

import imBindingsRouter from '../imBindings.js';
import { imBindingService } from '../../services/imBindingService.js';

const mockedList = vi.mocked(imBindingService.list);
const mockedListByPlatform = vi.mocked(imBindingService.listByPlatform);
const mockedRemove = vi.mocked(imBindingService.remove);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/im-bindings', imBindingsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/im-bindings', () => {
  it('returns all bindings when no platform filter', async () => {
    const bindings = [
      { id: 'im_1', platform: 'wecom', name: 'W1', bot_key: 'k1' },
      { id: 'im_2', platform: 'qqbot', name: 'Q1', bot_key: 'k2' },
    ];
    mockedList.mockReturnValue(bindings as any);

    const res = await request(createApp()).get('/api/im-bindings');

    expect(res.status).toBe(200);
    expect(res.body.bindings).toHaveLength(2);
    expect(mockedList).toHaveBeenCalled();
    expect(mockedListByPlatform).not.toHaveBeenCalled();
  });

  it('filters by platform when ?platform= is provided', async () => {
    const bindings = [{ id: 'im_1', platform: 'qqbot', name: 'Q1', bot_key: 'k1' }];
    mockedListByPlatform.mockReturnValue(bindings as any);

    const res = await request(createApp()).get('/api/im-bindings?platform=qqbot');

    expect(res.status).toBe(200);
    expect(res.body.bindings).toHaveLength(1);
    expect(mockedListByPlatform).toHaveBeenCalledWith('qqbot');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('returns empty array when no bindings', async () => {
    mockedList.mockReturnValue([]);

    const res = await request(createApp()).get('/api/im-bindings');

    expect(res.status).toBe(200);
    expect(res.body.bindings).toEqual([]);
  });
});

describe('DELETE /api/im-bindings/:botKey', () => {
  it('removes binding and returns success', async () => {
    mockedRemove.mockReturnValue(true);

    const res = await request(createApp()).delete('/api/im-bindings/my-bot-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockedRemove).toHaveBeenCalledWith('my-bot-key');
  });

  it('returns 404 when binding does not exist', async () => {
    mockedRemove.mockReturnValue(false);

    const res = await request(createApp()).delete('/api/im-bindings/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
