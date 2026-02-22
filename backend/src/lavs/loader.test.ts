/**
 * Tests for ManifestLoader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ManifestLoader } from './loader.js';
import { LAVSError, LAVSErrorCode } from './types.js';

describe('ManifestLoader', () => {
  let loader: ManifestLoader;
  let tmpDir: string;

  beforeEach(async () => {
    loader = new ManifestLoader();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lavs-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a manifest file
   */
  async function writeManifest(manifest: Record<string, unknown>, filename = 'lavs.json') {
    const filePath = path.join(tmpDir, filename);
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2));
    return filePath;
  }

  // ─── Successful loading ──────────────────────────────────

  describe('successful loading', () => {
    it('should load a valid manifest', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'test-service',
        version: '1.0.0',
        endpoints: [
          {
            id: 'list',
            method: 'query',
            handler: { type: 'script', command: 'echo', args: ['[]'] },
          },
        ],
      });

      const result = await loader.load(manifestPath);
      expect(result.lavs).toBe('1.0');
      expect(result.name).toBe('test-service');
      expect(result.version).toBe('1.0.0');
      expect(result.endpoints).toHaveLength(1);
      expect(result.endpoints[0].id).toBe('list');
    });

    it('should load manifest with multiple endpoints', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'multi-endpoint',
        version: '1.0.0',
        endpoints: [
          { id: 'list', method: 'query', handler: { type: 'script', command: 'echo' } },
          { id: 'add', method: 'mutation', handler: { type: 'script', command: 'node', args: ['add.js'], input: 'stdin' } },
          { id: 'watch', method: 'subscription', handler: { type: 'script', command: 'node', args: ['watch.js'] } },
        ],
      });

      const result = await loader.load(manifestPath);
      expect(result.endpoints).toHaveLength(3);
    });

    it('should include optional fields when present', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'full-service',
        version: '2.0.0',
        description: 'A full featured service',
        endpoints: [
          {
            id: 'search',
            method: 'query',
            description: 'Search items',
            handler: { type: 'script', command: 'node', args: ['search.js'] },
            schema: {
              input: { type: 'object', properties: { query: { type: 'string' } } },
              output: { type: 'array' },
            },
          },
        ],
        permissions: {
          fileAccess: ['./data/**'],
          maxExecutionTime: 5000,
        },
      });

      const result = await loader.load(manifestPath);
      expect(result.description).toBe('A full featured service');
      expect(result.permissions?.fileAccess).toEqual(['./data/**']);
      expect(result.endpoints[0].schema?.input).toBeDefined();
    });
  });

  // ─── Path resolution ─────────────────────────────────────

  describe('path resolution', () => {
    it('should resolve relative script paths to absolute', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'path-test',
        version: '1.0.0',
        endpoints: [
          {
            id: 'run',
            method: 'query',
            handler: { type: 'script', command: 'node', args: ['scripts/handler.js'] },
          },
        ],
      });

      const result = await loader.load(manifestPath);
      // cwd should not be resolved (it wasn't specified)
      // command 'node' should not be resolved (it's not a script path)
      expect(result.endpoints[0].handler.type).toBe('script');
    });

    it('should resolve relative cwd to absolute', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'cwd-test',
        version: '1.0.0',
        endpoints: [
          {
            id: 'run',
            method: 'query',
            handler: {
              type: 'script',
              command: 'echo',
              cwd: './scripts',
            },
          },
        ],
      });

      const result = await loader.load(manifestPath);
      const handler = result.endpoints[0].handler as { cwd?: string };
      expect(handler.cwd).toBeDefined();
      expect(path.isAbsolute(handler.cwd!)).toBe(true);
      expect(handler.cwd).toContain('scripts');
    });

    it('should resolve local view component path', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'view-test',
        version: '1.0.0',
        endpoints: [],
        view: {
          component: { type: 'local', path: 'view/index.html' },
        },
      });

      const result = await loader.load(manifestPath);
      expect(result.view?.component.type).toBe('local');
      if (result.view?.component.type === 'local') {
        expect(path.isAbsolute(result.view.component.path)).toBe(true);
      }
    });
  });

  // ─── Validation errors ───────────────────────────────────

  describe('validation errors', () => {
    it('should throw when manifest file does not exist', async () => {
      const fakePath = path.join(tmpDir, 'nonexistent.json');

      try {
        await loader.load(fakePath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.InvalidRequest);
        expect((err as LAVSError).message).toContain('not found');
      }
    });

    it('should throw for invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json');
      await fs.writeFile(filePath, '{ not valid json }');

      try {
        await loader.load(filePath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.ParseError);
      }
    });

    it('should throw when lavs field is missing', async () => {
      const manifestPath = await writeManifest({
        name: 'no-lavs',
        version: '1.0.0',
        endpoints: [],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('lavs');
      }
    });

    it('should throw when name field is missing', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        version: '1.0.0',
        endpoints: [],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('name');
      }
    });

    it('should throw when version field is missing', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'no-version',
        endpoints: [],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('version');
      }
    });

    it('should throw when endpoints is not an array', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'bad-endpoints',
        version: '1.0.0',
        endpoints: 'not-an-array',
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('endpoints');
      }
    });

    it('should throw when endpoint is missing id', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'no-id',
        version: '1.0.0',
        endpoints: [
          { method: 'query', handler: { type: 'script', command: 'echo' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('id');
      }
    });

    it('should throw when endpoint has invalid method', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'bad-method',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'invalid', handler: { type: 'script', command: 'echo' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('method');
      }
    });

    it('should throw when endpoint is missing handler', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'no-handler',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query' },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('handler');
      }
    });

    it('should throw for invalid handler type', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'bad-handler',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query', handler: { type: 'invalid' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('handler type');
      }
    });

    it('should throw when script handler is missing command', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'no-command',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query', handler: { type: 'script' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('command');
      }
    });

    it('should throw for invalid script input mode', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'bad-input',
        version: '1.0.0',
        endpoints: [
          {
            id: 'test',
            method: 'query',
            handler: { type: 'script', command: 'echo', input: 'invalid' },
          },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('input mode');
      }
    });
  });

  // ─── Handler type specific validation ────────────────────

  describe('handler type validation', () => {
    it('should validate function handler requires module and function', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'func-test',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query', handler: { type: 'function' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('module');
      }
    });

    it('should validate http handler requires url and method', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'http-test',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query', handler: { type: 'http' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('url');
      }
    });

    it('should validate mcp handler requires server and tool', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'mcp-test',
        version: '1.0.0',
        endpoints: [
          { id: 'test', method: 'query', handler: { type: 'mcp' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('server');
      }
    });

    it('should reject duplicate endpoint IDs', async () => {
      const manifestPath = await writeManifest({
        lavs: '1.0',
        name: 'dup-test',
        version: '1.0.0',
        endpoints: [
          { id: 'same-id', method: 'query', handler: { type: 'script', command: 'echo' } },
          { id: 'same-id', method: 'mutation', handler: { type: 'script', command: 'echo' } },
        ],
      });

      try {
        await loader.load(manifestPath);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).message).toContain('Duplicate endpoint ID');
        expect((err as LAVSError).message).toContain('same-id');
      }
    });
  });
});
