/**
 * Tests for LAVSValidator
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LAVSValidator } from './validator.js';
import { Endpoint, LAVSError, LAVSErrorCode } from './types.js';

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'test-endpoint',
    method: 'mutation',
    handler: { type: 'script', command: 'echo' },
    ...overrides,
  };
}

describe('LAVSValidator', () => {
  let validator: LAVSValidator;

  beforeEach(() => {
    validator = new LAVSValidator();
  });

  // ─── validateInput ───────────────────────────────────────

  describe('validateInput', () => {
    it('should pass when no schema.input is defined', () => {
      const endpoint = makeEndpoint({ schema: undefined });
      const result = validator.validateInput(endpoint, { anything: true });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should pass when schema is defined but input is omitted and no required fields', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
        },
      });
      const result = validator.validateInput(endpoint, {});
      expect(result.valid).toBe(true);
    });

    it('should pass for valid input matching schema', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              priority: { type: 'number' },
            },
            required: ['text'],
          },
        },
      });
      const result = validator.validateInput(endpoint, {
        text: 'hello',
        priority: 1,
      });
      expect(result.valid).toBe(true);
    });

    it('should fail when required field is missing', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
      });
      const result = validator.validateInput(endpoint, {});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].keyword).toBe('required');
    });

    it('should fail when field type is wrong', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
      });
      const result = validator.validateInput(endpoint, { text: 123 });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].keyword).toBe('type');
    });

    it('should report all errors (allErrors mode)', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' },
            },
            required: ['name', 'age'],
          },
        },
      });
      const result = validator.validateInput(endpoint, {});
      expect(result.valid).toBe(false);
      // Should report both missing fields
      expect(result.errors!.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate nested object schemas', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              user: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
                required: ['name'],
              },
            },
            required: ['user'],
          },
        },
      });

      // Valid
      const validResult = validator.validateInput(endpoint, {
        user: { name: 'Alice', email: 'alice@example.com' },
      });
      expect(validResult.valid).toBe(true);

      // Invalid - wrong email format
      const invalidResult = validator.validateInput(endpoint, {
        user: { name: 'Alice', email: 'not-an-email' },
      });
      expect(invalidResult.valid).toBe(false);
    });

    it('should validate array schemas', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      });

      // Valid
      expect(
        validator.validateInput(endpoint, { tags: ['a', 'b'] }).valid
      ).toBe(true);

      // Invalid - number in string array
      expect(
        validator.validateInput(endpoint, { tags: ['a', 123] }).valid
      ).toBe(false);
    });

    it('should apply default values from schema', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              priority: { type: 'number', default: 0 },
            },
            required: ['text'],
          },
        },
      });
      const input = { text: 'hello' };
      const result = validator.validateInput(endpoint, input);
      expect(result.valid).toBe(true);
      // ajv with useDefaults should fill in default
      expect((input as any).priority).toBe(0);
    });

    it('should cache compiled validators', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
        },
      });

      // Call twice - should use cache on second call
      validator.validateInput(endpoint, { text: 'a' });
      const result = validator.validateInput(endpoint, { text: 'b' });
      expect(result.valid).toBe(true);
    });
  });

  // ─── assertValidInput ────────────────────────────────────

  describe('assertValidInput', () => {
    it('should not throw for valid input', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      });
      expect(() => validator.assertValidInput(endpoint, { text: 'hello' })).not.toThrow();
    });

    it('should throw LAVSError with InvalidParams code for invalid input', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      });

      try {
        validator.assertValidInput(endpoint, {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.InvalidParams);
        expect((err as LAVSError).data).toHaveProperty('validationErrors');
      }
    });

    it('should include endpoint id in error message', () => {
      const endpoint = makeEndpoint({
        id: 'my-endpoint',
        schema: {
          input: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      });

      try {
        validator.assertValidInput(endpoint, {});
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as LAVSError).message).toContain('my-endpoint');
      }
    });
  });

  // ─── validateOutput ──────────────────────────────────────

  describe('validateOutput', () => {
    it('should pass when no schema.output is defined', () => {
      const endpoint = makeEndpoint({ schema: undefined });
      const result = validator.validateOutput(endpoint, 'anything');
      expect(result.valid).toBe(true);
    });

    it('should pass for valid output matching schema', () => {
      const endpoint = makeEndpoint({
        schema: {
          output: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                text: { type: 'string' },
              },
            },
          },
        },
      });
      const result = validator.validateOutput(endpoint, [
        { id: 1, text: 'hello' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('should fail when output does not match schema', () => {
      const endpoint = makeEndpoint({
        schema: {
          output: { type: 'array' },
        },
      });
      const result = validator.validateOutput(endpoint, 'not-an-array');
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  // ─── assertValidOutput ───────────────────────────────────

  describe('assertValidOutput', () => {
    it('should not throw for valid output', () => {
      const endpoint = makeEndpoint({
        schema: { output: { type: 'array' } },
      });
      expect(() => validator.assertValidOutput(endpoint, [])).not.toThrow();
    });

    it('should throw LAVSError with InternalError code for invalid output', () => {
      const endpoint = makeEndpoint({
        schema: { output: { type: 'array' } },
      });

      try {
        validator.assertValidOutput(endpoint, 'not-array');
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.InternalError);
      }
    });
  });

  // ─── clearCache ──────────────────────────────────────────

  describe('clearCache', () => {
    it('should clear cached validators', () => {
      const endpoint = makeEndpoint({
        schema: {
          input: { type: 'object', properties: { x: { type: 'number' } } },
        },
      });

      // Populate cache
      validator.validateInput(endpoint, { x: 1 });

      // Clear and re-validate (should still work)
      validator.clearCache();
      const result = validator.validateInput(endpoint, { x: 2 });
      expect(result.valid).toBe(true);
    });
  });
});
