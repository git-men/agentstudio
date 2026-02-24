import { describe, it, expect } from 'vitest';
import { parseHookDecision } from '../decisionValidator.js';

describe('parseHookDecision', () => {
  it('should parse a valid "allow" decision', () => {
    const result = parseHookDecision({ decision: 'allow' });
    expect(result).toEqual({ decision: 'allow' });
  });

  it('should parse a valid "block" decision with reason', () => {
    const result = parseHookDecision({ decision: 'block', reason: 'Content policy violation' });
    expect(result).toEqual({ decision: 'block', reason: 'Content policy violation' });
  });

  it('should parse a valid "rewrite" decision with rewrittenMessage', () => {
    const result = parseHookDecision({
      decision: 'rewrite',
      rewrittenMessage: 'sanitized message',
      reason: 'PII removed',
    });
    expect(result).toEqual({
      decision: 'rewrite',
      rewrittenMessage: 'sanitized message',
      reason: 'PII removed',
    });
  });

  it('should downgrade "rewrite" to "allow" when rewrittenMessage is missing', () => {
    const result = parseHookDecision({ decision: 'rewrite' });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('allow');
    expect(result!.reason).toContain('Rewrite downgraded to allow');
  });

  it('should downgrade "rewrite" to "allow" when rewrittenMessage is empty string', () => {
    const result = parseHookDecision({ decision: 'rewrite', rewrittenMessage: '' });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('allow');
    expect(result!.reason).toContain('Rewrite downgraded to allow');
  });

  it('should preserve the original reason when downgrading rewrite', () => {
    const result = parseHookDecision({ decision: 'rewrite', reason: 'custom reason' });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('allow');
    expect(result!.reason).toBe('custom reason');
  });

  it('should return null for an invalid decision value', () => {
    expect(parseHookDecision({ decision: 'skip' })).toBeNull();
    expect(parseHookDecision({ decision: 'ALLOW' })).toBeNull();
    expect(parseHookDecision({ decision: '' })).toBeNull();
  });

  it('should return null for null input', () => {
    expect(parseHookDecision(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseHookDecision(undefined)).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(parseHookDecision('allow')).toBeNull();
    expect(parseHookDecision(42)).toBeNull();
    expect(parseHookDecision(true)).toBeNull();
  });

  it('should return null for an object without a decision field', () => {
    expect(parseHookDecision({})).toBeNull();
    expect(parseHookDecision({ reason: 'no decision field' })).toBeNull();
  });

  it('should preserve extra metadata', () => {
    const result = parseHookDecision({
      decision: 'allow',
      metadata: { hookVersion: '1.0', latency: 42 },
    });
    expect(result).not.toBeNull();
    expect(result!.metadata).toEqual({ hookVersion: '1.0', latency: 42 });
  });

  it('should strip unknown top-level fields (zod strict parsing)', () => {
    const result = parseHookDecision({
      decision: 'allow',
      unknownField: 'should be stripped',
    });
    expect(result).not.toBeNull();
    expect(result!.decision).toBe('allow');
    expect((result as any).unknownField).toBeUndefined();
  });
});
