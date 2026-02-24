import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { GLOBAL_HOOKS_FILE, HOOKS_DIR, getProjectHooksFile } from '../../config/paths.js';
import type { PlatformHook, HookStorageFile } from '../../types/platformHooks.js';

const STORAGE_VERSION = '1.0.0';

export interface HookStoragePaths {
  globalHooksFile: string;
  hooksDir: string;
  getProjectHooksFile: (projectId: string) => string;
}

const DEFAULT_PATHS: HookStoragePaths = {
  globalHooksFile: GLOBAL_HOOKS_FILE,
  hooksDir: HOOKS_DIR,
  getProjectHooksFile,
};

function emptyStorageFile(): HookStorageFile {
  return { version: STORAGE_VERSION, hooks: [] };
}

async function readJsonFile(filePath: string): Promise<HookStorageFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as HookStorageFile;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyStorageFile();
    }
    throw err;
  }
}

async function writeJsonFileAtomic(filePath: string, data: HookStorageFile): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

export class HookStorage {
  private paths: HookStoragePaths;

  constructor(paths?: HookStoragePaths) {
    this.paths = paths ?? DEFAULT_PATHS;
  }

  async loadGlobalHooks(): Promise<PlatformHook[]> {
    const file = await readJsonFile(this.paths.globalHooksFile);
    return file.hooks;
  }

  async loadProjectHooks(projectId: string): Promise<PlatformHook[]> {
    const filePath = this.paths.getProjectHooksFile(projectId);
    const file = await readJsonFile(filePath);
    return file.hooks;
  }

  async loadAllHooks(): Promise<PlatformHook[]> {
    const global = await this.loadGlobalHooks();

    const projectIds = await this.listProjectIds();
    const projectHooksArrays = await Promise.all(
      projectIds.map(id => this.loadProjectHooks(id)),
    );

    return [...global, ...projectHooksArrays.flat()];
  }

  async saveHook(hook: PlatformHook): Promise<void> {
    const filePath = this.getFilePathForHook(hook);
    const file = await readJsonFile(filePath);

    const idx = file.hooks.findIndex(h => h.id === hook.id);
    if (idx >= 0) {
      file.hooks[idx] = hook;
    } else {
      file.hooks.push(hook);
    }

    await writeJsonFileAtomic(filePath, file);
  }

  async deleteHook(hookId: string): Promise<boolean> {
    const hook = await this.findHookById(hookId);
    if (!hook) return false;

    const filePath = this.getFilePathForHook(hook);
    const file = await readJsonFile(filePath);

    const lengthBefore = file.hooks.length;
    file.hooks = file.hooks.filter(h => h.id !== hookId);

    if (file.hooks.length === lengthBefore) return false;

    await writeJsonFileAtomic(filePath, file);
    return true;
  }

  async findHookById(hookId: string): Promise<PlatformHook | null> {
    const all = await this.loadAllHooks();
    return all.find(h => h.id === hookId) ?? null;
  }

  private getFilePathForHook(hook: PlatformHook): string {
    if (hook.scope === 'project' && hook.projectId) {
      return this.paths.getProjectHooksFile(hook.projectId);
    }
    return this.paths.globalHooksFile;
  }

  private async listProjectIds(): Promise<string[]> {
    const projectsDir = join(this.paths.hooksDir, 'projects');
    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }
}
