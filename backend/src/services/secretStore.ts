/**
 * SecretStore — cross-platform credential storage with OS Keychain integration.
 *
 * Uses `keytar` for unified keychain access across platforms:
 *   macOS   → Keychain
 *   Windows → Credential Manager
 *   Linux   → Secret Service (libsecret)
 *
 * Falls back to encrypted file if keytar is unavailable (e.g. headless Docker).
 *
 * All sensitive values are encrypted with AES-256-GCM using a master key
 * that is stored in the OS keychain or a protected key file.
 */

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { AGENTSTUDIO_HOME } from '../config/paths.js';

const SERVICE_NAME = 'ClawStudio';
const ACCOUNT_NAME = 'master-key';
const KEY_FILE = join(AGENTSTUDIO_HOME, 'data', '.secret-key');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'clawstudio-secret-store-v1';

let cachedMasterKey: Buffer | null = null;
let keytarModule: typeof import('keytar') | null = null;
let keytarLoadAttempted = false;

// ─── Keytar Lazy Loading ────────────────────────────────────────────────────

async function getKeytar(): Promise<typeof import('keytar') | null> {
  if (keytarLoadAttempted) return keytarModule;
  keytarLoadAttempted = true;
  try {
    keytarModule = await import('keytar');
    return keytarModule;
  } catch {
    return null;
  }
}

// ─── Master Key Management ──────────────────────────────────────────────────

async function getMasterKeyFromKeychain(): Promise<Buffer | null> {
  const keytar = await getKeytar();
  if (!keytar) return null;

  try {
    const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    if (stored) return Buffer.from(stored, 'base64');
  } catch { /* keychain not available */ }
  return null;
}

async function storeMasterKeyInKeychain(key: Buffer): Promise<boolean> {
  const keytar = await getKeytar();
  if (!keytar) return false;

  try {
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, key.toString('base64'));
    return true;
  } catch {
    return false;
  }
}

async function getMasterKeyFromFile(): Promise<Buffer | null> {
  try {
    if (!existsSync(KEY_FILE)) return null;
    const content = await readFile(KEY_FILE, 'utf-8');
    return Buffer.from(content.trim(), 'base64');
  } catch {
    return null;
  }
}

async function storeMasterKeyInFile(key: Buffer): Promise<void> {
  await mkdir(dirname(KEY_FILE), { recursive: true });
  await writeFile(KEY_FILE, key.toString('base64'), { mode: 0o600 });
  try {
    await chmod(KEY_FILE, 0o600);
  } catch { /* best effort */ }
}

async function getOrCreateMasterKey(): Promise<Buffer> {
  if (cachedMasterKey) return cachedMasterKey;

  // Try OS Keychain first (via keytar)
  let key = await getMasterKeyFromKeychain();
  if (key && key.length === KEY_LENGTH) {
    cachedMasterKey = key;
    return key;
  }

  // Try key file (fallback for headless / Docker environments)
  key = await getMasterKeyFromFile();
  if (key && key.length === KEY_LENGTH) {
    // Migrate to Keychain if possible
    await storeMasterKeyInKeychain(key);
    cachedMasterKey = key;
    return key;
  }

  // Generate new master key
  key = randomBytes(KEY_LENGTH);

  // Store in Keychain and always in file as fallback
  const storedInKeychain = await storeMasterKeyInKeychain(key);
  await storeMasterKeyInFile(key);

  if (storedInKeychain) {
    console.log('[SecretStore] Master key stored in OS Keychain (via keytar)');
  } else {
    console.log('[SecretStore] Master key stored in protected file (keychain unavailable)');
  }

  cachedMasterKey = key;
  return key;
}

// ─── Encryption / Decryption ────────────────────────────────────────────────

function deriveKey(masterKey: Buffer, context: string): Buffer {
  return scryptSync(masterKey, `${SALT}:${context}`, KEY_LENGTH);
}

export function encrypt(plaintext: string, context: string, masterKey: Buffer): string {
  const key = deriveKey(masterKey, context);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv + tag + ciphertext)
  const combined = Buffer.concat([iv, tag, encrypted]);
  return `enc:${combined.toString('base64')}`;
}

export function decrypt(ciphertext: string, context: string, masterKey: Buffer): string {
  if (!ciphertext.startsWith('enc:')) {
    return ciphertext; // plaintext passthrough for migration
  }

  const data = Buffer.from(ciphertext.slice(4), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(masterKey, context);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf-8');
}

function isEncrypted(value: string): boolean {
  return value.startsWith('enc:');
}

// ─── Public API ─────────────────────────────────────────────────────────────

const SENSITIVE_ENV_KEYS = new Set([
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
]);

/**
 * Encrypt sensitive environment variables in a record.
 * Non-sensitive keys are left as-is.
 */
export async function encryptEnvVars(
  envVars: Record<string, string>,
  context: string,
): Promise<Record<string, string>> {
  const masterKey = await getOrCreateMasterKey();
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (SENSITIVE_ENV_KEYS.has(key) && value && !isEncrypted(value)) {
      result[key] = encrypt(value, `${context}:${key}`, masterKey);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Decrypt sensitive environment variables in a record.
 * Plaintext values pass through unchanged (backward compatible).
 */
export async function decryptEnvVars(
  envVars: Record<string, string>,
  context: string,
): Promise<Record<string, string>> {
  const masterKey = await getOrCreateMasterKey();
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (isEncrypted(value)) {
      try {
        result[key] = decrypt(value, `${context}:${key}`, masterKey);
      } catch {
        console.warn(`[SecretStore] Failed to decrypt ${key}, returning as-is`);
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Encrypt a single secret value.
 */
export async function encryptSecret(value: string, context: string): Promise<string> {
  if (!value || isEncrypted(value)) return value;
  const masterKey = await getOrCreateMasterKey();
  return encrypt(value, context, masterKey);
}

/**
 * Decrypt a single secret value. Plaintext values pass through.
 */
export async function decryptSecret(value: string, context: string): Promise<string> {
  if (!value || !isEncrypted(value)) return value;
  const masterKey = await getOrCreateMasterKey();
  try {
    return decrypt(value, context, masterKey);
  } catch {
    console.warn(`[SecretStore] Failed to decrypt secret for context: ${context}`);
    return value;
  }
}

/**
 * Migrate plaintext environment variables to encrypted form.
 * Returns true if any values were migrated.
 */
export async function migrateToEncrypted(
  envVars: Record<string, string>,
  context: string,
): Promise<{ migrated: boolean; result: Record<string, string> }> {
  let migrated = false;
  const masterKey = await getOrCreateMasterKey();
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (SENSITIVE_ENV_KEYS.has(key) && value && !isEncrypted(value)) {
      result[key] = encrypt(value, `${context}:${key}`, masterKey);
      migrated = true;
    } else {
      result[key] = value;
    }
  }

  return { migrated, result };
}

export { isEncrypted, getOrCreateMasterKey };
