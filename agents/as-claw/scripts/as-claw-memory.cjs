#!/usr/bin/env node
/**
 * AS-Claw Memory Service
 *
 * Provides memory_get / memory_search / memory_write operations over
 * ~/.as-claw/workspace/ — the agent's personal Markdown-based memory store.
 *
 * This is the LAVS backend for AS-Claw's dedicated memory tools, inspired
 * by OpenClaw's memory_get and memory_search tool design.
 *
 * Commands:
 *   node as-claw-memory.cjs memory-get       < { file, startLine?, endLine? }
 *   node as-claw-memory.cjs memory-search    < { query, context?, scope?, maxResults? }
 *   node as-claw-memory.cjs memory-write     < { file, content, append? }
 *   node as-claw-memory.cjs memory-today     < {}
 *   node as-claw-memory.cjs list-files       < { limit? }
 *   node as-claw-memory.cjs workspace-overview < {}
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync, spawnSync } = require('child_process');

// ============================================================================
// Workspace Path
// ============================================================================

function getWorkspacePath() {
  return path.join(os.homedir(), '.as-claw', 'workspace');
}

function resolvePath(file) {
  const workspace = getWorkspacePath();
  const resolved  = path.resolve(workspace, file);
  // Safety: prevent path traversal outside workspace
  if (!resolved.startsWith(workspace)) {
    throw new Error(`Path traversal denied: ${file}`);
  }
  return resolved;
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// I/O Helpers
// ============================================================================

function readInput() {
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function output(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

function err(msg) {
  process.stderr.write('[as-claw-memory] ' + msg + '\n');
}

// ============================================================================
// memory-get
// ============================================================================

function cmdMemoryGet(input) {
  const { file, startLine, endLine } = input;
  if (!file) return output({ file: '', content: '', exists: false, lines: 0, size: 0 });

  try {
    const fullPath = resolvePath(file);
    if (!fs.existsSync(fullPath)) {
      return output({ file, content: '', exists: false, lines: 0, size: 0 });
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    const allLines = content.split('\n');
    const totalLines = allLines.length;
    const size = Buffer.byteLength(content, 'utf-8');

    if (startLine || endLine) {
      const start = Math.max(1, startLine || 1) - 1;
      const end   = endLine ? Math.min(endLine, totalLines) : totalLines;
      content = allLines.slice(start, end).join('\n');
    }

    output({ file, content, exists: true, lines: totalLines, size });
  } catch (e) {
    err('memory-get error: ' + e.message);
    output({ file, content: '', exists: false, lines: 0, size: 0, error: e.message });
  }
}

// ============================================================================
// memory-search (ripgrep-backed)
// ============================================================================

function resolveSearchPaths(scope, workspace) {
  const memoryDir = path.join(workspace, 'memory');
  const memoryMd  = path.join(workspace, 'MEMORY.md');

  switch (scope) {
    case 'memory_md':
      return fs.existsSync(memoryMd) ? [memoryMd] : [];

    case 'daily':
      return fs.existsSync(memoryDir) ? [memoryDir] : [];

    case 'recent_7': {
      const files = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const p = path.join(memoryDir, `${dateStr}.md`);
        if (fs.existsSync(p)) files.push(p);
      }
      if (fs.existsSync(memoryMd)) files.push(memoryMd);
      return files;
    }

    case 'recent_30': {
      const files = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const p = path.join(memoryDir, `${dateStr}.md`);
        if (fs.existsSync(p)) files.push(p);
      }
      if (fs.existsSync(memoryMd)) files.push(memoryMd);
      return files;
    }

    case 'all':
    default: {
      const paths = [];
      if (fs.existsSync(memoryMd)) paths.push(memoryMd);
      if (fs.existsSync(memoryDir)) paths.push(memoryDir);
      // Also include USER.md for entity queries
      const userMd = path.join(workspace, 'USER.md');
      if (fs.existsSync(userMd)) paths.push(userMd);
      return paths;
    }
  }
}

function hasRipgrep() {
  try {
    execSync('which rg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function searchWithRipgrep(query, searchPaths, contextLines, maxResults) {
  if (searchPaths.length === 0) return [];

  const args = [
    '--json',
    '-C', String(contextLines),
    '--max-count', String(maxResults),
    '--type', 'md',
    query,
    ...searchPaths,
  ];

  const result = spawnSync('rg', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

  if (result.status !== 0 && result.status !== 1) {
    err('ripgrep error: ' + (result.stderr || ''));
    return [];
  }

  const workspace = getWorkspacePath();
  const matches = [];
  const lines = (result.stdout || '').split('\n').filter(Boolean);

  // ripgrep --json outputs one JSON object per line
  const matchLines = [];
  const contextBefore = new Map();
  const contextAfter  = new Map();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        matchLines.push(obj.data);
      } else if (obj.type === 'context') {
        // context lines collected but we'll use submatches context
      }
    } catch {}
  }

  for (const m of matchLines.slice(0, maxResults)) {
    const filePath = m.path?.text || '';
    const relFile  = path.relative(workspace, filePath) || filePath;
    const lineNum  = m.line_number || 0;
    const text     = m.lines?.text?.trimEnd() || '';

    matches.push({
      file: relFile,
      line: lineNum,
      content: text,
      contextBefore: [],
      contextAfter:  [],
    });
  }

  return matches;
}

function searchWithGrep(query, searchPaths, contextLines, maxResults) {
  if (searchPaths.length === 0) return [];

  const workspace = getWorkspacePath();
  const args = [
    '-r', '-n', `-C${contextLines}`,
    '--include=*.md',
    query,
    ...searchPaths,
  ];

  const result = spawnSync('grep', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0 && result.status !== 1) return [];

  const matches = [];
  const lines = (result.stdout || '').split('\n');

  for (const line of lines) {
    const m = line.match(/^(.+?):(\d+):(.*)$/);
    if (m) {
      const relFile = path.relative(workspace, m[1]) || m[1];
      matches.push({
        file: relFile,
        line: parseInt(m[2], 10),
        content: m[3],
        contextBefore: [],
        contextAfter:  [],
      });
      if (matches.length >= maxResults) break;
    }
  }

  return matches;
}

function cmdMemorySearch(input) {
  const {
    query,
    context    = 2,
    scope      = 'all',
    maxResults = 20,
  } = input;

  if (!query) return output({ results: [], total: 0, query: '', scope });

  const workspace   = getWorkspacePath();
  const searchPaths = resolveSearchPaths(scope, workspace);

  if (searchPaths.length === 0) {
    return output({ results: [], total: 0, query, scope, note: 'Workspace not initialized' });
  }

  try {
    const results = hasRipgrep()
      ? searchWithRipgrep(query, searchPaths, context, maxResults)
      : searchWithGrep(query, searchPaths, context, maxResults);

    output({ results, total: results.length, query, scope });
  } catch (e) {
    err('memory-search error: ' + e.message);
    output({ results: [], total: 0, query, scope, error: e.message });
  }
}

// ============================================================================
// memory-write
// ============================================================================

function cmdMemoryWrite(input) {
  const { file, content, append = false } = input;
  if (!file || content === undefined) {
    return output({ file: file || '', saved: false, size: 0, lines: 0, error: 'Missing file or content' });
  }

  try {
    const fullPath = resolvePath(file);
    ensureDir(fullPath);

    if (append && fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf-8');
      const separator = existing.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(fullPath, existing + separator + content, 'utf-8');
    } else {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }

    const written = fs.readFileSync(fullPath, 'utf-8');
    const size    = Buffer.byteLength(written, 'utf-8');
    const lines   = written.split('\n').length;

    output({ file, saved: true, size, lines });
  } catch (e) {
    err('memory-write error: ' + e.message);
    output({ file, saved: false, size: 0, lines: 0, error: e.message });
  }
}

// ============================================================================
// memory-today
// ============================================================================

function cmdMemoryToday() {
  const date      = today();
  const file      = `memory/${date}.md`;
  const workspace = getWorkspacePath();
  const fullPath  = path.join(workspace, 'memory', `${date}.md`);
  const exists    = fs.existsSync(fullPath);
  const content   = exists ? fs.readFileSync(fullPath, 'utf-8') : '';

  output({ date, file, content, exists });
}

// ============================================================================
// list-files
// ============================================================================

function cmdListFiles(input) {
  const limit     = input.limit || 30;
  const workspace = getWorkspacePath();
  const files     = [];

  // 1. Core memory files
  const coreFiles = ['MEMORY.md', 'USER.md', 'SOUL.md', 'AGENTS.md', 'IDENTITY.md'];
  for (const cf of coreFiles) {
    const fullPath = path.join(workspace, cf);
    if (fs.existsSync(fullPath)) {
      const content  = fs.readFileSync(fullPath, 'utf-8');
      const lines    = content.split('\n').length;
      const size     = Buffer.byteLength(content, 'utf-8');
      const preview  = content.split('\n').slice(0, 3).join(' ').replace(/^#+\s*/, '').slice(0, 120);
      files.push({ file: cf, type: 'core', date: null, size, lines, preview, isToday: false });
    }
  }

  // 2. Daily logs (newest first)
  const memoryDir = path.join(workspace, 'memory');
  const todayDate = today();

  if (fs.existsSync(memoryDir)) {
    const dailyFiles = fs.readdirSync(memoryDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, limit);

    for (const f of dailyFiles) {
      const fullPath = path.join(memoryDir, f);
      const content  = fs.readFileSync(fullPath, 'utf-8');
      const lines    = content.split('\n').length;
      const size     = Buffer.byteLength(content, 'utf-8');
      const preview  = content.split('\n').filter(l => l.trim()).slice(1, 4).join(' ').slice(0, 120);
      const dateStr  = f.replace('.md', '');
      files.push({
        file:    `memory/${f}`,
        type:    'daily',
        date:    dateStr,
        size, lines, preview,
        isToday: dateStr === todayDate,
      });
    }
  }

  output(files);
}

// ============================================================================
// workspace-overview
// ============================================================================

function cmdWorkspaceOverview() {
  const workspace      = getWorkspacePath();
  const workspaceExists = fs.existsSync(workspace);
  const todayDate      = today();

  if (!workspaceExists) {
    return output({
      workspaceExists: false,
      workspacePath: workspace,
      user: { name: null, exists: false },
      stats: { memoryMdLines: 0, dailyLogCount: 0, todayExists: false, todayDate },
    });
  }

  // Parse user name from USER.md
  let userName = null;
  const userMdPath = path.join(workspace, 'USER.md');
  if (fs.existsSync(userMdPath)) {
    const userContent = fs.readFileSync(userMdPath, 'utf-8');
    const nameMatch   = userContent.match(/姓名[：:]\s*(.+)/);
    if (nameMatch) userName = nameMatch[1].trim().replace(/[[\]]/g, '');
  }

  // Memory.md stats
  const memoryMdPath  = path.join(workspace, 'MEMORY.md');
  const memoryMdLines = fs.existsSync(memoryMdPath)
    ? fs.readFileSync(memoryMdPath, 'utf-8').split('\n').length
    : 0;

  // Daily log stats
  const memoryDir   = path.join(workspace, 'memory');
  let dailyLogCount = 0;
  let todayExists   = false;
  if (fs.existsSync(memoryDir)) {
    const files = fs.readdirSync(memoryDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    dailyLogCount = files.length;
    todayExists   = files.includes(`${todayDate}.md`);
  }

  output({
    workspaceExists: true,
    workspacePath: workspace,
    user: { name: userName, exists: fs.existsSync(userMdPath) },
    stats: { memoryMdLines, dailyLogCount, todayExists, todayDate },
  });
}

// ============================================================================
// Main
// ============================================================================

const command = process.argv[2];
const input   = readInput();

err(`Command: ${command}, Input keys: ${Object.keys(input).join(', ')}`);

switch (command) {
  case 'memory-get':        cmdMemoryGet(input);        break;
  case 'memory-search':     cmdMemorySearch(input);     break;
  case 'memory-write':      cmdMemoryWrite(input);      break;
  case 'memory-today':      cmdMemoryToday();           break;
  case 'list-files':        cmdListFiles(input);        break;
  case 'workspace-overview': cmdWorkspaceOverview();    break;
  default:
    err(`Unknown command: ${command}`);
    output({ error: `Unknown command: ${command}` });
    process.exit(1);
}
