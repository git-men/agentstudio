#!/usr/bin/env node

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, '..', '..');
const BACKEND_DIR = resolve(ROOT_DIR, 'backend');
const FRONTEND_DIR = resolve(ROOT_DIR, 'frontend');
const backendRequire = createRequire(resolve(BACKEND_DIR, 'package.json'));
const frontendRequire = createRequire(resolve(FRONTEND_DIR, 'package.json'));
const tsxCli = backendRequire.resolve('tsx/cli');
const viteCli = resolve(dirname(frontendRequire.resolve('vite/package.json')), 'bin', 'vite.js');
const children = [];
let shuttingDown = false;

function terminate(child) {
  if (!child?.pid) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    terminate(child);
  }

  setTimeout(() => process.exit(code), 250);
}

function startService(name, cwd, commandArgs, extraEnv) {
  const child = spawn(process.execPath, commandArgs, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`[start-dev-services] Failed to start ${name}: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    if (signal) {
      console.error(`[start-dev-services] ${name} exited from signal ${signal}`);
    } else if (code !== 0) {
      console.error(`[start-dev-services] ${name} exited with code ${code}`);
    } else {
      console.error(`[start-dev-services] ${name} exited unexpectedly`);
    }

    shutdown(code ?? 1);
  });

  children.push(child);
}

startService(
  'backend',
  BACKEND_DIR,
  [tsxCli, 'watch', 'src/index.ts'],
  {
    PORT: '4938',
    TAURI_DESKTOP: '1',
  },
);

startService(
  'frontend',
  FRONTEND_DIR,
  [viteCli],
  {
    PORT: '3100',
    VITE_API_PORT: '4938',
    VITE_API_BASE: '/api',
  },
);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
