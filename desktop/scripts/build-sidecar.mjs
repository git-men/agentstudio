#!/usr/bin/env node
/**
 * Build the agentstudio-backend sidecar binary for one or more target platforms.
 *
 * Usage:
 *   node scripts/build-sidecar.mjs                     # current platform only
 *   node scripts/build-sidecar.mjs --platform darwin   # darwin (arm64 + x64)
 *   node scripts/build-sidecar.mjs --platform windows  # windows x64
 *   node scripts/build-sidecar.mjs --platform linux    # linux x64
 *   node scripts/build-sidecar.mjs --all               # all four targets
 *
 * Output binaries are placed in desktop/src-tauri/binaries/ with the naming
 * convention required by Tauri v2:
 *   agentstudio-backend-<arch>-<os>
 * e.g.  agentstudio-backend-aarch64-apple-darwin
 *       agentstudio-backend-x86_64-apple-darwin
 *       agentstudio-backend-x86_64-pc-windows-msvc.exe
 *       agentstudio-backend-x86_64-unknown-linux-gnu
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DESKTOP_DIR = resolve(__dirname, '..');
const BACKEND_ENTRY = resolve(DESKTOP_DIR, '../backend/src/index.ts');
const BINARIES_DIR = join(DESKTOP_DIR, 'src-tauri/binaries');

/** Tauri target-triple → bun --target value */
const TARGET_MAP = {
  'aarch64-apple-darwin':       'bun-darwin-arm64',
  'x86_64-apple-darwin':        'bun-darwin-x64',
  'x86_64-pc-windows-msvc':     'bun-windows-x64',
  'x86_64-unknown-linux-gnu':   'bun-linux-x64',
};

function getCurrentTargetTriple() {
  const arch = os.arch();  // 'arm64' | 'x64' | 'ia32' | ...
  const platform = os.platform(); // 'darwin' | 'win32' | 'linux'
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  } else if (platform === 'win32') {
    return 'x86_64-pc-windows-msvc';
  } else {
    return 'x86_64-unknown-linux-gnu';
  }
}

function getTargetsForPlatform(platform) {
  switch (platform) {
    case 'darwin':
      return ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
    case 'windows':
      return ['x86_64-pc-windows-msvc'];
    case 'linux':
      return ['x86_64-unknown-linux-gnu'];
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

function buildTarget(triple) {
  const bunTarget = TARGET_MAP[triple];
  if (!bunTarget) throw new Error(`No bun target mapping for triple: ${triple}`);

  const isWindows = triple.includes('windows');
  const outname = `agentstudio-backend-${triple}${isWindows ? '.exe' : ''}`;
  const outfile = join(BINARIES_DIR, outname);

  process.stderr.write(`[build-sidecar] Building ${triple} → ${outname}\n`);

  const cmd = [
    'bun', 'build',
    '--compile',
    `--target=${bunTarget}`,
    `--outfile=${outfile}`,
    BACKEND_ENTRY,
  ].join(' ');

  process.stderr.write(`[build-sidecar] $ ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: DESKTOP_DIR });
  process.stderr.write(`[build-sidecar] ✓ ${outname}\n`);
}

// ── Workaround: bun bundler follows .d.ts imports as real modules ─────────────
// @a2a-js/sdk uses tsup chunked types (types-*.d.ts) that reference non-existent
// .js counterparts. Temporarily hiding the server .d.ts during bun compile.

import { readdirSync } from 'fs';

function findA2aDtsFiles() {
  const found = [];
  const pnpmDir = join(DESKTOP_DIR, '..', 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return found;
  try {
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith('@a2a-js+sdk@')) continue;
      const candidate = join(pnpmDir, entry, 'node_modules', '@a2a-js', 'sdk', 'dist', 'server', 'index.d.ts');
      if (existsSync(candidate)) found.push(candidate);
    }
  } catch { /* ignore */ }
  return found;
}

function hideA2aDts() {
  const files = findA2aDtsFiles();
  for (const f of files) {
    renameSync(f, f + '.bun-hide');
    process.stderr.write(`[build-sidecar] workaround: hid ${f}\n`);
  }
  return files;
}

function restoreA2aDts(files) {
  for (const f of files) {
    const hidden = f + '.bun-hide';
    if (existsSync(hidden)) {
      renameSync(hidden, f);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!existsSync(BINARIES_DIR)) {
  mkdirSync(BINARIES_DIR, { recursive: true });
}

const args = process.argv.slice(2);
let targets;

if (args.includes('--all')) {
  targets = Object.keys(TARGET_MAP);
} else {
  const platformIdx = args.indexOf('--platform');
  if (platformIdx !== -1 && args[platformIdx + 1]) {
    targets = getTargetsForPlatform(args[platformIdx + 1]);
  } else {
    targets = [getCurrentTargetTriple()];
  }
}

process.stderr.write(`[build-sidecar] Targets: ${targets.join(', ')}\n`);

const hiddenDtsFiles = hideA2aDts();

let failed = 0;
try {
  for (const triple of targets) {
    try {
      buildTarget(triple);
    } catch (err) {
      process.stderr.write(`[build-sidecar] ✗ Failed for ${triple}: ${err.message}\n`);
      failed++;
    }
  }
} finally {
  restoreA2aDts(hiddenDtsFiles);
}

if (failed > 0) {
  process.stderr.write(`[build-sidecar] ${failed} target(s) failed.\n`);
  process.exit(1);
} else {
  process.stderr.write('[build-sidecar] All targets built successfully.\n');
}
