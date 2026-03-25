#!/usr/bin/env node
/**
 * Ensure Rust toolchain is available, then run the given command.
 *
 * Usage:  node scripts/ensure-rust.mjs <command> [args...]
 * Example: node scripts/ensure-rust.mjs tauri dev
 *
 * If cargo is missing, installs Rust via rustup, adds ~/.cargo/bin
 * to PATH, then spawns the command with the updated environment.
 */

import { execSync, spawn } from 'child_process';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

function ensureCargoInPath() {
  const cargoBin = join(homedir(), '.cargo', 'bin');
  if (existsSync(cargoBin) && !process.env.PATH.includes(cargoBin)) {
    process.env.PATH = `${cargoBin}:${process.env.PATH}`;
  }
}

function hasCargo() {
  try {
    execSync('cargo --version', { stdio: 'pipe', env: process.env });
    return true;
  } catch {
    return false;
  }
}

function installRust() {
  console.log('\n📦 Rust toolchain not found, installing via rustup...\n');
  try {
    execSync(
      "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      { stdio: 'inherit', shell: '/bin/sh' },
    );
  } catch (err) {
    console.error('\n❌ Rust installation failed:', err.message);
    console.error('   Please install manually: https://rustup.rs/\n');
    process.exit(1);
  }

  ensureCargoInPath();

  if (!hasCargo()) {
    console.error('\n❌ Rust installed but cargo not found in PATH.');
    console.error('   Try restarting your terminal, then run again.\n');
    process.exit(1);
  }

  console.log('✅ Rust installed successfully.\n');
}

// --- main ---

ensureCargoInPath();

if (!hasCargo()) {
  installRust();
}

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
