/**
 * Rules API routes
 * 
 * Supports both Claude Code (.claude/rules/*.md) and Cursor (.cursor/rules/*.mdc)
 */

import express, { Router, Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { Rule, RuleListItem, RuleCreate, RuleUpdate, RuleFilter, RuleFrontmatter } from '../types/rules.js';
import { isCursorEngine, getEnginePaths } from '../config/engineConfig.js';
import { getSdkDirName } from '../config/sdkConfig.js';

const router: Router = Router();

// Get file extension based on engine
const getRuleExtension = (): string => {
  return isCursorEngine() ? '.mdc' : '.md';
};

// Get global rules directory
const getGlobalRulesDir = (): string => {
  if (isCursorEngine()) {
    return path.join(os.homedir(), '.cursor', 'rules');
  }
  return path.join(os.homedir(), '.claude', 'rules');
};

// Get project rules directory
const getProjectRulesDir = (projectPath?: string): string => {
  const sdkDirName = isCursorEngine() ? '.cursor' : getSdkDirName();
  if (projectPath) {
    return path.join(projectPath, sdkDirName, 'rules');
  }
  return path.join(process.cwd(), '..', sdkDirName, 'rules');
};

// Ensure directory exists
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists
  }
}

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Parse rule file content
function parseRuleContent(content: string): { frontmatter: RuleFrontmatter; body: string } {
  try {
    const parsed = matter(content);
    return {
      frontmatter: parsed.data as RuleFrontmatter,
      body: parsed.content.trim()
    };
  } catch {
    return {
      frontmatter: {},
      body: content
    };
  }
}

// Format rule content with frontmatter
function formatRuleContent(frontmatter: RuleFrontmatter, body: string): string {
  const hasFrontmatter = Object.keys(frontmatter).length > 0;
  
  if (!hasFrontmatter) {
    return body;
  }
  
  let content = '---\n';
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;
    
    if (Array.isArray(value)) {
      content += `${key}:\n`;
      for (const item of value) {
        content += `  - ${item}\n`;
      }
    } else if (typeof value === 'boolean') {
      content += `${key}: ${value}\n`;
    } else if (typeof value === 'string') {
      // Quote values with special characters
      const needsQuoting = /[[\]{}:>|*&!%@`#]/.test(value) || value.trim() !== value;
      content += `${key}: ${needsQuoting ? `"${value.replace(/"/g, '\\"')}"` : value}\n`;
    } else {
      content += `${key}: ${value}\n`;
    }
  }
  content += '---\n\n';
  content += body;
  
  return content;
}

// Scan rules in a directory
async function scanRules(dirPath: string, scope: 'global' | 'project'): Promise<Rule[]> {
  const rules: Rule[] = [];
  const extension = getRuleExtension();
  
  try {
    // Ensure directory exists
    await ensureDir(dirPath);
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Support both .md and .mdc files for compatibility
      if (!entry.isFile() || (!entry.name.endsWith('.md') && !entry.name.endsWith('.mdc'))) {
        continue;
      }
      
      const filePath = path.join(dirPath, entry.name);
      const name = entry.name.replace(/\.(md|mdc)$/, '');
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseRuleContent(content);
        const stats = await fs.stat(filePath);
        
        rules.push({
          id: `${scope}:${name}`,
          name,
          filename: entry.name,
          path: filePath,
          scope,
          frontmatter,
          content: body,
          source: 'local',
          createdAt: stats.birthtime.toISOString(),
          updatedAt: stats.mtime.toISOString(),
        });
      } catch (error) {
        console.error(`Error reading rule file ${filePath}:`, error);
      }
    }
    
    // Also scan subdirectories (Claude Code supports nested rules)
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dirPath, entry.name);
        const subRules = await scanRulesRecursive(subDirPath, scope, entry.name);
        rules.push(...subRules);
      }
    }
  } catch (error) {
    console.error(`Error scanning rules in ${dirPath}:`, error);
  }
  
  return rules;
}

// Recursively scan rules in subdirectories
async function scanRulesRecursive(dirPath: string, scope: 'global' | 'project', prefix: string): Promise<Rule[]> {
  const rules: Rule[] = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdc'))) {
        const filePath = path.join(dirPath, entry.name);
        const baseName = entry.name.replace(/\.(md|mdc)$/, '');
        const name = `${prefix}/${baseName}`;
        
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const { frontmatter, body } = parseRuleContent(content);
          const stats = await fs.stat(filePath);
          
          rules.push({
            id: `${scope}:${name}`,
            name,
            filename: entry.name,
            path: filePath,
            scope,
            frontmatter,
            content: body,
            source: 'local',
            createdAt: stats.birthtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
          });
        } catch (error) {
          console.error(`Error reading rule file ${filePath}:`, error);
        }
      } else if (entry.isDirectory()) {
        const subRules = await scanRulesRecursive(
          path.join(dirPath, entry.name),
          scope,
          `${prefix}/${entry.name}`
        );
        rules.push(...subRules);
      }
    }
  } catch (error) {
    console.error(`Error scanning rules recursively in ${dirPath}:`, error);
  }
  
  return rules;
}

// GET /api/rules - List all rules
router.get('/', async (req: Request, res: Response) => {
  try {
    const filter: RuleFilter = {
      scope: (req.query.scope as 'global' | 'project' | 'all') || 'all',
      search: req.query.search as string,
    };
    const projectPath = req.query.projectPath as string;
    
    let rules: Rule[] = [];
    
    // Scan global rules
    if (filter.scope === 'all' || filter.scope === 'global') {
      const globalRules = await scanRules(getGlobalRulesDir(), 'global');
      rules.push(...globalRules);
    }
    
    // Scan project rules
    if (filter.scope === 'all' || filter.scope === 'project') {
      const projectRules = await scanRules(getProjectRulesDir(projectPath), 'project');
      rules.push(...projectRules);
    }
    
    // Apply search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      rules = rules.filter(rule =>
        rule.name.toLowerCase().includes(searchLower) ||
        rule.content.toLowerCase().includes(searchLower) ||
        (rule.frontmatter.description?.toLowerCase().includes(searchLower))
      );
    }
    
    // Sort rules: global first, then alphabetically
    rules.sort((a, b) => {
      if (a.scope !== b.scope) {
        return a.scope === 'global' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    // Convert to list items
    const ruleItems: RuleListItem[] = rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      filename: rule.filename,
      scope: rule.scope,
      description: rule.frontmatter.description,
      globs: rule.frontmatter.globs,
      paths: rule.frontmatter.paths,
      alwaysApply: rule.frontmatter.alwaysApply,
      source: rule.source,
    }));
    
    res.json({
      rules: ruleItems,
      readOnly: isCursorEngine(),
      engine: isCursorEngine() ? 'cursor-cli' : 'claude-sdk',
    });
  } catch (error) {
    console.error('Error listing rules:', error);
    res.status(500).json({ error: 'Failed to list rules' });
  }
});

// GET /api/rules/:id - Get a single rule
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:name
    const [scope, ...nameParts] = id.split(':');
    const name = nameParts.join(':');
    
    if (!scope || !name || !['global', 'project'].includes(scope)) {
      res.status(400).json({ error: 'Invalid rule ID format. Expected: scope:name' });
      return;
    }
    
    const baseDir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir(projectPath);
    
    // Try both extensions
    const extensions = ['.md', '.mdc'];
    let filePath: string | null = null;
    let actualFilename: string | null = null;
    
    for (const ext of extensions) {
      const testPath = path.join(baseDir, `${name}${ext}`);
      if (await fileExists(testPath)) {
        filePath = testPath;
        actualFilename = `${name}${ext}`;
        break;
      }
    }
    
    if (!filePath) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    
    const content = await fs.readFile(filePath, 'utf-8');
    const { frontmatter, body } = parseRuleContent(content);
    const stats = await fs.stat(filePath);
    
    const rule: Rule = {
      id,
      name,
      filename: actualFilename!,
      path: filePath,
      scope: scope as 'global' | 'project',
      frontmatter,
      content: body,
      source: 'local',
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
    
    res.json({ rule });
  } catch (error) {
    console.error('Error getting rule:', error);
    res.status(500).json({ error: 'Failed to get rule' });
  }
});

// POST /api/rules - Create a new rule
router.post('/', async (req: Request, res: Response) => {
  try {
    // Check if in read-only mode (Cursor engine)
    if (isCursorEngine()) {
      res.status(403).json({
        error: 'Read-only mode',
        message: 'Rules are read-only when using Cursor CLI engine',
      });
      return;
    }
    
    const ruleData: RuleCreate = req.body;
    const projectPath = req.query.projectPath as string;
    
    if (!ruleData.name || !ruleData.content || !ruleData.scope) {
      res.status(400).json({ error: 'Missing required fields: name, content, scope' });
      return;
    }
    
    if (!['global', 'project'].includes(ruleData.scope)) {
      res.status(400).json({ error: 'Invalid scope. Must be "global" or "project"' });
      return;
    }
    
    const baseDir = ruleData.scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir(projectPath);
    await ensureDir(baseDir);
    
    const extension = getRuleExtension();
    const filename = `${ruleData.name}${extension}`;
    const filePath = path.join(baseDir, filename);
    
    // Check if rule already exists
    if (await fileExists(filePath)) {
      res.status(409).json({ error: 'Rule already exists' });
      return;
    }
    
    const frontmatter = ruleData.frontmatter || {};
    const content = formatRuleContent(frontmatter, ruleData.content);
    
    await fs.writeFile(filePath, content, 'utf-8');
    
    const stats = await fs.stat(filePath);
    const rule: Rule = {
      id: `${ruleData.scope}:${ruleData.name}`,
      name: ruleData.name,
      filename,
      path: filePath,
      scope: ruleData.scope,
      frontmatter,
      content: ruleData.content,
      source: 'local',
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
    
    res.status(201).json({ rule, message: 'Rule created successfully' });
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// PUT /api/rules/:id - Update a rule
router.put('/:id', async (req: Request, res: Response) => {
  try {
    // Check if in read-only mode (Cursor engine)
    if (isCursorEngine()) {
      res.status(403).json({
        error: 'Read-only mode',
        message: 'Rules are read-only when using Cursor CLI engine',
      });
      return;
    }
    
    const { id } = req.params;
    const updateData: RuleUpdate = req.body;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:name
    const [scope, ...nameParts] = id.split(':');
    const name = nameParts.join(':');
    
    if (!scope || !name || !['global', 'project'].includes(scope)) {
      res.status(400).json({ error: 'Invalid rule ID format. Expected: scope:name' });
      return;
    }
    
    const baseDir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir(projectPath);
    
    // Find the existing file
    const extensions = ['.md', '.mdc'];
    let filePath: string | null = null;
    let actualFilename: string | null = null;
    
    for (const ext of extensions) {
      const testPath = path.join(baseDir, `${name}${ext}`);
      if (await fileExists(testPath)) {
        filePath = testPath;
        actualFilename = `${name}${ext}`;
        break;
      }
    }
    
    if (!filePath) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    
    // Read existing content
    const existingContent = await fs.readFile(filePath, 'utf-8');
    const { frontmatter: existingFrontmatter, body: existingBody } = parseRuleContent(existingContent);
    
    // Merge updates
    const newFrontmatter = updateData.frontmatter 
      ? { ...existingFrontmatter, ...updateData.frontmatter }
      : existingFrontmatter;
    const newBody = updateData.content ?? existingBody;
    
    const content = formatRuleContent(newFrontmatter, newBody);
    await fs.writeFile(filePath, content, 'utf-8');
    
    const stats = await fs.stat(filePath);
    const rule: Rule = {
      id,
      name,
      filename: actualFilename!,
      path: filePath,
      scope: scope as 'global' | 'project',
      frontmatter: newFrontmatter,
      content: newBody,
      source: 'local',
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
    
    res.json({ rule, message: 'Rule updated successfully' });
  } catch (error) {
    console.error('Error updating rule:', error);
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// DELETE /api/rules/:id - Delete a rule
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // Check if in read-only mode (Cursor engine)
    if (isCursorEngine()) {
      res.status(403).json({
        error: 'Read-only mode',
        message: 'Rules are read-only when using Cursor CLI engine',
      });
      return;
    }
    
    const { id } = req.params;
    const projectPath = req.query.projectPath as string;
    
    // Parse id format: scope:name
    const [scope, ...nameParts] = id.split(':');
    const name = nameParts.join(':');
    
    if (!scope || !name || !['global', 'project'].includes(scope)) {
      res.status(400).json({ error: 'Invalid rule ID format. Expected: scope:name' });
      return;
    }
    
    const baseDir = scope === 'global' ? getGlobalRulesDir() : getProjectRulesDir(projectPath);
    
    // Find and delete the file
    const extensions = ['.md', '.mdc'];
    let deleted = false;
    
    for (const ext of extensions) {
      const filePath = path.join(baseDir, `${name}${ext}`);
      if (await fileExists(filePath)) {
        await fs.unlink(filePath);
        deleted = true;
        break;
      }
    }
    
    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    
    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

export default router;
