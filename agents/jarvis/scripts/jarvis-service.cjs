#!/usr/bin/env node

/**
 * Jarvis Service Script v2.0
 * 
 * Manages todos, journals, and memory for Jarvis agent.
 * Uses JSONL format for todos, Markdown files for journals and memory.
 * 
 * Usage:
 *   node jarvis-service.cjs list
 *   node jarvis-service.cjs add < input.json
 *   node jarvis-service.cjs update < input.json
 *   node jarvis-service.cjs delete < input.json
 *   node jarvis-service.cjs archive < input.json
 *   node jarvis-service.cjs stats
 *   node jarvis-service.cjs check < input.json
 *   node jarvis-service.cjs journals
 *   node jarvis-service.cjs journal-get < input.json
 *   node jarvis-service.cjs journal-save < input.json
 *   node jarvis-service.cjs memory-list < input.json
 *   node jarvis-service.cjs memory-get < input.json
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Data Paths
// ============================================================================

function getDataDir() {
  const projectPath = process.env.LAVS_PROJECT_PATH;
  if (projectPath) {
    return path.join(projectPath, 'data');
  }
  return path.join(__dirname, '../data');
}

function getActiveFile() {
  return path.join(getDataDir(), 'todos-active.jsonl');
}

function getArchivedFile() {
  return path.join(getDataDir(), 'todos-archived.jsonl');
}

function getJournalDir() {
  const projectPath = process.env.LAVS_PROJECT_PATH;
  if (projectPath) {
    return path.join(projectPath, 'journal');
  }
  return path.join(__dirname, '../journal');
}

function getMemoryDir() {
  const projectPath = process.env.LAVS_PROJECT_PATH;
  if (projectPath) {
    return path.join(projectPath, 'memory');
  }
  return path.join(__dirname, '../memory');
}

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.error(`[Jarvis] Created data directory: ${dataDir}`);
  }
}

console.error(`[Jarvis] LAVS_PROJECT_PATH: ${process.env.LAVS_PROJECT_PATH || '(not set)'}`);
console.error(`[Jarvis] Data directory: ${getDataDir()}`);

// ============================================================================
// Todo Management
// ============================================================================

function loadTodos(filePath) {
  const todos = [];
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        todos.push(JSON.parse(line));
      } catch (e) {
        console.error(`[Jarvis] Error parsing line: ${line}`);
      }
    }
  }
  return todos;
}

function saveTodos(filePath, todos) {
  ensureDataDir();
  const content = todos.map(t => JSON.stringify(t)).join('\n') + (todos.length > 0 ? '\n' : '');
  fs.writeFileSync(filePath, content, 'utf-8');
}

function appendTodo(filePath, todo) {
  ensureDataDir();
  fs.appendFileSync(filePath, JSON.stringify(todo) + '\n', 'utf-8');
}

function generateTodoId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const todos = loadTodos(getActiveFile());
  const archived = loadTodos(getArchivedFile());
  
  const todayPrefix = date + '-';
  let maxSeq = 0;
  
  for (const todo of [...todos, ...archived]) {
    if (todo.id && todo.id.startsWith(todayPrefix)) {
      const seq = parseInt(todo.id.slice(-4), 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  
  return `${date}-${String(maxSeq + 1).padStart(4, '0')}`;
}

// ============================================================================
// Journal Management
// ============================================================================

function getJournalPath(date) {
  const year = date.slice(0, 4);
  const month = parseInt(date.slice(5, 7), 10);
  const monthNames = ['01-January', '02-February', '03-March', '04-April', '05-May', '06-June',
                      '07-July', '08-August', '09-September', '10-October', '11-November', '12-December'];
  const monthDir = monthNames[month - 1] || `${String(month).padStart(2, '0')}-Unknown`;
  
  return path.join(getJournalDir(), year, monthDir, `${date}.md`);
}

function ensureJournalDir(date) {
  const journalPath = getJournalPath(date);
  const journalDir = path.dirname(journalPath);
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }
}

// ============================================================================
// Stdin Reader
// ============================================================================

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    
    process.stdin.on('end', () => {
      try {
        if (!data.trim()) {
          resolve({});
        } else {
          resolve(JSON.parse(data));
        }
      } catch (error) {
        reject(new Error(`Invalid JSON input: ${error.message}`));
      }
    });
    
    process.stdin.on('error', reject);
  });
}

// ============================================================================
// Actions
// ============================================================================

async function listTodos(input) {
  const todos = loadTodos(getActiveFile());
  let filtered = todos;
  
  if (input.status && input.status !== 'all') {
    if (input.status === 'active') {
      filtered = filtered.filter(t => t.status === 'pending' || t.status === 'in_progress');
    } else {
      filtered = filtered.filter(t => t.status === input.status);
    }
  }
  if (input.type) {
    filtered = filtered.filter(t => t.type === input.type);
  }
  if (input.priority) {
    filtered = filtered.filter(t => t.priority === input.priority);
  }
  
  console.log(JSON.stringify(filtered, null, 2));
}

async function addTodo(input) {
  if (!input.title) {
    throw new Error('Missing required field: title');
  }
  
  const now = new Date().toISOString();
  const todo = {
    id: generateTodoId(),
    title: input.title,
    description: input.description || '',
    type: input.type || 'personal',
    status: 'pending',
    priority: input.priority || 'medium',
    createdAt: now,
    updatedAt: now,
    tags: input.tags || [],
  };
  
  if (input.deadline) todo.deadline = input.deadline;
  if (input.scheduledTime) todo.scheduledTime = input.scheduledTime;
  
  appendTodo(getActiveFile(), todo);
  console.log(JSON.stringify(todo, null, 2));
}

async function updateTodo(input) {
  if (!input.id) {
    throw new Error('Missing required field: id');
  }
  
  const todos = loadTodos(getActiveFile());
  let updated = false;
  
  for (const todo of todos) {
    if (todo.id === input.id) {
      const updates = input.updates || input;
      
      const allowedFields = ['title', 'description', 'status', 'priority', 'deadline', 
                             'scheduledTime', 'assignedAgent', 'agentProject', 'executionStrategy',
                             'tags', 'notes', 'draft'];
      
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          todo[field] = updates[field];
        }
      }
      
      todo.updatedAt = new Date().toISOString();
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    throw new Error(`Todo not found: ${input.id}`);
  }
  
  saveTodos(getActiveFile(), todos);
  
  const updatedTodo = todos.find(t => t.id === input.id);
  console.log(JSON.stringify(updatedTodo, null, 2));
}

async function deleteTodo(input) {
  if (!input.id) {
    throw new Error('Missing required field: id');
  }
  
  const todos = loadTodos(getActiveFile());
  const index = todos.findIndex(t => t.id === input.id);
  
  if (index === -1) {
    throw new Error(`Todo not found: ${input.id}`);
  }
  
  todos.splice(index, 1);
  saveTodos(getActiveFile(), todos);
  
  console.log(JSON.stringify({ success: true, id: input.id }, null, 2));
}

async function archiveTodo(input) {
  if (!input.id) {
    throw new Error('Missing required field: id');
  }
  
  const todos = loadTodos(getActiveFile());
  const index = todos.findIndex(t => t.id === input.id);
  
  if (index === -1) {
    throw new Error(`Todo not found: ${input.id}`);
  }
  
  const todo = todos[index];
  todo.archivedAt = new Date().toISOString();
  
  todos.splice(index, 1);
  saveTodos(getActiveFile(), todos);
  
  appendTodo(getArchivedFile(), todo);
  
  console.log(JSON.stringify(todo, null, 2));
}

async function getStats() {
  const todos = loadTodos(getActiveFile());
  const archived = loadTodos(getArchivedFile());
  const now = new Date();
  
  const overdue = todos.filter(t => {
    if (!t.deadline || t.status === 'completed' || t.status === 'cancelled') return false;
    return new Date(t.deadline) < now;
  });
  
  const stats = {
    total: todos.length,
    draft: todos.filter(t => t.status === 'draft').length,
    pending: todos.filter(t => t.status === 'pending').length,
    in_progress: todos.filter(t => t.status === 'in_progress').length,
    waiting_confirmation: todos.filter(t => t.status === 'waiting_confirmation').length,
    completed: archived.filter(t => t.status === 'completed').length,
    cancelled: archived.filter(t => t.status === 'cancelled').length,
    high_priority: todos.filter(t => t.priority === 'high').length,
    personal: todos.filter(t => t.type === 'personal').length,
    delegated: todos.filter(t => t.type === 'delegated').length,
    mixed: todos.filter(t => t.type === 'mixed').length,
    overdue: overdue.length,
    archived_total: archived.length,
  };
  
  console.log(JSON.stringify(stats, null, 2));
}

async function checkDue(input) {
  const minutes = input.minutes || 15;
  const now = new Date();
  const threshold = new Date(now.getTime() + minutes * 60 * 1000);
  
  const todos = loadTodos(getActiveFile());
  
  const results = {
    overdue: [],
    dueSoon: [],
  };
  
  for (const todo of todos) {
    if (!todo.deadline || todo.status === 'completed' || todo.status === 'cancelled') {
      continue;
    }
    
    const deadline = new Date(todo.deadline);
    
    if (deadline < now) {
      results.overdue.push({
        ...todo,
        overdueBy: Math.round((now - deadline) / (1000 * 60)) + ' minutes',
      });
    } else if (deadline <= threshold) {
      results.dueSoon.push({
        ...todo,
        dueIn: Math.round((deadline - now) / (1000 * 60)) + ' minutes',
      });
    }
  }
  
  results.overdue.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  results.dueSoon.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  
  console.log(JSON.stringify(results, null, 2));
}

async function listJournals(input) {
  const journalDir = getJournalDir();
  const journals = [];
  
  if (!fs.existsSync(journalDir)) {
    console.log(JSON.stringify(journals, null, 2));
    return;
  }
  
  function findFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFiles(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const date = entry.name.replace('.md', '');
        const content = fs.readFileSync(fullPath, 'utf-8');
        const stat = fs.statSync(fullPath);
        journals.push({
          date,
          path: fullPath,
          preview: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
          size: stat.size,
        });
      }
    }
  }
  
  findFiles(journalDir);
  
  journals.sort((a, b) => b.date.localeCompare(a.date));
  
  const limit = input.limit || 30;
  const limited = journals.slice(0, limit);
  
  console.log(JSON.stringify(limited, null, 2));
}

async function getJournal(input) {
  if (!input.date) {
    throw new Error('Missing required field: date');
  }
  
  const journalPath = getJournalPath(input.date);
  
  if (!fs.existsSync(journalPath)) {
    console.log(JSON.stringify({ date: input.date, content: '', exists: false }, null, 2));
    return;
  }
  
  const content = fs.readFileSync(journalPath, 'utf-8');
  console.log(JSON.stringify({ date: input.date, content, exists: true }, null, 2));
}

async function saveJournal(input) {
  if (!input.date || !input.content) {
    throw new Error('Missing required fields: date, content');
  }
  
  ensureJournalDir(input.date);
  const journalPath = getJournalPath(input.date);
  
  let content = input.content;
  
  if (input.append && fs.existsSync(journalPath)) {
    const existing = fs.readFileSync(journalPath, 'utf-8');
    content = existing + '\n\n' + content;
  }
  
  fs.writeFileSync(journalPath, content, 'utf-8');
  
  console.log(JSON.stringify({ date: input.date, saved: true, path: journalPath }, null, 2));
}

// ============================================================================
// Memory Management
// ============================================================================

async function listMemory(input) {
  const memoryDir = getMemoryDir();
  const items = [];
  
  if (!fs.existsSync(memoryDir)) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  
  const categories = input.category 
    ? [input.category]
    : fs.readdirSync(memoryDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
  
  for (const category of categories) {
    const catDir = path.join(memoryDir, category);
    if (!fs.existsSync(catDir)) continue;
    
    function findMemFiles(dir, relPath) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const currentRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          findMemFiles(fullPath, currentRelPath);
        } else if (entry.name.endsWith('.md')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const stat = fs.statSync(fullPath);
            items.push({
              category,
              filename: currentRelPath,
              preview: content.slice(0, 150) + (content.length > 150 ? '...' : ''),
              size: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          } catch (e) {
            console.error(`[Jarvis] Error reading memory file: ${fullPath}`);
          }
        }
      }
    }
    
    findMemFiles(catDir, '');
  }
  
  // Sort by updatedAt descending
  items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  console.log(JSON.stringify(items, null, 2));
}

async function getMemory(input) {
  if (!input.category || !input.filename) {
    throw new Error('Missing required fields: category, filename');
  }
  
  const memoryDir = getMemoryDir();
  const filePath = path.join(memoryDir, input.category, input.filename);
  
  // Security check: ensure path doesn't escape memory dir
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(memoryDir))) {
    throw new Error('Invalid path: outside memory directory');
  }
  
  if (!fs.existsSync(filePath)) {
    console.log(JSON.stringify({ 
      category: input.category, 
      filename: input.filename, 
      content: '', 
      exists: false 
    }, null, 2));
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  console.log(JSON.stringify({ 
    category: input.category, 
    filename: input.filename, 
    content, 
    exists: true 
  }, null, 2));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const action = process.argv[2];
  
  if (!action) {
    console.error('Error: No action specified');
    console.error('Usage: node jarvis-service.cjs <action>');
    console.error('Actions: list, add, update, delete, archive, stats, check, journals, journal-get, journal-save, memory-list, memory-get');
    process.exit(1);
  }
  
  try {
    const input = await readStdin();
    
    switch (action) {
      case 'list':
        await listTodos(input);
        break;
      case 'add':
        await addTodo(input);
        break;
      case 'update':
        await updateTodo(input);
        break;
      case 'delete':
        await deleteTodo(input);
        break;
      case 'archive':
        await archiveTodo(input);
        break;
      case 'stats':
        await getStats();
        break;
      case 'check':
        await checkDue(input);
        break;
      case 'journals':
        await listJournals(input);
        break;
      case 'journal-get':
        await getJournal(input);
        break;
      case 'journal-save':
        await saveJournal(input);
        break;
      case 'memory-list':
        await listMemory(input);
        break;
      case 'memory-get':
        await getMemory(input);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
