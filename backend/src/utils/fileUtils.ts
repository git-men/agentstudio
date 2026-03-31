import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Atomically write content to a file using write-to-temp + rename.
 *
 * rename() is atomic on the same filesystem, so readers will never see
 * a partially-written file. The temp file is created in the same
 * directory as the target to guarantee same-filesystem semantics.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    fsSync.writeFileSync(tmpPath, content, 'utf-8');
    fsSync.renameSync(tmpPath, filePath);
  } catch (error) {
    try { fsSync.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw error;
  }
}

/**
 * Atomically write a JSON value to a file (pretty-printed).
 */
export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, 2));
}
