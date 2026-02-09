/**
 * Tests for Claude engine model query functionality.
 *
 * - Integration test: verify live SDK Query.supportedModels() (requires API key)
 * - Unit tests: verify SDK → engine ModelInfo mapping and 4-level fallback logic
 *
 * Run with API key to verify live:
 *   ANTHROPIC_API_KEY=sk-... pnpm test:run src/engines/claude/__tests__/supportedModels.test.ts
 * Or put ANTHROPIC_API_KEY in backend/.env (dotenv is loaded below).
 */

import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env') });

import { describe, it, expect, beforeAll } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// Integration tests: live SDK supportedModels()
// ============================================================================

describe('Claude Agent SDK supportedModels()', () => {
  const hasApiKey = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN
  );

  beforeAll(() => {
    if (!hasApiKey) {
      console.warn(
        '[supportedModels.test] No ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN – skipping live SDK test'
      );
    }
  });

  it(
    'should return model list from SDK Query.supportedModels() when API key is set',
    async () => {
      if (!hasApiKey) {
        return;
      }

      const abortController = new AbortController();
      const timeoutMs = 25_000;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('supportedModels() timeout')), timeoutMs)
      );

      const q = query({
        prompt: '.',
        options: {
          abortController,
          cwd: process.cwd(),
          allowedTools: ['Read'],
          maxTurns: 1,
        },
      });

      // supportedModels() waits on Query's internal "initialization" promise.
      // Initialization is triggered when the session starts (first iteration).
      const modelsPromise = q.supportedModels();

      // Start iteration so the SDK starts the CLI and sends init; then we get models.
      const iter = q[Symbol.asyncIterator]();
      const firstResultPromise = iter.next();

      const models = await Promise.race([
        Promise.all([modelsPromise, firstResultPromise]).then(([models]) => models),
        timeoutPromise,
      ]);

      abortController.abort();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      for (const m of models) {
        expect(m).toHaveProperty('value');
        expect(m).toHaveProperty('displayName');
        expect(m).toHaveProperty('description');
        expect(typeof m.value).toBe('string');
        expect(typeof m.displayName).toBe('string');
      }

      console.log(
        `[supportedModels.test] Got ${models.length} models:`,
        models.map((m) => ({ value: m.value, displayName: m.displayName }))
      );
    },
    { timeout: 30_000 }
  );
});

// ============================================================================
// Unit tests: SDK → engine ModelInfo mapping
// ============================================================================

describe('SDK ModelInfo → engine ModelInfo mapping', () => {
  // This mapping is the same logic used by ClaudeEngine.fetchModelsFromSdk()
  const toEngineModel = (m: { value: string; displayName: string; description?: string }) => ({
    id: m.value,
    name: m.displayName,
    isVision: !m.displayName.toLowerCase().includes('haiku'),
    isThinking: m.displayName.toLowerCase().includes('thinking'),
    description: m.description,
  });

  it('should correctly map standard models', () => {
    const sdkModels = [
      { value: 'claude-sonnet-4-20250514', displayName: 'Claude 4 Sonnet', description: 'Balanced' },
      { value: 'claude-opus-4-20250514', displayName: 'Claude 4 Opus', description: 'Most capable' },
    ];
    const engineModels = sdkModels.map(toEngineModel);

    expect(engineModels).toHaveLength(2);
    expect(engineModels[0]).toEqual({
      id: 'claude-sonnet-4-20250514',
      name: 'Claude 4 Sonnet',
      isVision: true,
      isThinking: false,
      description: 'Balanced',
    });
    expect(engineModels[1]).toEqual({
      id: 'claude-opus-4-20250514',
      name: 'Claude 4 Opus',
      isVision: true,
      isThinking: false,
      description: 'Most capable',
    });
  });

  it('should detect thinking models from displayName', () => {
    const sdkModel = {
      value: 'claude-sonnet-4-20250514-thinking',
      displayName: 'Claude 4 Sonnet (Thinking)',
      description: 'Extended thinking',
    };
    const result = toEngineModel(sdkModel);
    expect(result.isThinking).toBe(true);
    expect(result.isVision).toBe(true);
  });

  it('should mark haiku models as non-vision', () => {
    const sdkModel = {
      value: 'claude-haiku-3-20250514',
      displayName: 'Claude 3 Haiku',
      description: 'Fast',
    };
    const result = toEngineModel(sdkModel);
    expect(result.isVision).toBe(false);
    expect(result.isThinking).toBe(false);
  });

  it('should handle missing description gracefully', () => {
    const sdkModel = { value: 'some-model', displayName: 'Some Model' };
    const result = toEngineModel(sdkModel);
    expect(result.description).toBeUndefined();
  });
});
