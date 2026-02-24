/**
 * E2E Helper: AgentStudio Backend Lifecycle
 *
 * Starts / stops an isolated agentstudio backend instance for testing.
 * Uses NO_AUTH=true so tests don't need JWT tokens.
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, '../../../backend');
const BACKEND_ENTRY = resolve(BACKEND_DIR, 'dist/index.js');

const READY_PATTERN = /backend running on http/i;
const STARTUP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export class BackendServer {
  constructor({ port, dataDir, env = {} } = {}) {
    this.port = port ?? 4951;
    this.dataDir = dataDir ?? null;
    this.extraEnv = env;
    this.process = null;
    this.url = `http://localhost:${this.port}`;
  }

  async start() {
    if (this.process) throw new Error('BackendServer already started');

    const env = {
      ...process.env,
      PORT: String(this.port),
      NO_AUTH: 'true',
      NODE_ENV: 'test',
      ...(this.dataDir ? { DATA_DIR: this.dataDir } : {}),
      ...this.extraEnv,
    };

    this.process = spawn('node', [BACKEND_ENTRY], {
      cwd: BACKEND_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this._stdout = '';
    this._stderr = '';
    this.process.stdout.on('data', d => { this._stdout += d.toString(); });
    this.process.stderr.on('data', d => { this._stderr += d.toString(); });

    await this._waitForReady();
    return this;
  }

  async _waitForReady() {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (READY_PATTERN.test(this._stdout)) return;
      if (this.process.exitCode !== null) {
        throw new Error(
          `Backend exited unexpectedly (code ${this.process.exitCode})\n${this._stderr.slice(-500)}`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Backend did not become ready within ${STARTUP_TIMEOUT_MS}ms`);
  }

  async stop() {
    if (!this.process) return;
    this.process.kill('SIGTERM');
    await new Promise(resolve => {
      this.process.once('exit', resolve);
      setTimeout(resolve, 3000); // force-resolve after 3s
    });
    this.process = null;
  }

  /** Convenience: GET request to this backend */
  async get(path) {
    const res = await fetch(`${this.url}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Convenience: POST request to this backend */
  async post(path, data) {
    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    // For SSE responses, don't try to parse JSON
    const contentType = res.headers.get('content-type') || '';
    let body = null;
    if (!contentType.includes('text/event-stream')) {
      body = await res.json().catch(() => null);
    }
    return { status: res.status, body, headers: res.headers };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
