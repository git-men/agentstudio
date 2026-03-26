import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');

vi.mock('../../config/paths.js', () => ({
  IM_BINDINGS_FILE: '/mock/.agentstudio/data/im-bindings.json',
}));

describe('imBindingService', () => {
  let imBindingService: typeof import('../imBindingService.js')['imBindingService'];

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings: [] }));

    const mod = await import('../imBindingService.js');
    imBindingService = mod.imBindingService;
  });

  describe('list', () => {
    it('returns empty array when no bindings exist', () => {
      expect(imBindingService.list()).toEqual([]);
    });

    it('returns all stored bindings', () => {
      const bindings = [
        { id: 'im_1', platform: 'wecom', name: 'Test', bot_key: 'key1', project_path: '/p1', project_name: 'p1', a2a_endpoint: 'http://x', created_at: '', updated_at: '' },
        { id: 'im_2', platform: 'qqbot', name: 'QQ', bot_key: 'key2', project_path: '/p2', project_name: 'p2', a2a_endpoint: 'http://y', created_at: '', updated_at: '' },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings }));
      expect(imBindingService.list()).toHaveLength(2);
    });
  });

  describe('listByPlatform', () => {
    it('filters bindings by platform', () => {
      const bindings = [
        { id: 'im_1', platform: 'wecom', name: 'W1', bot_key: 'k1', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
        { id: 'im_2', platform: 'qqbot', name: 'Q1', bot_key: 'k2', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
        { id: 'im_3', platform: 'wecom', name: 'W2', bot_key: 'k3', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings }));
      expect(imBindingService.listByPlatform('wecom')).toHaveLength(2);
      expect(imBindingService.listByPlatform('qqbot')).toHaveLength(1);
      expect(imBindingService.listByPlatform('weixin')).toHaveLength(0);
    });
  });

  describe('getByBotKey', () => {
    it('returns undefined when not found', () => {
      expect(imBindingService.getByBotKey('nonexistent')).toBeUndefined();
    });

    it('returns matching binding', () => {
      const bindings = [
        { id: 'im_1', platform: 'qqbot', name: 'Q1', bot_key: 'qqbot-proj_abc', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings }));
      const result = imBindingService.getByBotKey('qqbot-proj_abc');
      expect(result).toBeDefined();
      expect(result!.platform).toBe('qqbot');
    });
  });

  describe('upsert', () => {
    it('creates a new binding with generated id and timestamps', () => {
      const binding = {
        platform: 'wecom' as const,
        name: 'My Bot',
        project_path: '/projects/test',
        project_name: 'test',
        bot_key: 'abc-123',
        a2a_endpoint: 'https://tunnel.example/a2a/xxx/messages',
        platform_config: { webhook_url: 'https://qyapi.weixin.qq.com/...' },
      };

      const result = imBindingService.upsert(binding);

      expect(result.id).toMatch(/^im_/);
      expect(result.platform).toBe('wecom');
      expect(result.name).toBe('My Bot');
      expect(result.bot_key).toBe('abc-123');
      expect(result.created_at).toBeTruthy();
      expect(result.updated_at).toBeTruthy();
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

      const writtenData = JSON.parse(
        (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string),
      );
      expect(writtenData.bindings).toHaveLength(1);
      expect(writtenData.bindings[0].bot_key).toBe('abc-123');
    });

    it('updates existing binding when bot_key matches', () => {
      const existing = [
        {
          id: 'im_old',
          platform: 'qqbot',
          name: 'Old Name',
          project_path: '/old',
          project_name: 'old',
          bot_key: 'qqbot-proj_x',
          a2a_endpoint: 'http://old',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
        },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings: existing }));

      const result = imBindingService.upsert({
        platform: 'qqbot',
        name: 'New Name',
        project_path: '/new',
        project_name: 'new',
        bot_key: 'qqbot-proj_x',
        a2a_endpoint: 'http://new',
      });

      expect(result.id).toBe('im_old');
      expect(result.name).toBe('New Name');
      expect(result.a2a_endpoint).toBe('http://new');
      expect(result.created_at).toBe('2025-01-01T00:00:00.000Z');
      expect(result.updated_at).not.toBe('2025-01-01T00:00:00.000Z');

      const writtenData = JSON.parse(
        (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string),
      );
      expect(writtenData.bindings).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('returns false when binding does not exist', () => {
      expect(imBindingService.remove('nonexistent')).toBe(false);
    });

    it('removes matching binding and returns true', () => {
      const bindings = [
        { id: 'im_1', platform: 'wecom', name: 'W1', bot_key: 'key1', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
        { id: 'im_2', platform: 'qqbot', name: 'Q1', bot_key: 'key2', project_path: '/p', project_name: 'p', a2a_endpoint: '', created_at: '', updated_at: '' },
      ];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bindings }));

      expect(imBindingService.remove('key1')).toBe(true);

      const writtenData = JSON.parse(
        (vi.mocked(fs.writeFileSync).mock.calls[0][1] as string),
      );
      expect(writtenData.bindings).toHaveLength(1);
      expect(writtenData.bindings[0].bot_key).toBe('key2');
    });
  });

  describe('file error handling', () => {
    it('returns empty bindings when file does not exist', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(imBindingService.list()).toEqual([]);
    });

    it('creates directory if not exists on save', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      imBindingService.upsert({
        platform: 'weixin',
        name: 'WX Bot',
        project_path: '/p',
        project_name: 'p',
        bot_key: 'wx-1',
        a2a_endpoint: 'http://x',
      });
      expect(fs.mkdirSync).toHaveBeenCalled();
    });
  });
});
