/**
 * Rules types for both Claude Code and Cursor
 * 
 * Claude Code: .claude/rules/*.md
 * Cursor: .cursor/rules/*.mdc
 */

export interface RuleFrontmatter {
  // Common fields
  description?: string;
  
  // Cursor-specific fields
  globs?: string;  // File patterns this rule applies to
  alwaysApply?: boolean;  // Whether to always apply this rule
  
  // Claude Code-specific fields
  paths?: string[];  // Glob patterns for path-specific rules
  
  // Allow additional fields
  [key: string]: unknown;
}

export interface Rule {
  id: string;  // Unique identifier (scope:filename)
  name: string;  // Rule name (filename without extension)
  filename: string;  // Original filename
  path: string;  // Full file path
  scope: 'global' | 'project';  // global = user-level, project = project-level
  frontmatter: RuleFrontmatter;
  content: string;  // Rule content (markdown body)
  source?: 'local' | 'plugin';  // Source of the rule
  createdAt?: string;
  updatedAt?: string;
}

export interface RuleListItem {
  id: string;
  name: string;
  filename: string;
  scope: 'global' | 'project';
  description?: string;
  globs?: string;
  paths?: string[];
  alwaysApply?: boolean;
  source?: 'local' | 'plugin';
}

export interface RuleCreate {
  name: string;
  scope: 'global' | 'project';
  content: string;
  frontmatter?: RuleFrontmatter;
}

export interface RuleUpdate {
  content?: string;
  frontmatter?: RuleFrontmatter;
}

export interface RuleFilter {
  scope?: 'global' | 'project' | 'all';
  search?: string;
}
