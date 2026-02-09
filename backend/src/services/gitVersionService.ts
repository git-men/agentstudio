/**
 * Git Version Service
 * 
 * Provides Git-based version management for AgentStudio projects.
 * Each project gets its own Git repository (lazy-initialized on first version save).
 * Versions are stored as Git tags (v1, v2, ...) with user-provided descriptions as commit messages.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Default .gitignore content for AgentStudio projects
 */
const DEFAULT_GITIGNORE = `# AgentStudio runtime data
.cc-sessions/
.a2a/history/
.a2a/tasks/
.a2a/api-keys.json
node_modules/
.DS_Store
*.log
`;

export interface VersionInfo {
  tag: string;
  message: string;
  date: string;
  hash: string;
  commitHash: string;
  isCurrent: boolean;
}

export interface VersionStatus {
  initialized: boolean;
  currentVersion: string | null;
  isDirty: boolean;
  untrackedFiles: number;
  modifiedFiles: number;
  totalVersions: number;
}

export interface CreateVersionResult {
  tag: string;
  hash: string;
  commitHash: string;
  message: string;
}

/**
 * Execute a git command in the specified directory
 */
async function git(projectPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: projectPath,
      env: {
        ...process.env,
        // Ensure consistent git behavior
        GIT_TERMINAL_PROMPT: '0',
        // Use English for consistent parsing
        LANG: 'en_US.UTF-8',
      },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout.trim();
  } catch (error: any) {
    // Re-throw with more context
    const stderr = error.stderr?.trim() || '';
    const message = stderr || error.message;
    throw new Error(`Git error: ${message}`);
  }
}

/**
 * Check if a directory is a git repository
 */
export async function isGitInitialized(projectPath: string): Promise<boolean> {
  try {
    await git(projectPath, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize git repository for a project
 */
async function initGitRepo(projectPath: string): Promise<void> {
  // git init
  await git(projectPath, ['init']);

  // Create .gitignore if it doesn't exist
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf-8');
  }

  // Configure local git user for commits (avoid requiring global config)
  await git(projectPath, ['config', 'user.name', 'AgentStudio']);
  await git(projectPath, ['config', 'user.email', 'agentstudio@local']);
}

/**
 * Get the next version number (auto-increment)
 */
async function getNextVersionNumber(projectPath: string): Promise<number> {
  try {
    const output = await git(projectPath, ['tag', '--list', 'v*', '--sort=-version:refname']);
    if (!output) return 1;

    const tags = output.split('\n').filter(t => /^v\d+$/.test(t));
    if (tags.length === 0) return 1;

    // Extract the highest version number
    const maxVersion = Math.max(...tags.map(t => parseInt(t.substring(1), 10)));
    return maxVersion + 1;
  } catch {
    return 1;
  }
}

/**
 * Create a new version (git add + commit + tag)
 */
export async function createVersion(
  projectPath: string,
  message: string
): Promise<CreateVersionResult> {
  // Validate project path exists
  if (!fs.existsSync(projectPath)) {
    let realPath: string | null = null;
    try {
      realPath = fs.realpathSync(projectPath);
    } catch {
      realPath = null;
    }
    console.error('[GitVersion] createVersion: project path missing', {
      projectPath,
      cwd: process.cwd(),
      realPath,
      exists: false,
    });
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  // Lazy init: initialize git if not already done
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    await initGitRepo(projectPath);
  }

  // Stage all files
  await git(projectPath, ['add', '-A']);

  // Check if there are changes to commit
  try {
    await git(projectPath, ['diff', '--cached', '--quiet']);
    // If the above succeeds (no error), there are no staged changes
    // But this might be the first commit with no changes - check if repo has any commits
    try {
      await git(projectPath, ['rev-parse', 'HEAD']);
      // Has commits and no staged changes
      throw new Error('No changes to save. The project has no modifications since the last version.');
    } catch (e: any) {
      if (e.message.includes('No changes to save')) throw e;
      // No commits yet - allow initial commit even with "no changes" (the gitignore etc.)
    }
  } catch (e: any) {
    if (e.message.includes('No changes to save')) throw e;
    // Has staged changes - proceed with commit
  }

  // Get the next version number
  const versionNumber = await getNextVersionNumber(projectPath);
  const tag = `v${versionNumber}`;

  // Commit
  const commitMessage = message || `Version ${versionNumber}`;
  await git(projectPath, ['commit', '-m', commitMessage, '--allow-empty']);

  // Tag
  await git(projectPath, ['tag', '-a', tag, '-m', commitMessage]);

  // Get the commit hash
  const commitHash = await git(projectPath, ['rev-parse', 'HEAD']);

  return { tag, hash: commitHash, commitHash, message: commitMessage };
}
/**
 * Create a tag for the current HEAD without creating a new commit
 */
export async function createTagOnly(
  projectPath: string,
  tag: string,
  message?: string
): Promise<CreateVersionResult> {
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }

  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    throw new Error('Project has no version history');
  }

  try {
    await git(projectPath, ['rev-parse', 'HEAD']);
  } catch {
    throw new Error('No commits to tag');
  }

  if (!tag || typeof tag !== 'string' || !tag.trim()) {
    throw new Error('Tag is required');
  }
  const normalizedTag = tag.trim();
  const tagMessage = message || `Tag ${normalizedTag}`;

  await git(projectPath, ['tag', '-a', '-f', normalizedTag, '-m', tagMessage]);

  const commitHash = await git(projectPath, ['rev-parse', 'HEAD']);
  return { tag: normalizedTag, hash: commitHash, commitHash, message: tagMessage };
}

/**
 * List all versions (tags) for a project
 */
export async function listVersions(projectPath: string): Promise<VersionInfo[]> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    return [];
  }

  try {
    // Get all version tags with their info
    const output = await git(projectPath, [
      'tag', '--list', 'v*',
      '--list', 'slot*',
      '--sort=-version:refname',
      '--format=%(refname:short)%09%(objectname:short)%09%(creatordate:iso)%09%(contents:subject)'
    ]);

    if (!output) return [];

    // Get current HEAD commit hash to determine current version
    let currentHash = '';
    try {
      currentHash = await git(projectPath, ['rev-parse', '--short', 'HEAD']);
    } catch {
      // No commits yet
    }

    const versions: VersionInfo[] = output
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [tag, hash, date, ...messageParts] = line.split('\t');
        return {
          tag: tag || '',
          hash: hash || '',
          commitHash: '',
          date: date || '',
          message: messageParts.join('\t') || '',
          isCurrent: false, // Will be set below
        };
      })
      .filter(v => /^v\d+$/.test(v.tag) || /^slot\d+$/.test(v.tag));

    // Determine which version is current (find tag that points to HEAD)
    for (const version of versions) {
      try {
        const tagHash = await git(projectPath, ['rev-parse', '--short', `${version.tag}`]);
        const tagCommitHash = await git(projectPath, ['rev-parse', '--short', `${version.tag}^{commit}`]);
        version.hash = tagHash;
        version.commitHash = tagCommitHash;
        if (currentHash && tagCommitHash === currentHash) {
          version.isCurrent = true;
        }
      } catch {
        // Skip if tag can't be resolved
      }
    }

    return versions;
  } catch {
    return [];
  }
}

/**
 * Get the current version status of a project
 */
export async function getVersionStatus(projectPath: string): Promise<VersionStatus> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    return {
      initialized: false,
      currentVersion: null,
      isDirty: false,
      untrackedFiles: 0,
      modifiedFiles: 0,
      totalVersions: 0,
    };
  }

  // Count version tags
  let totalVersions = 0;
  try {
    const tagsOutput = await git(projectPath, ['tag', '--list', 'v*']);
    if (tagsOutput) {
      totalVersions = tagsOutput.split('\n').filter(t => /^v\d+$/.test(t)).length;
    }
  } catch {
    // No tags
  }

  // Check dirty state
  let isDirty = false;
  let modifiedFiles = 0;
  let untrackedFiles = 0;
  try {
    const statusOutput = await git(projectPath, ['status', '--porcelain']);
    if (statusOutput) {
      const lines = statusOutput.split('\n').filter(l => l.trim());
      isDirty = lines.length > 0;
      untrackedFiles = lines.filter(l => l.startsWith('??')).length;
      modifiedFiles = lines.filter(l => !l.startsWith('??')).length;
    }
  } catch {
    // Not a git repo or no commits yet
  }

  // Find current version (tag that points to HEAD)
  let currentVersion: string | null = null;
  try {
    const currentTag = await git(projectPath, ['describe', '--tags', '--exact-match', 'HEAD']);
    if (/^v\d+$/.test(currentTag)) {
      currentVersion = currentTag;
    }
  } catch {
    // HEAD is not at a tag - that's fine, means there are uncommitted changes
  }

  return {
    initialized,
    currentVersion,
    isDirty,
    untrackedFiles,
    modifiedFiles,
    totalVersions,
  };
}

/**
 * Get current HEAD commit hash
 */
export async function getCurrentCommitHash(projectPath: string): Promise<string> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    throw new Error('Project has no version history');
  }
  try {
    return await git(projectPath, ['rev-parse', 'HEAD']);
  } catch {
    throw new Error('No commits found');
  }
}

/**
 * Checkout a specific version
 */
export async function checkoutVersion(
  projectPath: string,
  tag: string,
  force: boolean = false
): Promise<void> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    throw new Error('Project has no version history');
  }

  // Validate tag format
  // if (!/^slot[1-5]$/.test(tag)) {
  //   throw new Error(`Invalid version tag: ${tag}`);
  // }

  // Check if tag exists
  try {
    await git(projectPath, ['rev-parse', `${tag}^{commit}`]);
  } catch {
    throw new Error(`Version ${tag} not found`);
  }

  // Check for uncommitted changes if not forcing
  if (!force) {
    const status = await getVersionStatus(projectPath);
    if (status.isDirty) {
      throw new Error('DIRTY_WORKING_TREE');
    }
  }

  // Checkout the tag (detached HEAD for safety, then go back to main)
  // First, ensure we're on main branch
  try {
    await git(projectPath, ['checkout', 'main']);
  } catch {
    try {
      await git(projectPath, ['checkout', 'master']);
    } catch {
      // Create main branch if neither exists
      await git(projectPath, ['checkout', '-b', 'main']);
    }
  }

  // Reset to the tag
  if (force) {
    await git(projectPath, ['reset', '--hard', tag]);
  } else {
    await git(projectPath, ['reset', '--hard', tag]);
  }
}

/**
 * Rollback to a specific commit by creating a new commit whose tree
 * exactly matches the target commit, preserving all history.
 *
 * Strategy:
 *   1. Save the current HEAD ref
 *   2. `git reset --hard <target>` — working tree + index now match the target
 *   3. `git reset --soft <original HEAD>` — move HEAD back, keeping tree/index
 *   4. `git commit` — new commit on the current branch with the target's content
 *   5. Tag the new commit with the next auto-incremented version number
 */
export async function rollbackVersion(
  projectPath: string,
  hash: string
): Promise<CreateVersionResult> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    throw new Error('Project has no version history');
  }

  // Validate that the hash refers to a valid commit
  let fullHash: string;
  try {
    fullHash = await git(projectPath, ['rev-parse', '--verify', hash]);
  } catch {
    throw new Error(`Commit ${hash} not found`);
  }

  // Ensure we're on main/master branch
  try {
    await git(projectPath, ['checkout', 'main']);
  } catch {
    try {
      await git(projectPath, ['checkout', 'master']);
    } catch {
      await git(projectPath, ['checkout', '-b', 'main']);
    }
  }

  // 1. Save current HEAD so we can come back
  const originalHead = await git(projectPath, ['rev-parse', 'HEAD']);

  // 2. Reset working tree + index to the target commit's state
  await git(projectPath, ['reset', '--hard', fullHash]);

  // 3. Move HEAD back to the original position, keeping working tree + index
  await git(projectPath, ['reset', '--soft', originalHead]);

  // 4. Commit — creates a new commit whose tree matches the target exactly
  const commitMessage = `Rollback to ${hash.substring(0, 7)}`;
  await git(projectPath, ['commit', '-m', commitMessage, '--allow-empty']);

  // 5. Tag the new commit
  const versionNumber = await getNextVersionNumber(projectPath);
  const tag = `v${versionNumber}`;
  const newCommitHash = await git(projectPath, ['rev-parse', 'HEAD']);

  await git(projectPath, ['tag', '-a', tag, '-m', commitMessage]);

  return { tag, hash: newCommitHash, commitHash: newCommitHash, message: commitMessage };
}

/**
 * Delete a version tag (does not delete the commit)
 */
export async function deleteVersion(
  projectPath: string,
  tag: string
): Promise<void> {
  const initialized = await isGitInitialized(projectPath);
  if (!initialized) {
    throw new Error('Project has no version history');
  }

  // Validate tag format
  // if (!/^slot[1-5]$/.test(tag)) {
  //   throw new Error(`Invalid version tag: ${tag}`);
  // }

  // Check if tag exists
  try {
    await git(projectPath, ['rev-parse', `${tag}^{commit}`]);
  } catch {
    throw new Error(`Version ${tag} not found`);
  }

  // Delete the tag
  await git(projectPath, ['tag', '-d', tag]);
}
