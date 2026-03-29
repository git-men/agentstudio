#!/usr/bin/env node
/**
 * Build the clawstudio-backend sidecar binary for one or more target platforms.
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
 *   clawstudio-backend-<arch>-<os>
 * e.g.  clawstudio-backend-aarch64-apple-darwin
 *       clawstudio-backend-x86_64-apple-darwin
 *       clawstudio-backend-x86_64-pc-windows-msvc.exe
 *       clawstudio-backend-x86_64-unknown-linux-gnu
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, renameSync, mkdtempSync, realpathSync, chmodSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'fs';
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
  const outname = `clawstudio-backend-${triple}${isWindows ? '.exe' : ''}`;
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

// ── Engine CLI bundling ───────────────────────────────────────────────────────
//
// Bundle engine-specific CLI tools as Tauri externalBin sidecars so the desktop
// app is fully self-contained and doesn't require users to install Node.js or
// run `npm install -g <package>`.
//
// If the npm package is inaccessible (e.g. internal registry unavailable), a
// stub executable is written instead so that Tauri's build doesn't fail. The
// stub exits with an error message; `check_cli_installed` in lib.rs detects it
// and tells the setup wizard the CLI is not available.

const ENGINE_CLIS = [
  { cliName: 'claude-internal', npmPackage: '@tencent/claude-code-internal' },
];

/** Bundle one CLI tool for a given Tauri target triple. */
function bundleEngineCli({ cliName, npmPackage, triple }) {
  const isWindows = triple.includes('windows');
  const outname = `${cliName}-${triple}${isWindows ? '.exe' : ''}`;
  const outfile = join(BINARIES_DIR, outname);

  if (existsSync(outfile)) {
    process.stderr.write(`[build-sidecar] Skipping ${cliName} for ${triple} (already exists)\n`);
    return;
  }

  process.stderr.write(`[build-sidecar] Bundling ${cliName} from ${npmPackage} for ${triple}...\n`);
  const tmpDir = mkdtempSync(join(os.tmpdir(), `claw-cli-`));

  try {
    execSync(`npm install --prefix "${tmpDir}" "${npmPackage}" --no-save`, {
      stdio: 'pipe',
      timeout: 120_000,
    });

    // Resolve the CLI binary: node_modules/.bin/<cliName> is usually a symlink
    const binLink = join(tmpDir, 'node_modules', '.bin', cliName);
    if (!existsSync(binLink)) {
      throw new Error(`Binary '${cliName}' not found in ${join(tmpDir, 'node_modules/.bin')}`);
    }
    let realBin = binLink;
    try { realBin = realpathSync(binLink); } catch { /* use symlink path */ }

    const header = readFileSync(realBin).slice(0, 2).toString();
    const isScript = header === '#!';
    const bunTarget = TARGET_MAP[triple];

    if (isScript && bunTarget) {
      // JS/shell script entry point → compile to standalone binary with bun
      const cmd = [
        'bun', 'build', '--compile',
        `--target=${bunTarget}`,
        `--outfile=${outfile}`,
        realBin,
      ].join(' ');
      execSync(cmd, { stdio: 'inherit' });
    } else {
      // Pre-compiled native binary → copy directly
      copyFileSync(realBin, outfile);
      chmodSync(outfile, 0o755);
    }

    process.stderr.write(`[build-sidecar] ✓ Bundled ${cliName}\n`);
  } catch (e) {
    process.stderr.write(`[build-sidecar] ⚠ Could not bundle ${cliName}: ${e.message}\n`);
    process.stderr.write(`[build-sidecar] → Writing stub (install ${npmPackage} to enable full functionality)\n`);
    // Write a stub so tauri.conf.json's externalBin entry doesn't break the build.
    // lib.rs detects this stub text and reports the CLI as not-found to the wizard.
    const stub = [
      '#!/bin/sh',
      `echo "Error: ${npmPackage} was not bundled in this build." >&2`,
      `echo "Please run: npm install -g ${npmPackage}" >&2`,
      'exit 1',
    ].join('\n') + '\n';
    writeFileSync(outfile, stub, { mode: 0o755 });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
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

// Bundle engine CLI tools (non-fatal: stubs are written on failure)
process.stderr.write('[build-sidecar] Bundling engine CLIs...\n');
for (const triple of targets) {
  for (const cli of ENGINE_CLIS) {
    bundleEngineCli({ ...cli, triple });
  }
}
process.stderr.write('[build-sidecar] Engine CLI bundling complete.\n');
