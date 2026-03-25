#!/usr/bin/env node
/**
 * Ensure all Tauri desktop dependencies are available, then run the given command.
 *
 * Usage:  node scripts/ensure-rust.mjs <command> [args...]
 * Example: node scripts/ensure-rust.mjs tauri dev
 *
 * Checks (and auto-installs where possible):
 *   1. Rust toolchain (cargo/rustc) — via rustup
 *   2. Xcode CLI Tools (macOS only)
 *   3. System libraries (Linux only)
 */

import { execSync, spawn } from 'child_process';
import { homedir, platform } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function tryExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', env: process.env, ...opts }).trim();
  } catch {
    return null;
  }
}

function ensureCargoInPath() {
  const cargoBin = join(homedir(), '.cargo', 'bin');
  if (existsSync(cargoBin) && !process.env.PATH.includes(cargoBin)) {
    process.env.PATH = `${cargoBin}:${process.env.PATH}`;
  }
}

function hasCargo() {
  return tryExec('cargo --version') !== null;
}

// ── Rust ────────────────────────────────────────────────────────────────────

function ensureRust() {
  ensureCargoInPath();
  if (hasCargo()) {
    console.log(`  ${GREEN}✓${RESET} Rust: ${tryExec('rustc --version')}`);
    return;
  }

  console.log(`  ${YELLOW}→${RESET} Rust not found, installing via rustup...`);
  try {
    execSync(
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      { stdio: 'inherit', shell: '/bin/sh' },
    );
  } catch (err) {
    console.error(`\n  ${RED}✗ Rust installation failed:${RESET}`, err.message);
    console.error(`    Install manually: https://rustup.rs/\n`);
    process.exit(1);
  }

  ensureCargoInPath();
  if (!hasCargo()) {
    console.error(`\n  ${RED}✗ Rust installed but cargo not in PATH.${RESET}`);
    console.error(`    Restart your terminal and try again.\n`);
    process.exit(1);
  }
  console.log(`  ${GREEN}✓${RESET} Rust installed: ${tryExec('rustc --version')}`);
}

// ── Xcode CLI Tools (macOS) ─────────────────────────────────────────────────

function ensureXcode() {
  if (platform() !== 'darwin') return;

  if (tryExec('xcode-select -p') !== null) {
    console.log(`  ${GREEN}✓${RESET} Xcode CLI Tools: installed`);
    return;
  }

  console.log(`  ${YELLOW}→${RESET} Xcode CLI Tools not found, installing...`);
  try {
    execSync('xcode-select --install', { stdio: 'inherit' });
    console.log(`  ${YELLOW}⏳${RESET} Xcode CLI Tools installer launched.`);
    console.log(`     Please complete the installation dialog, then re-run this command.\n`);
    process.exit(1);
  } catch {
    if (tryExec('xcode-select -p') !== null) {
      console.log(`  ${GREEN}✓${RESET} Xcode CLI Tools: installed`);
    } else {
      console.error(`  ${RED}✗ Xcode CLI Tools installation failed.${RESET}`);
      console.error(`    Run manually: xcode-select --install\n`);
      process.exit(1);
    }
  }
}

// ── System libraries (Linux) ────────────────────────────────────────────────

function ensureLinuxLibs() {
  if (platform() !== 'linux') return;

  const libs = [
    { pkg: 'libwebkit2gtk-4.1-dev', check: 'pkg-config --exists webkit2gtk-4.1' },
    { pkg: 'libssl-dev', check: 'pkg-config --exists openssl' },
    { pkg: 'librsvg2-dev', check: 'pkg-config --exists librsvg-2.0' },
    { pkg: 'libxdo-dev', check: 'pkg-config --exists libxdo' },
  ];

  const missing = libs.filter((l) => tryExec(l.check) === null).map((l) => l.pkg);

  if (missing.length === 0) {
    console.log(`  ${GREEN}✓${RESET} System libraries: OK`);
    return;
  }

  console.log(`  ${YELLOW}→${RESET} Missing system libraries: ${missing.join(', ')}`);
  console.log(`    Installing via apt...`);
  try {
    execSync(
      `sudo apt-get update -qq && sudo apt-get install -y ${missing.join(' ')} build-essential curl wget file libayatana-appindicator3-dev`,
      { stdio: 'inherit' },
    );
    console.log(`  ${GREEN}✓${RESET} System libraries installed`);
  } catch {
    console.error(`  ${RED}✗ Failed to install system libraries.${RESET}`);
    console.error(`    Run manually: sudo apt install ${missing.join(' ')}\n`);
    process.exit(1);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}${CYAN}Tauri Desktop — Dependency Check${RESET}\n`);

ensureXcode();
ensureRust();
ensureLinuxLibs();

console.log(`\n${GREEN}${BOLD}All checks passed.${RESET}\n`);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const child = spawn(args[0], args.slice(1), {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(`Failed to run: ${args.join(' ')}`, err.message);
  process.exit(1);
});
