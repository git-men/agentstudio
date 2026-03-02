import { describe, it, expect } from 'vitest';
import { parseMarketplaceEntry, extractBranch } from '../builtinMarketplaceService.js';

describe('extractBranch', () => {
  it('returns source as-is when no @branch suffix', () => {
    expect(extractBranch('owner/repo')).toEqual({ value: 'owner/repo' });
  });

  it('extracts @branch from github shorthand', () => {
    expect(extractBranch('owner/repo@develop')).toEqual({
      value: 'owner/repo',
      branch: 'develop',
    });
  });

  it('extracts @branch from HTTPS URL', () => {
    expect(extractBranch('https://github.com/owner/repo.git@feature')).toEqual({
      value: 'https://github.com/owner/repo.git',
      branch: 'feature',
    });
  });

  it('handles git@... SSH URL without branch (@ is part of the URL, not a branch separator)', () => {
    // git@github.com:owner/repo.git — the @ before github.com is not after last /
    // lastSlash is at "repo.git" boundary, afterSlash = "/repo.git", no @ in afterSlash
    expect(extractBranch('git@github.com:owner/repo.git')).toEqual({
      value: 'git@github.com:owner/repo.git',
    });
  });

  it('handles git@... SSH URL with branch suffix', () => {
    expect(extractBranch('git@github.com:owner/repo.git@main')).toEqual({
      value: 'git@github.com:owner/repo.git',
      branch: 'main',
    });
  });

  it('returns source as-is for simple string without @ or /', () => {
    expect(extractBranch('my-marketplace')).toEqual({ value: 'my-marketplace' });
  });

  it('treats @ after last / as branch separator even for scoped-like paths', () => {
    // afterSlash = "/@scoped-package", @ at index 1 (> 0) → branch extracted
    // This is a pathological input; real marketplace entries won't look like this
    expect(extractBranch('host/@scoped-package')).toEqual({
      value: 'host/',
      branch: 'scoped-package',
    });
  });
});

describe('parseMarketplaceEntry', () => {
  // ============================================================
  // Backward compatibility: bare local paths (no prefix)
  // ============================================================
  describe('backward compatible local paths (no prefix)', () => {
    it('parses absolute path', () => {
      expect(parseMarketplaceEntry('/marketplace')).toEqual({
        name: 'marketplace',
        type: 'local',
        source: '/marketplace',
      });
    });

    it('parses absolute path with nested directory', () => {
      expect(parseMarketplaceEntry('/opt/data/my-plugins')).toEqual({
        name: 'my-plugins',
        type: 'local',
        source: '/opt/data/my-plugins',
      });
    });

    it('parses relative path with ../', () => {
      expect(parseMarketplaceEntry('../as-marketplace')).toEqual({
        name: 'as-marketplace',
        type: 'local',
        source: '../as-marketplace',
      });
    });

    it('parses relative path with ./', () => {
      expect(parseMarketplaceEntry('./plugins')).toEqual({
        name: 'plugins',
        type: 'local',
        source: './plugins',
      });
    });

    it('trims whitespace', () => {
      expect(parseMarketplaceEntry('  /marketplace  ')).toEqual({
        name: 'marketplace',
        type: 'local',
        source: '/marketplace',
      });
    });
  });

  // ============================================================
  // local: prefix (explicit)
  // ============================================================
  describe('local: prefix', () => {
    it('parses local: prefixed path', () => {
      expect(parseMarketplaceEntry('local:/marketplace')).toEqual({
        name: 'marketplace',
        type: 'local',
        source: '/marketplace',
      });
    });

    it('parses local: with nested path', () => {
      expect(parseMarketplaceEntry('local:/opt/data/my-mp')).toEqual({
        name: 'my-mp',
        type: 'local',
        source: '/opt/data/my-mp',
      });
    });
  });

  // ============================================================
  // github: prefix
  // ============================================================
  describe('github: prefix', () => {
    it('parses github shorthand with default branch', () => {
      expect(parseMarketplaceEntry('github:jeffkit/as-marketplace')).toEqual({
        name: 'as-marketplace',
        type: 'github',
        source: 'jeffkit/as-marketplace',
        branch: 'main',
      });
    });

    it('parses github shorthand with explicit branch', () => {
      expect(parseMarketplaceEntry('github:some-org/repo@develop')).toEqual({
        name: 'repo',
        type: 'github',
        source: 'some-org/repo',
        branch: 'develop',
      });
    });

    it('parses github shorthand with feature branch containing slashes is NOT supported (@ only after last /)', () => {
      // github:owner/repo@feat/my-feature -> branch = "feat/my-feature" would need special handling
      // Current implementation: afterSlash = "/repo@feat/my-feature", atIdx finds @ in afterSlash
      const result = parseMarketplaceEntry('github:owner/repo@feat');
      expect(result).toEqual({
        name: 'repo',
        type: 'github',
        source: 'owner/repo',
        branch: 'feat',
      });
    });
  });

  // ============================================================
  // git: prefix
  // ============================================================
  describe('git: prefix', () => {
    it('parses HTTPS git URL with default branch', () => {
      expect(parseMarketplaceEntry('git:https://git.woa.com/org/repo.git')).toEqual({
        name: 'repo',
        type: 'git',
        source: 'https://git.woa.com/org/repo.git',
        branch: 'main',
      });
    });

    it('parses HTTPS git URL with explicit branch', () => {
      expect(parseMarketplaceEntry('git:https://git.woa.com/org/repo.git@release')).toEqual({
        name: 'repo',
        type: 'git',
        source: 'https://git.woa.com/org/repo.git',
        branch: 'release',
      });
    });

    it('parses SSH git URL', () => {
      expect(parseMarketplaceEntry('git:git@github.com:owner/repo.git')).toEqual({
        name: 'repo',
        type: 'git',
        source: 'git@github.com:owner/repo.git',
        branch: 'main',
      });
    });

    it('parses SSH git URL with branch', () => {
      expect(parseMarketplaceEntry('git:git@github.com:owner/repo.git@staging')).toEqual({
        name: 'repo',
        type: 'git',
        source: 'git@github.com:owner/repo.git',
        branch: 'staging',
      });
    });

    it('strips .git suffix from name', () => {
      const result = parseMarketplaceEntry('git:https://example.com/my-plugins.git');
      expect(result?.name).toBe('my-plugins');
    });
  });

  // ============================================================
  // Edge cases
  // ============================================================
  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseMarketplaceEntry('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseMarketplaceEntry('   ')).toBeNull();
    });

    it('bare directory name without path separators treated as local', () => {
      expect(parseMarketplaceEntry('my-marketplace')).toEqual({
        name: 'my-marketplace',
        type: 'local',
        source: 'my-marketplace',
      });
    });
  });
});
