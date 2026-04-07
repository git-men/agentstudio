import { readFile, writeFile, mkdir, rename, access, constants } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { ClaudeVersion, ClaudeVersionCreate, ClaudeVersionUpdate, ModelConfig } from '../types/claude-versions';
import { CLAUDE_AGENT_DIR, CLAUDE_VERSIONS_FILE, CLAUDE_INTERNAL_VERSIONS_FILE } from '../config/paths.js';
import { isClaudeInternalEngine } from '../config/engineConfig.js';
import { encryptEnvVars, decryptEnvVars, migrateToEncrypted } from './secretStore.js';

const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'opus',
    name: 'Opus',
    isVision: true,
    description: 'Claude Opus - 最强大的模型'
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    isVision: true,
    description: 'Claude Sonnet - 平衡性能和成本的模型'
  }
];

function getVersionsFile(): string {
  return isClaudeInternalEngine() ? CLAUDE_INTERNAL_VERSIONS_FILE : CLAUDE_VERSIONS_FILE;
}

function getBackupFile(): string {
  return getVersionsFile() + '.bak';
}

interface VersionStorage {
  versions: ClaudeVersion[];
  defaultVersionId: string | null;
}

// ─── File Lock ───────────────────────────────────────────────────────────────
// Simple in-process mutex to prevent concurrent read-modify-write cycles.

let _writeLock: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const prev = _writeLock;
  _writeLock = next;
  return prev.then(fn).finally(() => release!());
}

// ─── Directory helpers ───────────────────────────────────────────────────────

async function ensureClaudeAgentDir() {
  try {
    await mkdir(CLAUDE_AGENT_DIR, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

async function ensureParentDir(filePath: string) {
  const dir = dirname(filePath);
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

// ─── Atomic write with backup ────────────────────────────────────────────────

async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
  await ensureParentDir(filePath);

  const content = JSON.stringify(data, null, 2);
  const tmpFile = filePath + '.tmp.' + process.pid;

  try {
    await writeFile(tmpFile, content, 'utf-8');

    // Create backup of the existing file before overwriting
    try {
      await access(filePath, constants.F_OK);
      await copyFileForBackup(filePath, getBackupFile());
    } catch {
      // No existing file to back up — first run
    }

    // Atomic rename
    await rename(tmpFile, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try { await import('fs/promises').then(fs => fs.unlink(tmpFile)); } catch { /* ignore */ }
    throw error;
  }
}

async function copyFileForBackup(src: string, dest: string): Promise<void> {
  const content = await readFile(src, 'utf-8');
  await writeFile(dest, content, 'utf-8');
}

// ─── Data migration ─────────────────────────────────────────────────────────

function migrateVersionData(storage: VersionStorage): { storage: VersionStorage; changed: boolean } {
  let changed = false;

  const migratedVersions = storage.versions.map(version => {
    if (!version.models || version.models.length === 0) {
      changed = true;
      return { ...version, models: DEFAULT_MODELS };
    }
    return version;
  });

  return {
    storage: { versions: migratedVersions, defaultVersionId: storage.defaultVersionId },
    changed,
  };
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

export async function loadClaudeVersions(): Promise<VersionStorage> {
  await ensureClaudeAgentDir();

  const versionsFile = getVersionsFile();
  const backupFile = getBackupFile();

  // Try primary file first
  const primary = await tryReadVersionStorage(versionsFile);
  if (primary) {
    const { storage: migrated, changed: dataMigrated } = migrateVersionData(primary);

    // Migrate plaintext secrets to encrypted form
    let secretsMigrated = false;
    for (const version of migrated.versions) {
      if (version.environmentVariables && Object.keys(version.environmentVariables).length > 0) {
        const { migrated: didMigrate, result } = await migrateToEncrypted(
          version.environmentVariables,
          `version:${version.id}`,
        );
        if (didMigrate) {
          version.environmentVariables = result;
          secretsMigrated = true;
        }
      }
    }

    if (dataMigrated || secretsMigrated) {
      await atomicWriteJSON(versionsFile, migrated);
      if (secretsMigrated) {
        console.log('[VersionStorage] Migrated plaintext credentials to encrypted storage');
      }
    }
    return migrated;
  }

  // Primary file failed or missing — try backup recovery
  const backup = await tryReadVersionStorage(backupFile);
  if (backup) {
    console.warn(`[VersionStorage] Primary file unreadable, recovered from backup: ${backupFile}`);
    const { storage, changed } = migrateVersionData(backup);
    await atomicWriteJSON(versionsFile, storage);
    return storage;
  }

  // Neither file exists or both are corrupted — fresh start
  console.log(`[VersionStorage] No existing config found (${versionsFile}), starting fresh`);
  return { versions: [], defaultVersionId: null };
}

async function tryReadVersionStorage(filePath: string): Promise<VersionStorage | null> {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return null; // File does not exist
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Basic shape validation
    if (!data || !Array.isArray(data.versions)) {
      console.error(`[VersionStorage] Invalid data shape in ${filePath}`);
      return null;
    }

    // Clean up any leaked internal properties
    const clean: VersionStorage = {
      versions: data.versions,
      defaultVersionId: data.defaultVersionId ?? null,
    };
    return clean;
  } catch (error) {
    console.error(`[VersionStorage] Failed to parse ${filePath}:`, error);
    return null;
  }
}

export async function saveClaudeVersions(storage: VersionStorage): Promise<void> {
  await ensureClaudeAgentDir();

  // Only persist the VersionStorage shape
  const clean: VersionStorage = {
    versions: storage.versions,
    defaultVersionId: storage.defaultVersionId,
  };
  await atomicWriteJSON(getVersionsFile(), clean);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function hideSensitiveEnvVars(envVars: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (key === 'ANTHROPIC_AUTH_TOKEN') {
      if (value && value.length > 8) {
        const start = value.substring(0, 4);
        const end = value.substring(value.length - 4);
        result[key] = `${start}***${end}`;
      } else {
        result[key] = '***';
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getAllVersions(): Promise<ClaudeVersion[]> {
  const storage = await loadClaudeVersions();

  return storage.versions.map(version => ({
    ...version,
    environmentVariables: hideSensitiveEnvVars(version.environmentVariables || {})
  }));
}

export async function getAllVersionsInternal(): Promise<ClaudeVersion[]> {
  const storage = await loadClaudeVersions();

  // Decrypt sensitive environment variables for runtime use
  for (const version of storage.versions) {
    if (version.environmentVariables && Object.keys(version.environmentVariables).length > 0) {
      version.environmentVariables = await decryptEnvVars(
        version.environmentVariables,
        `version:${version.id}`,
      );
    }
  }

  return storage.versions;
}

export async function getVersionByIdInternal(versionId: string): Promise<ClaudeVersion | null> {
  const storage = await loadClaudeVersions();

  const version = storage.versions.find(v => v.id === versionId) || null;

  if (version) {
    console.log(`📦 Loaded version ${version.alias} (${versionId})`);
    const envVarKeys = Object.keys(version.environmentVariables || {});
    if (envVarKeys.length > 0) {
      console.log(`   Environment variables: ${envVarKeys.join(', ')}`);
    } else {
      console.log(`   No environment variables configured`);
    }

    // Decrypt sensitive environment variables for runtime use
    if (version.environmentVariables && Object.keys(version.environmentVariables).length > 0) {
      version.environmentVariables = await decryptEnvVars(
        version.environmentVariables,
        `version:${versionId}`,
      );
    }
  } else {
    console.log(`⚠️ Version not found: ${versionId}`);
  }

  return version;
}

export async function getDefaultVersionId(): Promise<string | null> {
  const storage = await loadClaudeVersions();
  return storage.defaultVersionId;
}

export async function setDefaultVersion(versionId: string): Promise<void> {
  return withWriteLock(async () => {
    const storage = await loadClaudeVersions();

    const version = storage.versions.find(v => v.id === versionId);
    if (!version) {
      throw new Error('版本不存在');
    }

    storage.defaultVersionId = versionId;
    await saveClaudeVersions(storage);
  });
}

export async function createVersion(data: ClaudeVersionCreate): Promise<ClaudeVersion> {
  return withWriteLock(async () => {
    const storage = await loadClaudeVersions();

    const existingAlias = storage.versions.find(v => v.alias === data.alias);
    if (existingAlias) {
      throw new Error('别名已存在');
    }

    const now = new Date().toISOString();
    const versionId = generateId();

    // Encrypt sensitive environment variables before persisting
    const encryptedEnv = data.environmentVariables
      ? await encryptEnvVars(data.environmentVariables, `version:${versionId}`)
      : {};

    const newVersion: ClaudeVersion = {
      id: versionId,
      name: data.name,
      alias: data.alias,
      description: data.description,
      executablePath: data.executablePath,
      isDefault: storage.versions.length === 0,
      isSystem: false,
      environmentVariables: encryptedEnv,
      models: data.models || DEFAULT_MODELS,
      createdAt: now,
      updatedAt: now
    };

    storage.versions.push(newVersion);

    if (storage.versions.length === 1) {
      storage.defaultVersionId = newVersion.id;
    }

    await saveClaudeVersions(storage);
    return newVersion;
  });
}

export async function updateVersion(versionId: string, data: ClaudeVersionUpdate & { authTokenChanged?: boolean }): Promise<ClaudeVersion> {
  return withWriteLock(async () => {
    const storage = await loadClaudeVersions();

    const versionIndex = storage.versions.findIndex(v => v.id === versionId);
    if (versionIndex === -1) {
      throw new Error('版本不存在');
    }

    const version = storage.versions[versionIndex];

    if (data.alias && data.alias !== version.alias) {
      const existingAlias = storage.versions.find(v => v.alias === data.alias && v.id !== versionId);
      if (existingAlias) {
        throw new Error('别名已存在');
      }
    }

    if (version.isSystem) {
      if (data.executablePath && data.executablePath !== version.executablePath) {
        throw new Error('不允许修改系统版本的可执行路径');
      }
    }

    const updatedVersion: ClaudeVersion = {
      ...version,
      ...data,
      updatedAt: new Date().toISOString()
    };

    if (data.executablePath === undefined) {
      delete (updatedVersion as any).executablePath;
    }
    if (data.description === undefined) {
      delete (updatedVersion as any).description;
    }

    // Remove internal-only fields that should not be persisted
    delete (updatedVersion as any).authTokenChanged;

    if (!data.authTokenChanged && data.environmentVariables?.ANTHROPIC_AUTH_TOKEN !== undefined) {
      const originalToken = version.environmentVariables?.ANTHROPIC_AUTH_TOKEN || '';
      updatedVersion.environmentVariables = {
        ...data.environmentVariables,
        ANTHROPIC_AUTH_TOKEN: originalToken
      };
    }

    // Encrypt sensitive environment variables before persisting
    if (updatedVersion.environmentVariables && Object.keys(updatedVersion.environmentVariables).length > 0) {
      updatedVersion.environmentVariables = await encryptEnvVars(
        updatedVersion.environmentVariables,
        `version:${versionId}`,
      );
    }

    storage.versions[versionIndex] = updatedVersion;
    await saveClaudeVersions(storage);

    return updatedVersion;
  });
}

export async function deleteVersion(versionId: string): Promise<void> {
  return withWriteLock(async () => {
    const storage = await loadClaudeVersions();

    const versionIndex = storage.versions.findIndex(v => v.id === versionId);
    if (versionIndex === -1) {
      throw new Error('版本不存在');
    }

    const version = storage.versions[versionIndex];

    if (version.isSystem) {
      throw new Error('不允许删除系统版本');
    }

    storage.versions.splice(versionIndex, 1);

    if (storage.defaultVersionId === versionId) {
      storage.defaultVersionId = storage.versions.length > 0 ? storage.versions[0].id : null;
    }

    await saveClaudeVersions(storage);
  });
}

// ─── System Version Initialization ──────────────────────────────────────────

async function cleanupDuplicateSystemVersions(): Promise<boolean> {
  const storage = await loadClaudeVersions();

  const systemVersions = storage.versions.filter(v => v.isSystem);

  if (systemVersions.length <= 1) {
    return false;
  }

  console.log(`⚠️ Found ${systemVersions.length} system versions, cleaning up duplicates...`);

  const keepVersion = systemVersions[0];
  const removeIds = systemVersions.slice(1).map(v => v.id);

  storage.versions = storage.versions.filter(v => !removeIds.includes(v.id));

  console.log(`✅ Kept system version: ${keepVersion.alias} (${keepVersion.id})`);
  console.log(`🗑️ Removed duplicate system versions: ${removeIds.join(', ')}`);

  await saveClaudeVersions(storage);
  return true;
}

interface EngineMetadata {
  name: string;
  alias: string;
  description: string;
  descriptionNoExec: string;
}

const ENGINE_METADATA: Record<string, EngineMetadata> = {
  'claude-internal-sdk': {
    name: 'Claude Internal',
    alias: 'system',
    description: '内部 Claude Code 版本（claude-internal）',
    descriptionNoExec: '内部 Claude 供应商（需要配置 API 密钥）',
  },
  'claude-sdk': {
    name: 'Claude',
    alias: 'system',
    description: '系统默认的 Claude Code 版本（通过 which claude 查找）',
    descriptionNoExec: '系统默认的 Claude 供应商（需要配置 API 密钥）',
  },
};

export async function initializeSystemVersion(executablePath: string, engineType?: string): Promise<ClaudeVersion> {
  return withWriteLock(async () => {
    await cleanupDuplicateSystemVersions();

    const storage = await loadClaudeVersions();
    const meta = ENGINE_METADATA[engineType || ''] || ENGINE_METADATA['claude-sdk'];
    const hasExecutable = !!executablePath;

    let systemVersion = storage.versions.find(v => v.isSystem === true);
    let changed = false;

    if (systemVersion) {
      const targetExecPath = hasExecutable ? executablePath : undefined;
      if (systemVersion.executablePath !== targetExecPath) {
        systemVersion.executablePath = targetExecPath;
        changed = true;
      }
      if (systemVersion.name !== meta.name) {
        systemVersion.name = meta.name;
        changed = true;
      }
      const targetDescription = hasExecutable ? meta.description : meta.descriptionNoExec;
      if (systemVersion.description !== targetDescription) {
        systemVersion.description = targetDescription;
        changed = true;
      }
      if (changed) {
        systemVersion.updatedAt = new Date().toISOString();
      }
    } else {
      const now = new Date().toISOString();
      systemVersion = {
        id: 'claude',
        name: meta.name,
        alias: meta.alias,
        description: hasExecutable ? meta.description : meta.descriptionNoExec,
        executablePath: hasExecutable ? executablePath : undefined,
        isDefault: storage.versions.length === 0,
        isSystem: true,
        environmentVariables: {},
        models: DEFAULT_MODELS,
        createdAt: now,
        updatedAt: now
      };
      storage.versions.unshift(systemVersion);
      changed = true;
      console.log(`✅ Created new system version: ${systemVersion.alias} (${systemVersion.id})`);
    }

    const currentDefault = storage.defaultVersionId;
    const currentDefaultExists = currentDefault && storage.versions.some(v => v.id === currentDefault);
    if (!currentDefaultExists) {
      console.log(`🔧 Setting system version as default provider (engine: ${engineType || 'claude-sdk'}) — no valid default was set`);
      storage.defaultVersionId = systemVersion.id;
      changed = true;
    }

    if (changed) {
      await saveClaudeVersions(storage);
    }

    return systemVersion;
  });
}
