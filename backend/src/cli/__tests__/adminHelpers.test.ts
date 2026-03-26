/**
 * Unit tests for admin CLI helper functions
 *
 * Tests the argument parsing and name conversion utilities
 * that are critical for correct CLI-to-MCP-API translation.
 */

import { describe, it, expect } from 'vitest';

// Re-implement the helpers here for isolated testing.
// These mirror the private functions in admin.ts.

function toDashCase(s: string): string {
  return s.replace(/_/g, '-');
}

function toSnakeCase(s: string): string {
  return s.replace(/-/g, '_');
}

function camelToKebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function coerceValue(val: string): unknown {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
    try { return JSON.parse(val); } catch { /* fall through */ }
  }
  return val;
}

function parseToolArgs(args: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--no-')) {
      const key = kebabToCamel(arg.slice(5));
      result[key] = false;
      i++;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const key = kebabToCamel(rawKey);

      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        const val = args[i + 1];
        if (key in result) {
          const existing = result[key];
          result[key] = Array.isArray(existing) ? [...existing, coerceValue(val)] : [existing, coerceValue(val)];
        } else {
          result[key] = coerceValue(val);
        }
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else {
      try {
        const parsed = JSON.parse(arg);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          Object.assign(result, parsed);
        }
      } catch {
        // skip
      }
      i++;
    }
  }

  return result;
}

describe('Name conversion utilities', () => {
  describe('toDashCase (snake_case → kebab-case)', () => {
    it('converts underscores to dashes', () => {
      expect(toDashCase('list_projects')).toBe('list-projects');
      expect(toDashCase('get_system_status')).toBe('get-system-status');
      expect(toDashCase('health_check')).toBe('health-check');
    });

    it('handles strings without underscores', () => {
      expect(toDashCase('ping')).toBe('ping');
    });
  });

  describe('toSnakeCase (kebab-case → snake_case)', () => {
    it('converts dashes to underscores', () => {
      expect(toSnakeCase('list-projects')).toBe('list_projects');
      expect(toSnakeCase('get-system-status')).toBe('get_system_status');
    });

    it('handles strings without dashes', () => {
      expect(toSnakeCase('ping')).toBe('ping');
    });
  });

  describe('camelToKebab', () => {
    it('converts camelCase to kebab-case', () => {
      expect(camelToKebab('agentId')).toBe('agent-id');
      expect(camelToKebab('systemPrompt')).toBe('system-prompt');
      expect(camelToKebab('maxTurns')).toBe('max-turns');
      expect(camelToKebab('includeDisabled')).toBe('include-disabled');
    });

    it('handles already lowercase', () => {
      expect(camelToKebab('name')).toBe('name');
      expect(camelToKebab('path')).toBe('path');
    });
  });

  describe('kebabToCamel', () => {
    it('converts kebab-case to camelCase', () => {
      expect(kebabToCamel('agent-id')).toBe('agentId');
      expect(kebabToCamel('system-prompt')).toBe('systemPrompt');
      expect(kebabToCamel('max-turns')).toBe('maxTurns');
    });

    it('handles single words', () => {
      expect(kebabToCamel('name')).toBe('name');
    });

    it('round-trips with camelToKebab', () => {
      const cases = ['agentId', 'systemPrompt', 'maxTurns', 'includeDisabled', 'projectPath'];
      for (const c of cases) {
        expect(kebabToCamel(camelToKebab(c))).toBe(c);
      }
    });
  });
});

describe('coerceValue', () => {
  it('converts "true" to boolean true', () => {
    expect(coerceValue('true')).toBe(true);
  });

  it('converts "false" to boolean false', () => {
    expect(coerceValue('false')).toBe(false);
  });

  it('converts integer strings to numbers', () => {
    expect(coerceValue('10')).toBe(10);
    expect(coerceValue('0')).toBe(0);
    expect(coerceValue('-5')).toBe(-5);
  });

  it('converts float strings to numbers', () => {
    expect(coerceValue('3.14')).toBe(3.14);
    expect(coerceValue('-0.5')).toBe(-0.5);
  });

  it('parses JSON arrays', () => {
    expect(coerceValue('["a","b"]')).toEqual(['a', 'b']);
  });

  it('parses JSON objects', () => {
    expect(coerceValue('{"key":"val"}')).toEqual({ key: 'val' });
  });

  it('keeps regular strings as-is', () => {
    expect(coerceValue('hello')).toBe('hello');
    expect(coerceValue('/path/to/dir')).toBe('/path/to/dir');
    expect(coerceValue('My Agent')).toBe('My Agent');
  });

  it('keeps malformed JSON as string', () => {
    expect(coerceValue('[broken')).toBe('[broken');
    expect(coerceValue('{bad}')).toBe('{bad}');
  });
});

describe('parseToolArgs', () => {
  it('parses --key value pairs', () => {
    const result = parseToolArgs(['--name', 'Test Agent', '--limit', '10']);
    expect(result).toEqual({ name: 'Test Agent', limit: 10 });
  });

  it('converts kebab-case keys to camelCase', () => {
    const result = parseToolArgs(['--agent-id', 'my-agent', '--system-prompt', 'You are helpful']);
    expect(result).toEqual({ agentId: 'my-agent', systemPrompt: 'You are helpful' });
  });

  it('handles boolean flags', () => {
    const result = parseToolArgs(['--enabled', '--include-disabled']);
    expect(result).toEqual({ enabled: true, includeDisabled: true });
  });

  it('handles --no- prefix for false', () => {
    const result = parseToolArgs(['--no-enabled', '--no-auto-connect']);
    expect(result).toEqual({ enabled: false, autoConnect: false });
  });

  it('handles type coercion for values', () => {
    const result = parseToolArgs(['--limit', '10', '--enabled', 'true', '--name', 'Test']);
    expect(result).toEqual({ limit: 10, enabled: true, name: 'Test' });
  });

  it('handles repeated keys as arrays', () => {
    const result = parseToolArgs(['--tags', 'dev', '--tags', 'test', '--tags', 'prod']);
    expect(result).toEqual({ tags: ['dev', 'test', 'prod'] });
  });

  it('parses inline JSON argument', () => {
    const result = parseToolArgs(['{"agentId":"jarvis","limit":5}']);
    expect(result).toEqual({ agentId: 'jarvis', limit: 5 });
  });

  it('merges JSON with flag args', () => {
    const result = parseToolArgs(['--limit', '10', '{"offset":5}']);
    expect(result).toEqual({ limit: 10, offset: 5 });
  });

  it('handles empty args', () => {
    expect(parseToolArgs([])).toEqual({});
  });

  it('handles mixed boolean flag and value flag', () => {
    const result = parseToolArgs(['--enabled', '--name', 'Test']);
    expect(result).toEqual({ enabled: true, name: 'Test' });
  });

  it('handles flag at end without value', () => {
    const result = parseToolArgs(['--name', 'Test', '--verbose']);
    expect(result).toEqual({ name: 'Test', verbose: true });
  });

  it('ignores non-JSON positional arguments', () => {
    const result = parseToolArgs(['not-json', '--key', 'val']);
    expect(result).toEqual({ key: 'val' });
  });

  it('handles complex real-world create-agent call', () => {
    const result = parseToolArgs([
      '--id', 'test-agent',
      '--name', 'Test Agent',
      '--description', 'A test agent',
      '--system-prompt', 'You are a helpful assistant',
      '--max-turns', '50',
      '--permission-mode', 'acceptEdits',
      '--tags', 'test',
      '--tags', 'dev',
      '--icon', '🤖',
    ]);

    expect(result).toEqual({
      id: 'test-agent',
      name: 'Test Agent',
      description: 'A test agent',
      systemPrompt: 'You are a helpful assistant',
      maxTurns: 50,
      permissionMode: 'acceptEdits',
      tags: ['test', 'dev'],
      icon: '🤖',
    });
  });
});
