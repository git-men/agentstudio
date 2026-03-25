#!/usr/bin/env node
/**
 * Ensure Rust toolchain is available.
 * If missing, auto-install via rustup and source the environment.
 */

import { execSync } from 'child_process';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

function hasCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function addCargoToPath() {
  const cargoEnv = join(homedir(), '.cargo', 'env');
  if (existsSync(cargoEnv)) {
    try {
      const pathAddition = execSync(`. "${cargoEnv}" && echo "$PATH"`, {
        encoding: 'utf-8',
        shell: '/bin/sh',
      }).trim();
      process.env.PATH = pathAddition;
    } catch { /* ignore */ }
  }

  const cargoBin = join(homedir(), '.cargo', 'bin');
  if (existsSync(cargoBin) && !process.env.PATH.includes(cargoBin)) {
    process.env.PATH = `${cargoBin}:${process.env.PATH}`;
  }
}

if (hasCommand('cargo')) {
  process.exit(0);
}

addCargoToPath();
if (hasCommand('cargo')) {
  process.exit(0);
}

console.log('\n📦 Rust toolchain not found, installing via rustup...\n');

try {
  execSync(
    'curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
    { stdio: 'inherit', shell: '/bin/sh' },
  );
} catch (err) {
  console.error('\n❌ Rust installation failed:', err.message);
  console.error('   Please install manually: https://rustup.rs/\n');
  process.exit(1);
}

addCargoToPath();

if (!hasCommand('cargo')) {
  console.error('\n❌ Rust installed but cargo not found in PATH.');
  console.error('   Try restarting your terminal, then run again.\n');
  process.exit(1);
}

console.log('\n✅ Rust installed successfully.\n');
