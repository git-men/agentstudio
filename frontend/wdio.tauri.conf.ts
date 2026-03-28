/**
 * WebdriverIO configuration for Tauri native E2E testing.
 *
 * Uses tauri-plugin-webdriver which embeds a W3C WebDriver server
 * directly in the Tauri debug build (port 4445).
 *
 * Prerequisites:
 * 1. Build Tauri app with webdriver feature:
 *    cd desktop/src-tauri && cargo tauri build --debug --features webdriver
 *    OR: cargo tauri dev --features webdriver
 *
 * 2. Install WebdriverIO deps:
 *    pnpm add -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
 *
 * 3. Run: pnpm exec wdio wdio.tauri.conf.ts
 */
import type { Options } from '@wdio/types';
import * as path from 'path';

const TAURI_APP_BINARY = path.resolve(
  __dirname,
  '../desktop/src-tauri/target/debug/clawstudio',
);

export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    tsNodeOpts: {
      project: './tsconfig.json',
    },
  },

  specs: ['./tests/e2e-tauri/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'wdio:devtoolsOptions': {
        headless: false,
      },
    } as WebdriverIO.Capabilities,
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 30000,
  connectionRetryCount: 3,

  hostname: '127.0.0.1',
  port: 4445,
  path: '/',

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  /**
   * Launch the Tauri app before tests. The app binary must have been
   * built with --features webdriver so the WebDriver server is active.
   */
  onPrepare: async function () {
    const { spawn } = await import('child_process');
    const fs = await import('fs');

    if (!fs.existsSync(TAURI_APP_BINARY)) {
      throw new Error(
        `Tauri app binary not found at ${TAURI_APP_BINARY}. ` +
        'Build it first: cd desktop/src-tauri && cargo tauri build --debug --features webdriver',
      );
    }

    const child = spawn(TAURI_APP_BINARY, [], {
      env: { ...process.env, RUST_LOG: 'info' },
      stdio: 'pipe',
    });

    // @ts-expect-error attaching to global for cleanup
    globalThis.__TAURI_E2E_CHILD__ = child;

    child.stdout?.on('data', (data: Buffer) => {
      console.log(`[tauri] ${data.toString().trim()}`);
    });
    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[tauri] ${data.toString().trim()}`);
    });

    // Wait for WebDriver server to be ready
    const startTime = Date.now();
    const timeout = 30000;
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch('http://127.0.0.1:4445/status');
        if (response.ok) {
          console.log('Tauri WebDriver server is ready');
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Tauri WebDriver server did not start within 30 seconds');
  },

  onComplete: async function () {
    // @ts-expect-error reading from global
    const child = globalThis.__TAURI_E2E_CHILD__;
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 2000));
      if (!child.killed) child.kill('SIGKILL');
    }
  },
};
