/**
 * Tests for PermissionChecker
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { PermissionChecker } from './permission-checker.js';
import { Permissions, ScriptHandler, LAVSError, LAVSErrorCode } from './types.js';

describe('PermissionChecker', () => {
  const checker = new PermissionChecker();

  // ─── mergePermissions ────────────────────────────────────

  describe('mergePermissions', () => {
    it('should return empty object when both are undefined', () => {
      expect(checker.mergePermissions(undefined, undefined)).toEqual({});
    });

    it('should return manifest permissions when endpoint is undefined', () => {
      const manifest: Permissions = {
        fileAccess: ['./data/**'],
        maxExecutionTime: 5000,
      };
      expect(checker.mergePermissions(manifest, undefined)).toEqual(manifest);
    });

    it('should return endpoint permissions when manifest is undefined', () => {
      const endpoint: Permissions = {
        fileAccess: ['./logs/**'],
        maxExecutionTime: 10000,
      };
      expect(checker.mergePermissions(undefined, endpoint)).toEqual(endpoint);
    });

    it('should prefer endpoint-level permissions over manifest-level', () => {
      const manifest: Permissions = {
        fileAccess: ['./data/**'],
        maxExecutionTime: 5000,
        networkAccess: false,
      };
      const endpoint: Permissions = {
        fileAccess: ['./logs/**'],
        maxExecutionTime: 10000,
      };
      const merged = checker.mergePermissions(manifest, endpoint);
      expect(merged.fileAccess).toEqual(['./logs/**']);
      expect(merged.maxExecutionTime).toBe(10000);
      // networkAccess falls through from manifest since endpoint didn't specify
      expect(merged.networkAccess).toBe(false);
    });

    it('should use manifest value when endpoint value is undefined', () => {
      const manifest: Permissions = {
        fileAccess: ['./data/**'],
        maxExecutionTime: 5000,
      };
      const endpoint: Permissions = {};
      const merged = checker.mergePermissions(manifest, endpoint);
      expect(merged.fileAccess).toEqual(['./data/**']);
      expect(merged.maxExecutionTime).toBe(5000);
    });
  });

  // ─── checkPathTraversal ──────────────────────────────────

  describe('checkPathTraversal', () => {
    const baseDir = '/home/agents/todo-manager';

    it('should allow paths within base directory', () => {
      expect(() => checker.checkPathTraversal('./data', baseDir)).not.toThrow();
      expect(() => checker.checkPathTraversal('scripts/handler.js', baseDir)).not.toThrow();
      expect(() => checker.checkPathTraversal('.', baseDir)).not.toThrow();
    });

    it('should reject path traversal with ../', () => {
      expect(() => checker.checkPathTraversal('../../etc/passwd', baseDir)).toThrow(LAVSError);
      expect(() => checker.checkPathTraversal('../other-agent/data', baseDir)).toThrow(LAVSError);
    });

    it('should throw LAVSError with PermissionDenied code', () => {
      try {
        checker.checkPathTraversal('../../etc', baseDir);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(LAVSError);
        expect((err as LAVSError).code).toBe(LAVSErrorCode.PermissionDenied);
        expect((err as LAVSError).message).toContain('Path traversal');
      }
    });

    it('should allow the base directory itself', () => {
      expect(() => checker.checkPathTraversal('.', baseDir)).not.toThrow();
    });

    it('should handle absolute paths within base', () => {
      const absPath = path.join(baseDir, 'data', 'todos.json');
      // When providing an absolute path, path.resolve(base, absPath) = absPath
      expect(() => checker.checkPathTraversal(absPath, baseDir)).not.toThrow();
    });

    it('should reject absolute paths outside base', () => {
      expect(() => checker.checkPathTraversal('/etc/passwd', baseDir)).toThrow(LAVSError);
    });
  });

  // ─── checkHandlerCwd ────────────────────────────────────

  describe('checkHandlerCwd', () => {
    const agentDir = '/home/agents/todo-manager';

    it('should pass when handler has no cwd', () => {
      const handler: ScriptHandler = { type: 'script', command: 'node' };
      expect(() => checker.checkHandlerCwd(handler, agentDir)).not.toThrow();
    });

    it('should pass when cwd is within agent dir', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        cwd: path.join(agentDir, 'scripts'),
      };
      expect(() => checker.checkHandlerCwd(handler, agentDir)).not.toThrow();
    });

    it('should reject cwd outside agent dir', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        cwd: '../../etc',
      };
      expect(() => checker.checkHandlerCwd(handler, agentDir)).toThrow(LAVSError);
    });
  });

  // ─── checkFileAccess ─────────────────────────────────────

  describe('checkFileAccess', () => {
    it('should allow all when no fileAccess patterns defined', () => {
      expect(checker.checkFileAccess('anything.txt', {})).toBe(true);
      expect(checker.checkFileAccess('anything.txt', { fileAccess: [] })).toBe(true);
    });

    it('should match simple glob patterns', () => {
      const perms: Permissions = {
        fileAccess: ['./data/**/*.json'],
      };
      expect(checker.checkFileAccess('./data/todos.json', perms)).toBe(true);
      expect(checker.checkFileAccess('./data/nested/deep.json', perms)).toBe(true);
      expect(checker.checkFileAccess('./data/file.txt', perms)).toBe(false);
    });

    it('should deny paths not matching any pattern', () => {
      const perms: Permissions = {
        fileAccess: ['./data/**/*.json'],
      };
      expect(checker.checkFileAccess('./scripts/handler.js', perms)).toBe(false);
      expect(checker.checkFileAccess('./config.yaml', perms)).toBe(false);
    });

    it('should handle negative (deny) patterns', () => {
      const perms: Permissions = {
        fileAccess: ['./data/**/*.json', '!./data/secrets.json'],
      };
      expect(checker.checkFileAccess('./data/todos.json', perms)).toBe(true);
      expect(checker.checkFileAccess('./data/secrets.json', perms)).toBe(false);
    });

    it('should normalize paths without ./ prefix', () => {
      const perms: Permissions = {
        fileAccess: ['./data/**/*.json'],
      };
      expect(checker.checkFileAccess('data/todos.json', perms)).toBe(true);
    });

    it('should support multiple positive patterns', () => {
      const perms: Permissions = {
        fileAccess: ['./data/**/*.json', './logs/**/*.log'],
      };
      expect(checker.checkFileAccess('./data/todos.json', perms)).toBe(true);
      expect(checker.checkFileAccess('./logs/app.log', perms)).toBe(true);
      expect(checker.checkFileAccess('./config.yaml', perms)).toBe(false);
    });
  });

  // ─── getEffectiveTimeout ─────────────────────────────────

  describe('getEffectiveTimeout', () => {
    it('should return default timeout when nothing is configured', () => {
      const handler: ScriptHandler = { type: 'script', command: 'echo' };
      expect(checker.getEffectiveTimeout(handler, {})).toBe(30000);
    });

    it('should use custom default timeout', () => {
      const handler: ScriptHandler = { type: 'script', command: 'echo' };
      expect(checker.getEffectiveTimeout(handler, {}, 60000)).toBe(60000);
    });

    it('should prefer handler timeout over permission timeout', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        timeout: 5000,
      };
      const perms: Permissions = { maxExecutionTime: 10000 };
      expect(checker.getEffectiveTimeout(handler, perms)).toBe(5000);
    });

    it('should use permission timeout when handler has none', () => {
      const handler: ScriptHandler = { type: 'script', command: 'echo' };
      const perms: Permissions = { maxExecutionTime: 10000 };
      expect(checker.getEffectiveTimeout(handler, perms)).toBe(10000);
    });

    it('should cap handler timeout to permission max', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'echo',
        timeout: 60000,
      };
      const perms: Permissions = { maxExecutionTime: 10000 };
      // Handler wants 60s but permission allows max 10s
      expect(checker.getEffectiveTimeout(handler, perms)).toBe(10000);
    });
  });

  // ─── assertAllowed ───────────────────────────────────────

  describe('assertAllowed', () => {
    const agentDir = '/home/agents/todo-manager';

    it('should pass for handler with no custom cwd', () => {
      const handler: ScriptHandler = { type: 'script', command: 'node', args: ['handler.js'] };
      expect(() => checker.assertAllowed(handler, {}, agentDir)).not.toThrow();
    });

    it('should reject handler with path-traversal cwd', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        cwd: '../../etc',
      };
      expect(() => checker.assertAllowed(handler, {}, agentDir)).toThrow(LAVSError);
    });

    it('should check relative script command paths', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: '../../malicious/script.sh',
      };
      expect(() => checker.assertAllowed(handler, {}, agentDir)).toThrow(LAVSError);
    });

    it('should allow commands without path separators', () => {
      const handler: ScriptHandler = {
        type: 'script',
        command: 'node',
        args: ['scripts/handler.js'],
      };
      expect(() => checker.assertAllowed(handler, {}, agentDir)).not.toThrow();
    });
  });
});
