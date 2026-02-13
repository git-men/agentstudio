/**
 * Directory Migration Module
 *
 * Handles automatic migration from legacy directory layouts:
 *   - ~/.claude-agent/  → ~/.agentstudio/
 *   - ~/.agent-studio/  → ~/.agentstudio/
 *
 * Migration is performed once on startup. A `.migrated` marker file
 * is placed in each legacy directory to avoid repeated migration.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import {
  AGENTSTUDIO_HOME,
  LEGACY_CLAUDE_AGENT_DIR,
  LEGACY_AGENT_STUDIO_DIR,
  AGENTS_DIR,
  DATA_DIR,
  CONFIG_DIR,
  SLIDES_DIR,
  CLAUDE_VERSIONS_FILE,
  SLACK_SESSION_LOCKS_DIR,
  SCHEDULED_TASKS_DIR,
  SCHEDULED_TASKS_HISTORY_DIR,
  META_AGENT_WORKING_DIR,
} from './paths.js';

const MIGRATED_MARKER = '.migrated';

interface MigrationMapping {
  src: string;
  dest: string;
  isDir?: boolean;
}

/**
 * Safely copy a file if source exists and destination does not.
 */
function safeCopyFile(src: string, dest: string): boolean {
  if (!existsSync(src)) return false;
  if (existsSync(dest)) return false; // Don't overwrite existing files

  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  copyFileSync(src, dest);
  return true;
}

/**
 * Recursively copy a directory (files only, skipping existing).
 */
function safeCopyDir(src: string, dest: string): number {
  if (!existsSync(src)) return 0;

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  let copied = 0;
  const entries = readdirSync(src);

  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copied += safeCopyDir(srcPath, destPath);
    } else if (stat.isFile()) {
      if (safeCopyFile(srcPath, destPath)) {
        copied++;
      }
    }
  }

  return copied;
}

/**
 * Mark a legacy directory as migrated.
 */
function markMigrated(legacyDir: string): void {
  const marker = join(legacyDir, MIGRATED_MARKER);
  if (!existsSync(marker)) {
    writeFileSync(marker, JSON.stringify({
      migratedAt: new Date().toISOString(),
      migratedTo: AGENTSTUDIO_HOME,
      version: '1.0',
    }, null, 2));
  }
}

/**
 * Check if a legacy directory has already been migrated.
 */
function isMigrated(legacyDir: string): boolean {
  return existsSync(join(legacyDir, MIGRATED_MARKER));
}

/**
 * Migrate from ~/.claude-agent/ to new unified layout.
 */
function migrateFromClaudeAgent(): number {
  const src = LEGACY_CLAUDE_AGENT_DIR;
  if (!existsSync(src) || isMigrated(src)) return 0;

  let totalCopied = 0;

  // File mappings: ~/.claude-agent/X → ~/.agentstudio/Y
  const fileMappings: MigrationMapping[] = [
    { src: join(src, 'projects.json'), dest: join(DATA_DIR, 'projects.json') },
    { src: join(src, 'claude-versions.json'), dest: join(DATA_DIR, 'claude-versions.json') },
    { src: join(src, 'mcp-server.json'), dest: join(DATA_DIR, 'mcp-server.json') },
    { src: join(src, 'a2a-agent-mappings.json'), dest: join(DATA_DIR, 'a2a-agent-mappings.json') },
    { src: join(src, 'admin-api-keys.json'), dest: join(DATA_DIR, 'admin-api-keys.json') },
    { src: join(src, 'tunnel-config.json'), dest: join(DATA_DIR, 'tunnel-config.json') },
  ];

  for (const mapping of fileMappings) {
    if (safeCopyFile(mapping.src, mapping.dest)) {
      totalCopied++;
    }
  }

  // Also migrate port-specific tunnel configs
  if (existsSync(src)) {
    const entries = readdirSync(src);
    for (const entry of entries) {
      if (entry.startsWith('tunnel-config-') && entry.endsWith('.json')) {
        if (safeCopyFile(join(src, entry), join(DATA_DIR, entry))) {
          totalCopied++;
        }
      }
    }
  }

  // Directory mappings
  totalCopied += safeCopyDir(join(src, 'agents'), AGENTS_DIR);
  totalCopied += safeCopyDir(join(src, 'slack-session-locks'), SLACK_SESSION_LOCKS_DIR);
  totalCopied += safeCopyDir(join(src, 'scheduled-tasks'), SCHEDULED_TASKS_DIR);

  if (totalCopied > 0) {
    markMigrated(src);
    console.log(`[Migration] Migrated ${totalCopied} files from ~/.claude-agent/ → ${AGENTSTUDIO_HOME}`);
  }

  return totalCopied;
}

/**
 * Migrate from ~/.agent-studio/ to new unified layout.
 */
function migrateFromAgentStudio(): number {
  const src = LEGACY_AGENT_STUDIO_DIR;
  if (!existsSync(src) || isMigrated(src)) return 0;

  let totalCopied = 0;

  // File mappings
  const fileMappings: MigrationMapping[] = [
    { src: join(src, 'config', 'config.json'), dest: join(CONFIG_DIR, 'config.json') },
  ];

  for (const mapping of fileMappings) {
    if (safeCopyFile(mapping.src, mapping.dest)) {
      totalCopied++;
    }
  }

  // Directory: slides
  totalCopied += safeCopyDir(join(src, 'data', 'slides'), SLIDES_DIR);

  if (totalCopied > 0) {
    markMigrated(src);
    console.log(`[Migration] Migrated ${totalCopied} files from ~/.agent-studio/ → ${AGENTSTUDIO_HOME}`);
  }

  return totalCopied;
}

/**
 * Migrate legacy files that were in the root of ~/.agentstudio/
 * (speech-to-text.json, instance_id) to their new subdirectory locations.
 */
function migrateWithinAgentstudio(): number {
  let totalCopied = 0;

  // speech-to-text.json was at ~/.agentstudio/speech-to-text.json
  // now at ~/.agentstudio/data/speech-to-text.json
  if (safeCopyFile(
    join(AGENTSTUDIO_HOME, 'speech-to-text.json'),
    join(DATA_DIR, 'speech-to-text.json')
  )) {
    totalCopied++;
  }

  // instance_id was at ~/.agentstudio/instance_id
  // now at ~/.agentstudio/run/instance_id
  const runDir = join(AGENTSTUDIO_HOME, 'run');
  if (safeCopyFile(
    join(AGENTSTUDIO_HOME, 'instance_id'),
    join(runDir, 'instance_id')
  )) {
    totalCopied++;
  }

  // agentstudio.pid was at ~/.agentstudio/agentstudio.pid
  // now at ~/.agentstudio/run/agentstudio.pid
  if (safeCopyFile(
    join(AGENTSTUDIO_HOME, 'agentstudio.pid'),
    join(runDir, 'agentstudio.pid')
  )) {
    totalCopied++;
  }

  if (totalCopied > 0) {
    console.log(`[Migration] Reorganized ${totalCopied} files within ${AGENTSTUDIO_HOME}`);
  }

  return totalCopied;
}

/**
 * Ensure all required directories exist.
 */
function ensureDirectories(): void {
  const dirs = [
    AGENTSTUDIO_HOME,
    CONFIG_DIR,
    AGENTS_DIR,
    DATA_DIR,
    SLIDES_DIR,
    join(AGENTSTUDIO_HOME, 'run'),
    SLACK_SESSION_LOCKS_DIR,
    SCHEDULED_TASKS_DIR,
    SCHEDULED_TASKS_HISTORY_DIR,
    META_AGENT_WORKING_DIR,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Recover lost provider configs from legacy claude-versions.json.
 *
 * After directory migration, the current file may have lost custom providers
 * (e.g., due to a file corruption + re-initialization cycle). This function
 * checks if the legacy file has more providers than the current file and
 * merges the missing ones back.
 *
 * This runs on every startup and is idempotent — providers are matched
 * by ID to avoid duplicates.
 */
function recoverLegacyProviders(): void {
  const legacySrc = join(LEGACY_CLAUDE_AGENT_DIR, 'claude-versions.json');
  const currentDest = CLAUDE_VERSIONS_FILE;

  if (!existsSync(legacySrc)) return;

  let legacyData: { versions?: any[]; defaultVersionId?: string | null };
  let currentData: { versions?: any[]; defaultVersionId?: string | null };

  try {
    legacyData = JSON.parse(readFileSync(legacySrc, 'utf-8'));
  } catch {
    return; // legacy file unreadable, skip
  }

  try {
    currentData = existsSync(currentDest)
      ? JSON.parse(readFileSync(currentDest, 'utf-8'))
      : { versions: [], defaultVersionId: null };
  } catch {
    // current file corrupted — use legacy as source of truth
    currentData = { versions: [], defaultVersionId: null };
  }

  const legacyVersions = Array.isArray(legacyData.versions) ? legacyData.versions : [];
  const currentVersions = Array.isArray(currentData.versions) ? currentData.versions : [];

  if (legacyVersions.length <= currentVersions.length) {
    return; // Current already has at least as many, no recovery needed
  }

  const currentIds = new Set(currentVersions.map((v: any) => v.id));
  let merged = 0;

  for (const legacyVersion of legacyVersions) {
    if (!legacyVersion.id || currentIds.has(legacyVersion.id)) continue;

    // Skip system versions — the new system version is already initialized
    if (legacyVersion.isSystem) continue;

    currentVersions.push(legacyVersion);
    currentIds.add(legacyVersion.id);
    merged++;
  }

  if (merged > 0) {
    // If the default provider from legacy is now present but current default is missing,
    // restore the legacy default
    if (legacyData.defaultVersionId && currentIds.has(legacyData.defaultVersionId)) {
      const currentDefault = currentData.defaultVersionId;
      if (!currentDefault || !currentIds.has(currentDefault) || currentDefault === 'claude') {
        currentData.defaultVersionId = legacyData.defaultVersionId;
      }
    }

    currentData.versions = currentVersions;

    const destDir = dirname(currentDest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    writeFileSync(currentDest, JSON.stringify(currentData, null, 2), 'utf-8');
    console.log(`[Migration] Recovered ${merged} provider(s) from legacy config (~/.claude-agent/claude-versions.json)`);
  }
}

/**
 * Run all migrations. Safe to call on every startup.
 * Only performs actual work the first time legacy directories are detected.
 */
export function runMigrations(): void {
  try {
    // Ensure base directories exist first
    ensureDirectories();

    // Run migrations
    migrateFromClaudeAgent();
    migrateFromAgentStudio();
    migrateWithinAgentstudio();

    // Recover lost providers from legacy config (idempotent, safe to run always)
    recoverLegacyProviders();
  } catch (error) {
    // Migration errors should never prevent startup
    console.error('[Migration] Warning: Migration encountered an error:', error);
  }
}
