/**
 * LAVS Validator
 *
 * Validates endpoint inputs and outputs against JSON Schema definitions.
 * Uses ajv for fast JSON Schema compilation and validation.
 */

import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import {
  Endpoint,
  LAVSError,
  LAVSErrorCode,
  JSONSchema,
} from './types.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

/**
 * Individual validation error detail
 */
export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params?: Record<string, unknown>;
}

/**
 * LAVS Validator - validates endpoint inputs and outputs against JSON Schema
 */
export class LAVSValidator {
  private ajv: Ajv;
  private inputValidators: Map<string, ValidateFunction> = new Map();
  private outputValidators: Map<string, ValidateFunction> = new Map();

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,       // Report all errors, not just first
      strict: false,         // Allow extra keywords in schema
      coerceTypes: false,    // Don't coerce types
      useDefaults: true,     // Apply default values from schema
    });
    addFormats(this.ajv);
  }

  /**
   * Validate endpoint input against schema.input
   * If no schema.input is defined, validation passes (returns valid).
   *
   * @param endpoint - Endpoint definition containing schema
   * @param input - Input data to validate
   * @returns Validation result
   */
  validateInput(endpoint: Endpoint, input: unknown): ValidationResult {
    // No schema defined - skip validation
    if (!endpoint.schema?.input) {
      return { valid: true };
    }

    const cacheKey = `input:${endpoint.id}`;
    const validate = this.getOrCompileValidator(cacheKey, endpoint.schema.input);

    const valid = validate(input);
    if (valid) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: this.formatErrors(validate.errors || []),
    };
  }

  /**
   * Validate endpoint output against schema.output
   * If no schema.output is defined, validation passes (returns valid).
   *
   * @param endpoint - Endpoint definition containing schema
   * @param output - Output data to validate
   * @returns Validation result
   */
  validateOutput(endpoint: Endpoint, output: unknown): ValidationResult {
    // No schema defined - skip validation
    if (!endpoint.schema?.output) {
      return { valid: true };
    }

    const cacheKey = `output:${endpoint.id}`;
    const validate = this.getOrCompileValidator(cacheKey, endpoint.schema.output);

    const valid = validate(output);
    if (valid) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: this.formatErrors(validate.errors || []),
    };
  }

  /**
   * Validate input and throw LAVSError if invalid
   *
   * @param endpoint - Endpoint definition
   * @param input - Input data to validate
   * @throws LAVSError with code InvalidParams if validation fails
   */
  assertValidInput(endpoint: Endpoint, input: unknown): void {
    const result = this.validateInput(endpoint, input);
    if (!result.valid) {
      throw new LAVSError(
        LAVSErrorCode.InvalidParams,
        `Invalid input for endpoint '${endpoint.id}': ${this.summarizeErrors(result.errors!)}`,
        { validationErrors: result.errors }
      );
    }
  }

  /**
   * Validate output and throw LAVSError if invalid
   *
   * @param endpoint - Endpoint definition
   * @param output - Output data to validate
   * @throws LAVSError with code InternalError if validation fails
   */
  assertValidOutput(endpoint: Endpoint, output: unknown): void {
    const result = this.validateOutput(endpoint, output);
    if (!result.valid) {
      throw new LAVSError(
        LAVSErrorCode.InternalError,
        `Invalid output from endpoint '${endpoint.id}': handler returned data that does not match schema`,
        { validationErrors: result.errors }
      );
    }
  }

  /**
   * Get or compile a JSON Schema validator, using cache
   */
  private getOrCompileValidator(cacheKey: string, schema: JSONSchema): ValidateFunction {
    const isInput = cacheKey.startsWith('input:');
    const cache = isInput ? this.inputValidators : this.outputValidators;

    let validate = cache.get(cacheKey);
    if (!validate) {
      try {
        validate = this.ajv.compile(schema);
        cache.set(cacheKey, validate);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LAVSError(
          LAVSErrorCode.InternalError,
          `Failed to compile JSON Schema for ${cacheKey}: ${message}`
        );
      }
    }

    return validate;
  }

  /**
   * Format ajv errors into our ValidationError format
   */
  private formatErrors(errors: ErrorObject[]): ValidationError[] {
    return errors.map((err) => ({
      path: err.instancePath || '/',
      message: err.message || 'Validation failed',
      keyword: err.keyword,
      params: err.params as Record<string, unknown>,
    }));
  }

  /**
   * Create a human-readable summary from validation errors
   */
  private summarizeErrors(errors: ValidationError[]): string {
    if (errors.length === 0) return 'Unknown validation error';
    if (errors.length === 1) {
      const err = errors[0];
      return `${err.path || '/'} ${err.message}`;
    }
    return errors
      .map((err) => `${err.path || '/'} ${err.message}`)
      .join('; ');
  }

  /**
   * Clear all cached validators
   * Useful when schemas change (e.g., manifest reload)
   */
  clearCache(): void {
    this.inputValidators.clear();
    this.outputValidators.clear();
  }
}
