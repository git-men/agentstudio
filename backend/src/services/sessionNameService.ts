import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface NameMapFile {
  version: 1;
  names: Record<string, string>;
}

function getConfigDir(): string {
  const override = process.env._CLAWSTUDIO_CONFIG_OVERRIDE;
  return override
    ? path.join(override, '.config', 'clawstudio')
    : path.join(os.homedir(), '.config', 'clawstudio');
}

function getFilePath(): string {
  return path.join(getConfigDir(), 'session-name-map.json');
}

class SessionNameService {
  private names = new Map<string, string>();

  /** 同步加载文件；在 app.listen() 之前调用 */
  initialize(): void {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as NameMapFile;
      this.names = new Map(Object.entries(data.names ?? {}));
    } catch (err) {
      console.warn('[SessionNameService] 文件损坏，重置为空 map:', err);
      this.names = new Map();
    }
  }

  /** 写入自定义名称并原子落盘 */
  async setName(sessionId: string, name: string): Promise<void> {
    this.names.set(sessionId, name);
    await this.saveToDisk();
  }

  /** 删除条目；预留接口，供未来删除会话时清理映射（当前未调用） */
  async clearName(sessionId: string): Promise<void> {
    this.names.delete(sessionId);
    await this.saveToDisk();
  }

  /**
   * 将 oldId 的自定义名称迁移到 newId（会话 ID 从临时变为真实时调用）。
   * 若 oldId 没有自定义名称则无操作。
   */
  migrateSession(oldId: string, newId: string): void {
    const custom = this.names.get(oldId);
    if (!custom) return;
    this.names.set(newId, custom);
    this.names.delete(oldId);
    this.saveToDisk().catch((err) =>
      console.warn('[SessionNameService] migrateSession 落盘失败:', err)
    );
  }

  /** 批量覆盖 title；在搜索过滤之后调用 */
  applyNames<T extends { id: string; title?: string }>(sessions: T[]): T[] {
    return sessions.map((s) => {
      const custom = this.names.get(s.id);
      // Empty string treated as unset; route validation ensures names are never empty
      return custom ? { ...s, title: custom } : s;
    });
  }

  private async saveToDisk(): Promise<void> {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = getFilePath();
    const tmpPath = filePath + '.tmp';
    const data: NameMapFile = {
      version: 1,
      names: Object.fromEntries(this.names),
    };
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }
}

export const sessionNameService = new SessionNameService();
