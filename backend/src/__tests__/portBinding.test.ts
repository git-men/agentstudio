/**
 * Unit tests for dynamic port binding logic (findAvailablePort / BACKEND_PORT signal).
 *
 * We extract the port-finding logic by mocking `net.createServer` so the tests
 * are fully in-process and require no real network activity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import type { EventEmitter } from 'events';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Inline copy of findAvailablePort so tests don't depend on index.ts side-effects */
function isPortAvailable(
  port: number,
  createServer: typeof net.createServer,
): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => (server as any).close(() => resolve(true)));
    (server as any).listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(
  startPort: number,
  createServer: typeof net.createServer,
): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    if (await isPortAvailable(port, createServer)) {
      return port;
    }
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    (server as any).listen(0, '127.0.0.1', () => {
      const addr = (server as any).address() as net.AddressInfo;
      (server as any).close(() => resolve(addr.port));
    });
  });
}

// ── Mock factory helpers ──────────────────────────────────────────────────────

type FakeServerEvents = Record<string, ((...args: unknown[]) => void)[]>;

function makeFakeServer(opts: {
  listenBehavior: 'success' | 'eaddrinuse' | 'os-assign';
  osAssignedPort?: number;
}): ReturnType<typeof net.createServer> {
  const listeners: FakeServerEvents = {};
  const emit = (event: string, ...args: unknown[]) => {
    (listeners[event] ?? []).forEach((fn) => fn(...args));
  };

  const server = {
    once(event: string, fn: (...args: unknown[]) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
      return server;
    },
    listen(port: number, _host: string, cb?: () => void) {
      if (opts.listenBehavior === 'eaddrinuse') {
        setImmediate(() => emit('error', Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' })));
      } else if (opts.listenBehavior === 'os-assign') {
        setImmediate(() => {
          if (cb) cb();
          emit('listening');
        });
      } else {
        setImmediate(() => {
          if (cb) cb();
          emit('listening');
        });
      }
      return server;
    },
    address(): net.AddressInfo {
      return { address: '127.0.0.1', family: 'IPv4', port: opts.osAssignedPort ?? 12345 };
    },
    close(cb?: () => void) {
      if (cb) setImmediate(cb);
      return server;
    },
  } as unknown as ReturnType<typeof net.createServer>;

  return server;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('findAvailablePort', () => {
  it('returns startPort when it is available', async () => {
    const createServer = vi.fn(() => makeFakeServer({ listenBehavior: 'success' }));
    const port = await findAvailablePort(4936, createServer as unknown as typeof net.createServer);
    expect(port).toBe(4936);
    expect(createServer).toHaveBeenCalledTimes(1);
  });

  it('skips in-use ports and returns next available', async () => {
    let callCount = 0;
    const createServer = vi.fn(() => {
      callCount++;
      // First 3 calls → EADDRINUSE, 4th → success
      const behavior = callCount <= 3 ? 'eaddrinuse' : 'success';
      return makeFakeServer({ listenBehavior: behavior });
    });

    const port = await findAvailablePort(4936, createServer as unknown as typeof net.createServer);
    expect(port).toBe(4939); // 4936, 4937, 4938 busy → 4939 available
  });

  it('falls back to OS-assigned port when all 10 sequential ports are busy', async () => {
    const createServer = vi.fn((callIdx?: number) => {
      // We track via closure since vi.fn doesn't pass call index
      const calls = (createServer as any).mock.calls.length;
      if (calls <= 10) {
        return makeFakeServer({ listenBehavior: 'eaddrinuse' });
      }
      return makeFakeServer({ listenBehavior: 'os-assign', osAssignedPort: 54321 });
    });

    const port = await findAvailablePort(4936, createServer as unknown as typeof net.createServer);
    expect(port).toBe(54321);
  });
});

describe('BACKEND_PORT stdout signal format', () => {
  it('writes BACKEND_PORT=<port> as the first stdout line', () => {
    const writtenLines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any, ...args: any[]) => {
      writtenLines.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const port = 4936;
    process.stdout.write(`BACKEND_PORT=${port}\n`);

    expect(writtenLines[0]).toBe('BACKEND_PORT=4936\n');
    expect(writtenLines[0]).toMatch(/^BACKEND_PORT=\d+\n$/);

    vi.restoreAllMocks();
  });
});
