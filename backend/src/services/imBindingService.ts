/**
 * IM Binding Service
 *
 * Persists IM binding records (WeChat Work, QQ Bot, WeChat) to a local JSON file.
 * Each binding captures the platform, project, bot identifier, and user-friendly name.
 */

import fs from 'fs';
import path from 'path';
import { IM_BINDINGS_FILE } from '../config/paths.js';

export type IMPlatform = 'wecom' | 'qqbot' | 'weixin';

export interface IMBinding {
  id: string;
  platform: IMPlatform;
  /** User-friendly display name */
  name: string;
  /** Absolute project path */
  project_path: string;
  /** Human-readable project name (derived from path) */
  project_name: string;
  /** Platform-specific bot identifier (webhook key, bot_key, etc.) */
  bot_key: string;
  /** A2A endpoint URL */
  a2a_endpoint: string;
  /** Platform-specific metadata */
  platform_config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface BindingStore {
  bindings: IMBinding[];
}

function ensureDir(): void {
  const dir = path.dirname(IM_BINDINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function load(): BindingStore {
  ensureDir();
  try {
    const raw = fs.readFileSync(IM_BINDINGS_FILE, 'utf-8');
    return JSON.parse(raw) as BindingStore;
  } catch {
    return { bindings: [] };
  }
}

function save(store: BindingStore): void {
  ensureDir();
  fs.writeFileSync(IM_BINDINGS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export const imBindingService = {
  list(): IMBinding[] {
    return load().bindings;
  },

  listByPlatform(platform: IMPlatform): IMBinding[] {
    return load().bindings.filter(b => b.platform === platform);
  },

  getByBotKey(botKey: string): IMBinding | undefined {
    return load().bindings.find(b => b.bot_key === botKey);
  },

  /**
   * Upsert a binding record. If a binding with the same bot_key already exists,
   * it will be updated; otherwise a new record is created.
   */
  upsert(binding: Omit<IMBinding, 'id' | 'created_at' | 'updated_at'>): IMBinding {
    const store = load();
    const now = new Date().toISOString();
    const existing = store.bindings.find(b => b.bot_key === binding.bot_key);

    if (existing) {
      Object.assign(existing, binding, { updated_at: now });
      save(store);
      return existing;
    }

    const newBinding: IMBinding = {
      ...binding,
      id: `im_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: now,
      updated_at: now,
    };
    store.bindings.push(newBinding);
    save(store);
    return newBinding;
  },

  remove(botKey: string): boolean {
    const store = load();
    const idx = store.bindings.findIndex(b => b.bot_key === botKey);
    if (idx < 0) return false;
    store.bindings.splice(idx, 1);
    save(store);
    return true;
  },
};
