/**
 * Unit tests for SecretStore — AES-256-GCM encryption with keytar/file-based master key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

// Mock keytar before importing secretStore
vi.mock('keytar', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getPassword: vi.fn(async (service: string, account: string) => store.get(`${service}:${account}`) ?? null),
      setPassword: vi.fn(async (service: string, account: string, password: string) => { store.set(`${service}:${account}`, password); }),
      deletePassword: vi.fn(async (service: string, account: string) => store.delete(`${service}:${account}`)),
    },
    getPassword: vi.fn(async (service: string, account: string) => store.get(`${service}:${account}`) ?? null),
    setPassword: vi.fn(async (service: string, account: string, password: string) => { store.set(`${service}:${account}`, password); }),
    deletePassword: vi.fn(async (service: string, account: string) => store.delete(`${service}:${account}`)),
  };
});

// Mock fs to avoid real file I/O
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

vi.mock('fs/promises', async () => ({
  readFile: vi.fn(async () => { throw new Error('no file'); }),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  chmod: vi.fn(async () => {}),
}));

vi.mock('../../config/paths.js', () => ({
  AGENTSTUDIO_HOME: '/tmp/test-agentstudio',
}));

describe('SecretStore', () => {
  let encrypt: typeof import('../secretStore').encrypt;
  let decrypt: typeof import('../secretStore').decrypt;
  let isEncrypted: typeof import('../secretStore').isEncrypted;
  let encryptSecret: typeof import('../secretStore').encryptSecret;
  let decryptSecret: typeof import('../secretStore').decryptSecret;
  let encryptEnvVars: typeof import('../secretStore').encryptEnvVars;
  let decryptEnvVars: typeof import('../secretStore').decryptEnvVars;
  let migrateToEncrypted: typeof import('../secretStore').migrateToEncrypted;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../secretStore');
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
    isEncrypted = mod.isEncrypted;
    encryptSecret = mod.encryptSecret;
    decryptSecret = mod.decryptSecret;
    encryptEnvVars = mod.encryptEnvVars;
    decryptEnvVars = mod.decryptEnvVars;
    migrateToEncrypted = mod.migrateToEncrypted;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('encrypt / decrypt (low-level)', () => {
    it('should encrypt and decrypt a string with a master key', () => {
      const masterKey = randomBytes(32);
      const plaintext = 'my-secret-api-key-12345';
      const context = 'test-context';

      const encrypted = encrypt(plaintext, context, masterKey);

      expect(encrypted).toMatch(/^enc:/);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = decrypt(encrypted, context, masterKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same input (random IV)', () => {
      const masterKey = randomBytes(32);
      const plaintext = 'same-value';
      const context = 'ctx';

      const enc1 = encrypt(plaintext, context, masterKey);
      const enc2 = encrypt(plaintext, context, masterKey);

      expect(enc1).not.toBe(enc2);

      expect(decrypt(enc1, context, masterKey)).toBe(plaintext);
      expect(decrypt(enc2, context, masterKey)).toBe(plaintext);
    });

    it('should fail decryption with wrong master key', () => {
      const key1 = randomBytes(32);
      const key2 = randomBytes(32);
      const encrypted = encrypt('secret', 'ctx', key1);

      expect(() => decrypt(encrypted, 'ctx', key2)).toThrow();
    });

    it('should fail decryption with wrong context', () => {
      const masterKey = randomBytes(32);
      const encrypted = encrypt('secret', 'ctx-a', masterKey);

      expect(() => decrypt(encrypted, 'ctx-b', masterKey)).toThrow();
    });

    it('should pass through plaintext in decrypt (backward compat)', () => {
      const masterKey = randomBytes(32);
      const result = decrypt('not-encrypted-value', 'ctx', masterKey);
      expect(result).toBe('not-encrypted-value');
    });

    it('should handle empty strings', () => {
      const masterKey = randomBytes(32);
      const encrypted = encrypt('', 'ctx', masterKey);
      expect(encrypted).toMatch(/^enc:/);
      const decrypted = decrypt(encrypted, 'ctx', masterKey);
      expect(decrypted).toBe('');
    });

    it('should handle unicode text', () => {
      const masterKey = randomBytes(32);
      const plaintext = '密码测试 🔐 Tëst';
      const encrypted = encrypt(plaintext, 'ctx', masterKey);
      expect(decrypt(encrypted, 'ctx', masterKey)).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should detect encrypted values', () => {
      expect(isEncrypted('enc:abc123')).toBe(true);
      expect(isEncrypted('enc:')).toBe(true);
    });

    it('should reject plaintext values', () => {
      expect(isEncrypted('not-encrypted')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted('ENC:uppercase')).toBe(false);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('should encrypt and decrypt a secret value', async () => {
      const secret = 'sk-ant-test-key-12345';
      const encrypted = await encryptSecret(secret, 'test');
      expect(encrypted).toMatch(/^enc:/);

      const decrypted = await decryptSecret(encrypted, 'test');
      expect(decrypted).toBe(secret);
    });

    it('should pass through empty values', async () => {
      expect(await encryptSecret('', 'ctx')).toBe('');
    });

    it('should not double-encrypt', async () => {
      const secret = 'sk-test-key';
      const encrypted = await encryptSecret(secret, 'ctx');
      const doubleEncrypted = await encryptSecret(encrypted, 'ctx');
      expect(doubleEncrypted).toBe(encrypted);
    });

    it('should pass through plaintext in decryptSecret', async () => {
      const result = await decryptSecret('plain-value', 'ctx');
      expect(result).toBe('plain-value');
    });
  });

  describe('encryptEnvVars / decryptEnvVars', () => {
    it('should encrypt only sensitive keys', async () => {
      const envVars = {
        ANTHROPIC_API_KEY: 'sk-ant-real-key',
        OPENAI_API_KEY: 'sk-openai-key',
        NODE_ENV: 'production',
        CUSTOM_VAR: 'not-sensitive',
      };

      const encrypted = await encryptEnvVars(envVars, 'version-1');

      expect(encrypted.ANTHROPIC_API_KEY).toMatch(/^enc:/);
      expect(encrypted.OPENAI_API_KEY).toMatch(/^enc:/);
      expect(encrypted.NODE_ENV).toBe('production');
      expect(encrypted.CUSTOM_VAR).toBe('not-sensitive');
    });

    it('should decrypt back to original values', async () => {
      const original = {
        ANTHROPIC_API_KEY: 'sk-ant-real-key',
        HTTP_PROXY: 'http://user:pass@proxy:8080',
        NODE_ENV: 'production',
      };

      const encrypted = await encryptEnvVars(original, 'v1');
      const decrypted = await decryptEnvVars(encrypted, 'v1');

      expect(decrypted).toEqual(original);
    });

    it('should handle mixed encrypted and plaintext values', async () => {
      const mixed = {
        ANTHROPIC_API_KEY: 'sk-ant-plaintext-key',
        NODE_ENV: 'test',
      };

      const encrypted = await encryptEnvVars(mixed, 'ctx');
      // Manually keep one as plaintext
      encrypted.NODE_ENV = 'test';

      const decrypted = await decryptEnvVars(encrypted, 'ctx');
      expect(decrypted.ANTHROPIC_API_KEY).toBe('sk-ant-plaintext-key');
      expect(decrypted.NODE_ENV).toBe('test');
    });

    it('should skip empty values', async () => {
      const envVars = {
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: 'sk-key',
      };

      const encrypted = await encryptEnvVars(envVars, 'ctx');
      expect(encrypted.ANTHROPIC_API_KEY).toBe('');
      expect(encrypted.OPENAI_API_KEY).toMatch(/^enc:/);
    });
  });

  describe('migrateToEncrypted', () => {
    it('should migrate plaintext sensitive keys', async () => {
      const envVars = {
        ANTHROPIC_API_KEY: 'sk-ant-key',
        NODE_ENV: 'production',
      };

      const { migrated, result } = await migrateToEncrypted(envVars, 'ctx');

      expect(migrated).toBe(true);
      expect(result.ANTHROPIC_API_KEY).toMatch(/^enc:/);
      expect(result.NODE_ENV).toBe('production');
    });

    it('should not flag migration when all are already encrypted', async () => {
      const envVars = {
        ANTHROPIC_API_KEY: 'enc:already-encrypted',
        NODE_ENV: 'production',
      };

      const { migrated, result } = await migrateToEncrypted(envVars, 'ctx');

      expect(migrated).toBe(false);
      expect(result.ANTHROPIC_API_KEY).toBe('enc:already-encrypted');
    });

    it('should report no migration when no sensitive keys exist', async () => {
      const envVars = { NODE_ENV: 'test', CUSTOM: 'val' };
      const { migrated } = await migrateToEncrypted(envVars, 'ctx');
      expect(migrated).toBe(false);
    });
  });
});
