/**
 * E2E Helper: Assertion utilities
 *
 * Lightweight assertion library for E2E tests.
 * Throws AssertionError with descriptive messages on failure.
 */

export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition, message) {
  if (!condition) throw new AssertionError(message ?? 'Assertion failed');
}

export function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    throw new AssertionError(
      `${label ? label + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

export function assertIncludes(str, substring, label = '') {
  if (typeof str !== 'string' || !str.includes(substring)) {
    throw new AssertionError(
      `${label ? label + ': ' : ''}"${str}" does not include "${substring}"`
    );
  }
}

export function assertStatus(actual, expected) {
  if (actual !== expected) {
    throw new AssertionError(`HTTP status: expected ${expected}, got ${actual}`);
  }
}

/** Wait until fn() returns truthy, polling every interval ms */
export async function waitFor(fn, { timeout = 5000, interval = 100, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new AssertionError(`Timeout waiting for: ${label}`);
}
