import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

/**
 * Create a symlink with post-creation verification.
 *
 * On Windows, `fs.symlinkSync` can appear to succeed (no exception) while
 * silently producing nothing — e.g. when the user lacks SeCreateSymbolicLink
 * privileges or security software blocks the operation.
 *
 * This helper verifies the result with `lstatSync` immediately after creation.
 * If the symlink is missing it falls back to:
 *   - `copyFileSync` for file targets
 *   - recursive `cpSync` for directory targets
 *
 * @returns 'symlink' | 'copy' indicating which strategy succeeded.
 */
export function robustSymlinkSync(target: string, linkPath: string): 'symlink' | 'copy' {
  const isDir = fsSync.statSync(target).isDirectory();
  const isWin = process.platform === 'win32';

  // On Windows, directory junctions don't require elevated privileges
  // and work reliably. Use them preferentially for directory targets.
  if (isWin && isDir) {
    try {
      fsSync.symlinkSync(path.resolve(target), linkPath, 'junction');
      try {
        fsSync.lstatSync(linkPath);
        return 'symlink';
      } catch { /* junction silently failed */ }
    } catch { /* junction threw */ }
  } else {
    try {
      fsSync.symlinkSync(target, linkPath);
      try {
        fsSync.lstatSync(linkPath);
        return 'symlink';
      } catch { /* symlinkSync didn't throw but the link doesn't exist */ }
    } catch { /* symlinkSync threw — expected on unprivileged Windows */ }
  }

  // Fallback: copy instead of symlink
  if (isDir) {
    fsSync.cpSync(target, linkPath, { recursive: true });
  } else {
    fsSync.copyFileSync(target, linkPath);
  }
  console.warn(`[robustSymlinkSync] Symlink failed, copied instead: ${linkPath} -> ${target}`);
  return 'copy';
}

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
