/**
 * Claude CLI Executable Discovery
 *
 * Functions for locating the system-installed Claude Code CLI executable,
 * handling platform-specific quirks (Windows npm global installs, packaged apps, etc.).
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Find the system-installed Node.js directory on Windows.
 * 
 * When running in a packaged app (clawstudio-backend.exe), process.execPath
 * points to the bun-compiled single-file executable, which cannot be used
 * as a Node.js runtime for spawning external JS files.
 * 
 * This function locates the actual Node.js installation directory so we can
 * add it to PATH before spawning the SDK.
 * 
 * @returns Directory containing node.exe, or null if not found
 */
export function findWindowsNodeDir(): string | null {
  // Common Node.js installation paths on Windows
  const possibleDirs = [
    // Program Files (64-bit)
    'C:\\Program Files\\nodejs',
    // Program Files (x86) (32-bit)
    'C:\\Program Files (x86)\\nodejs',
    // User-specific installation via nvm-windows
    path.join(process.env.USERPROFILE || '', 'scoop\\apps\\nodejs\\current'),
    // nvm-windows default
    path.join(process.env.APPDATA || '', 'nvm\\current'),
  ];

  for (const dir of possibleDirs) {
    const nodeExe = path.join(dir, 'node.exe');
    if (fs.existsSync(nodeExe)) {
      return dir;
    }
  }

  // Try to find via `where node` command
  try {
    const result = require('child_process').execFileSync('where', ['node'], { encoding: 'utf8', timeout: 2000 });
    const lines = result.trim().split('\n');
    if (lines.length > 0) {
      const nodePath = lines[0].trim();
      if (fs.existsSync(nodePath)) {
        return path.dirname(nodePath);
      }
    }
  } catch {
    // `where` command failed, ignore
  }

  return null;
}

/**
 * On Windows, resolve an npm global executable path to its actual .js entry point.
 *
 * npm global installs create three files:
 *   - `claude-internal`     (POSIX shell script — cannot spawn on Windows)
 *   - `claude-internal.cmd` (batch wrapper — spawn returns EINVAL without shell:true)
 *   - `claude-internal.ps1` (PowerShell wrapper)
 *
 * The Claude Agent SDK uses child_process.spawn() without shell:true, so neither
 * the shell script nor .cmd can be executed. The SDK checks if the path ends with
 * a JS extension (.js/.mjs/.ts etc.) — if not, it treats it as a native binary
 * and tries to spawn it directly, which fails.
 *
 * This function parses the .cmd file to extract the actual .js entry path that
 * the SDK can spawn via `node <path.js>`.
 *
 * @param executablePath - Path like "C:\Users\x\AppData\Roaming\npm\claude-internal"
 * @returns The resolved .js path, or null if it cannot be determined
 */
export function resolveWindowsNpmGlobalJsEntry(executablePath: string): string | null {
  try {
    const cmdPath = executablePath.endsWith('.cmd') ? executablePath : `${executablePath}.cmd`;
    if (!fs.existsSync(cmdPath)) return null;

    const content = fs.readFileSync(cmdPath, 'utf-8');

    // npm .cmd wrappers end with a line like:
    //   "%_prog%"  "%dp0%\node_modules\@tencent\claude-code-internal\dist\claude-code-internal.js" %*
    // We extract the .js path relative to %dp0% (the directory containing the .cmd file)
    const match = content.match(/%dp0%\\([^"]+\.js)/i) || content.match(/%dp0%\/([^"]+\.js)/i);
    if (!match) {
      console.warn(`⚠️  Could not parse .js entry from: ${cmdPath}`);
      return null;
    }

    const basedir = path.dirname(cmdPath);
    const jsRelPath = match[1].replace(/\//g, path.sep);
    const jsAbsPath = path.resolve(basedir, jsRelPath);

    if (fs.existsSync(jsAbsPath)) {
      console.log(`🎯 Resolved Windows npm global → JS entry: ${jsAbsPath}`);
      return jsAbsPath;
    }

    console.warn(`⚠️  Resolved JS path does not exist: ${jsAbsPath}`);
    return null;
  } catch (error) {
    console.error(`Failed to resolve Windows npm global JS entry for: ${executablePath}`, error);
    return null;
  }
}

/**
 * Get the path to the system-installed Claude executable
 * Only used when user explicitly wants to use system installation
 *
 * Note: When no executable path is specified, SDK will automatically
 * use its bundled CLI which is always compatible with the SDK version.
 * 
 * @param cliName - CLI executable name (e.g., 'claude' or 'claude-internal')
 */
export async function getSystemClaudeExecutablePath(cliName?: string): Promise<string | null> {
  const resolvedCliName = cliName || 'claude';
  try {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? `where ${resolvedCliName}` : `which ${resolvedCliName}`;

    const { stdout: claudePath } = await execAsync(command);
    if (!claudePath) return null;

    const pathCandidates = claudePath
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (pathCandidates.length === 0) return null;

    const cleanPath = pathCandidates[0];

    // Skip local node_modules paths - we want global installation
    if (cleanPath.includes('node_modules/.bin') || cleanPath.includes('node_modules\\.bin')) {
      try {
        const allCommand = isWindows ? `where ${resolvedCliName}` : `which -a ${resolvedCliName}`;
        const { stdout: allClaudes } = await execAsync(allCommand);
        const claudes = allClaudes
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        // Find the first non-local installation
        for (const claudePathOption of claudes) {
          if (!claudePathOption.includes('node_modules/.bin') &&
              !claudePathOption.includes('node_modules\\.bin')) {
            if (isWindows) {
              const jsEntryPath = resolveWindowsNpmGlobalJsEntry(claudePathOption);
              if (jsEntryPath) {
                return jsEntryPath;
              }

              if (fs.existsSync(claudePathOption)) {
                return claudePathOption;
              }

              continue;
            }

            return claudePathOption;
          }
        }
      } catch (error) {
        // Fallback to the first path found
      }
    }

    // On Windows, npm global installs create:
    //   1. A POSIX shell script (e.g. "claude-internal") — cannot be spawned on Windows
    //   2. A .cmd wrapper (e.g. "claude-internal.cmd") — cannot be spawned by SDK (EINVAL)
    // The SDK's spawn expects either a native binary or a .js file.
    // We parse the .cmd to extract the actual .js entry point.
    if (isWindows) {
      for (const candidatePath of pathCandidates) {
        const jsEntryPath = resolveWindowsNpmGlobalJsEntry(candidatePath);
        if (jsEntryPath) {
          return jsEntryPath;
        }

        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }

      console.warn(`⚠️  Claude executable not found at any resolved path: ${pathCandidates.join(', ')}`);
      console.warn(`   SDK will use bundled CLI instead`);
      return null;
    }

    return cleanPath;
  } catch (error) {
    console.error(`Failed to get system ${resolvedCliName} executable path:`, error);
  }

  // Fallback: try login shell then interactive shell on macOS/Linux
  if (process.platform !== 'win32') {
    for (const flags of ['-lc', '-ic'] as const) {
      for (const shell of ['zsh', 'bash']) {
        try {
          const { stdout } = await execAsync(
            `${shell} ${flags} 'command -v ${resolvedCliName}'`,
            { timeout: 8000 },
          );
          const result = stdout
            .split('\n')
            .filter(l => l.trim().startsWith('/'))
            .pop()
            ?.trim();
          if (result) {
            console.log(`🎯 Found ${resolvedCliName} via ${shell} ${flags}: ${result}`);
            return result;
          }
        } catch {
          // not found in this shell/mode, try next
        }
      }
    }
  }

  return null;
}

/**
 * @deprecated Use SDK's bundled CLI by not passing pathToClaudeCodeExecutable
 * This function is kept for backward compatibility when user explicitly configures a path
 */
export async function getClaudeExecutablePath(): Promise<string | null> {
  return getSystemClaudeExecutablePath();
}
