#!/usr/bin/env node
/**
 * AgentStudio E2E Test Runner
 *
 * Usage:
 *   node tests/e2e/run.mjs [--spec <pattern>] [--port <n>] [--mock-port <n>]
 *
 * Options:
 *   --spec     Filter specs by name pattern (substring match)
 *   --port     Backend port (default: 4951)
 *   --mock-port  Mock safety server port (default: 9901)
 *   --no-build   Skip backend build step
 *
 * Examples:
 *   node tests/e2e/run.mjs
 *   node tests/e2e/run.mjs --spec safety-check
 *   node tests/e2e/run.mjs --port 4970 --mock-port 9970
 *
 * Exit code: 0 = all pass, 1 = failures or errors
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { BackendServer }          from './helpers/server.mjs';
import { MockSafetyServer }       from './helpers/mocks.mjs';
import { AssertionError }         from './helpers/assert.mjs';
import { FIXTURE_MARKETPLACE_PATH } from './helpers/marketplace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const BACKEND_PORT  = Number(args['port'])       || 4951;
const MOCK_PORT     = Number(args['mock-port'])  || 9901;
const SPEC_FILTER   = args['spec'] ?? null;

// ── Colour helpers ─────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};
const g  = s => `${C.green}${s}${C.reset}`;
const r  = s => `${C.red}${s}${C.reset}`;
const y  = s => `${C.yellow}${s}${C.reset}`;
const c  = s => `${C.cyan}${s}${C.reset}`;
const dim = s => `${C.dim}${s}${C.reset}`;
const bold = s => `${C.bold}${s}${C.reset}`;

// ── Suite runner ───────────────────────────────────────────────────────────

class SuiteRunner {
  constructor(name) {
    this.name = name;
    this.steps = [];
    this._pass = 0;
    this._fail = 0;
    this._skip = 0;
  }

  async step(label, fn) {
    const start = Date.now();
    try {
      await fn();
      const ms = Date.now() - start;
      console.log(`    ${g('✓')} ${label} ${dim(`(${ms}ms)`)}`);
      this._pass++;
    } catch (err) {
      const ms = Date.now() - start;
      console.log(`    ${r('✗')} ${label} ${dim(`(${ms}ms)`)}`);
      console.log(`      ${r(err.name)}: ${err.message}`);
      this._fail++;
      throw err; // propagate to stop the spec on first failure (fail-fast)
    }
  }

  get passed() { return this._pass; }
  get failed()  { return this._fail; }
}

// ── Spec discovery ─────────────────────────────────────────────────────────

function discoverSpecs(dir) {
  const specs = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      specs.push(...discoverSpecs(full));
    } else if (entry.name.endsWith('.spec.mjs')) {
      specs.push(full);
    }
  }
  return specs;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log(bold(`╔══════════════════════════════════════════════════════╗`));
  console.log(bold(`║       AgentStudio E2E Test Suite                     ║`));
  console.log(bold(`╚══════════════════════════════════════════════════════╝`));
  console.log('');
  console.log(`  Backend port : ${c(BACKEND_PORT)}`);
  console.log(`  Mock port    : ${c(MOCK_PORT)}`);
  console.log(`  Spec filter  : ${SPEC_FILTER ? c(SPEC_FILTER) : dim('(all)')}`);
  console.log('');

  // Use an isolated temp data directory so each E2E run starts with zero hooks/config
  const dataDir = mkdtempSync(resolve(tmpdir(), 'agentstudio-e2e-'));
  const mockApiUrl = `http://localhost:${MOCK_PORT}/api/safety-check`;
  const backend    = new BackendServer({
    port: BACKEND_PORT,
    dataDir,
    env: {
      // Tell the backend to auto-register + install all plugins from the fixture
      // marketplace on startup — mirrors the exact production flow used by as-mate.
      BUILTIN_MARKETPLACES: FIXTURE_MARKETPLACE_PATH,
      // Used by the marketplace content-safety-check.js plugin
      CONTENT_SAFETY_API_URL: mockApiUrl,
      // Kept for backwards-compat with any legacy hook scripts
      SAFETY_CHECK_URL: mockApiUrl,
    },
  });
  const mockSafety = new MockSafetyServer({ port: MOCK_PORT });

  // Ensure cleanup on exit
  const cleanup = async (code = 0) => {
    console.log('\n' + dim('  Stopping services…'));
    await Promise.allSettled([backend.stop(), mockSafety.stop()]);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
    process.exit(code);
  };
  process.on('SIGINT',  () => cleanup(130));
  process.on('SIGTERM', () => cleanup(1));

  // ── Start services ─────────────────────────────────────────────────────
  console.log('  Starting services…');
  try {
    console.log(`  ${dim('→')} Mock Safety Server on :${MOCK_PORT}…`);
    await mockSafety.start();
    console.log(`  ${g('✓')} Mock Safety Server ready`);
  } catch (err) {
    console.error(r(`  ✗ Mock Safety Server failed: ${err.message}`));
    process.exit(1);
  }

  try {
    console.log(`  ${dim('→')} AgentStudio Backend on :${BACKEND_PORT}…`);
    await backend.start();
    console.log(`  ${g('✓')} Backend ready`);
  } catch (err) {
    console.error(r(`  ✗ Backend failed to start: ${err.message}`));
    await mockSafety.stop();
    process.exit(1);
  }

  console.log('');

  // ── Discover & run specs ────────────────────────────────────────────────
  const specsDir = resolve(__dirname, 'specs');
  const allSpecPaths = discoverSpecs(specsDir);
  const specPaths = SPEC_FILTER
    ? allSpecPaths.filter(p => p.includes(SPEC_FILTER))
    : allSpecPaths;

  if (specPaths.length === 0) {
    console.warn(y(`  No specs found${SPEC_FILTER ? ` matching "${SPEC_FILTER}"` : ''}`));
    await cleanup(0);
    return;
  }

  let totalPass = 0, totalFail = 0, totalSpecs = 0;

  for (const specPath of specPaths) {
    const relPath = specPath.replace(specsDir + '/', '');
    const spec = await import(specPath);
    const specName = spec.name ?? relPath;

    console.log(`  ${bold(c(specName))}`);
    console.log(`  ${dim(relPath)}`);

    const suite = new SuiteRunner(specName);
    const ctx = { backend, mockSafety, suite };
    mockSafety.clearRequests();

    try {
      await spec.run(ctx);
      console.log(`  ${g('PASS')} ${bold(specName)} — ${suite.passed} steps passed\n`);
    } catch (err) {
      console.log(`  ${r('FAIL')} ${bold(specName)} — ${suite.passed} passed, ${suite.failed} failed\n`);
      if (!(err instanceof AssertionError)) {
        console.log(`  ${r('Unexpected error:')} ${err.message}`);
        console.log(dim(err.stack));
      }
    }

    totalPass += suite.passed;
    totalFail += suite.failed;
    totalSpecs++;
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(bold('══════════════════════════════════════════════════════'));
  console.log(bold(`  Results: ${totalSpecs} spec(s)`));
  console.log(`  ${g('✓ Passed')}: ${totalPass}`);
  if (totalFail > 0) {
    console.log(`  ${r('✗ Failed')}: ${totalFail}`);
  }
  console.log(bold('══════════════════════════════════════════════════════'));
  console.log('');

  await cleanup(totalFail > 0 ? 1 : 0);
}

// ── arg parser ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      result[key] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true);
    }
  }
  return result;
}

main().catch(err => {
  console.error(r('\nUnhandled error:'), err);
  process.exit(1);
});
