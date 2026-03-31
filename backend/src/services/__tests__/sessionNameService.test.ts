import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-name-test-'));
  process.env._CLAWSTUDIO_CONFIG_OVERRIDE = testDir;
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env._CLAWSTUDIO_CONFIG_OVERRIDE;
});

async function getService() {
  // cache-bust to get fresh singleton per test
  const mod = await import('../sessionNameService.js?' + Date.now());
  return mod.sessionNameService;
}

describe('SessionNameService', () => {
  it('initialize() 在文件不存在时创建空 map', async () => {
    const svc = await getService();
    svc.initialize();
    expect(svc.applyNames([{ id: 'x', title: 'orig' }])[0].title).toBe('orig');
  });

  it('setName() 后 applyNames() 使用自定义名称', async () => {
    const svc = await getService();
    svc.initialize();
    await svc.setName('sess-1', '我的自定义名');
    const result = svc.applyNames([{ id: 'sess-1', title: '自动标题' }]);
    expect(result[0].title).toBe('我的自定义名');
  });

  it('applyNames() 未命名会话保留原始 title', async () => {
    const svc = await getService();
    svc.initialize();
    const result = svc.applyNames([{ id: 'no-name', title: '原始' }]);
    expect(result[0].title).toBe('原始');
  });

  it('重启后（重新 initialize）自定义名称仍存在', async () => {
    const svc = await getService();
    svc.initialize();
    await svc.setName('sess-persist', '持久名称');
    svc.initialize(); // re-read from disk
    const result = svc.applyNames([{ id: 'sess-persist', title: '旧' }]);
    expect(result[0].title).toBe('持久名称');
  });

  it('文件损坏时 initialize() 降级为空 map 不抛出', async () => {
    const configDir = path.join(testDir, '.config', 'clawstudio');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'session-name-map.json'), 'not json');
    const svc = await getService();
    expect(() => svc.initialize()).not.toThrow();
    const result = svc.applyNames([{ id: 'x', title: 'orig' }]);
    expect(result[0].title).toBe('orig');
  });
});
