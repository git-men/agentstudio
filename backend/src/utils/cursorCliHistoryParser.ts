/**
 * Cursor CLI Agent History Parser
 * 
 * Parses Cursor CLI agent sessions from ~/.cursor/chats/<workspace-hash>/<session-uuid>/store.db
 * CLI sessions are stored in SQLite databases with blobs containing JSON messages.
 * 
 * Note: IDE Agent sessions are stored separately in ~/.cursor/projects/<path>/agent-transcripts/*.txt
 * and are handled by cursorIdeAgentParser.ts (formerly cursorHistoryParser.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

// Types for CLI session parsing
export interface CursorCliMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  messageParts: CursorCliMessagePart[];
}

export interface CursorCliMessagePart {
  id: string;
  type: 'text' | 'thinking' | 'tool';
  content?: string;
  order: number;
  toolData?: {
    id: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResult?: string;
    isError?: boolean;
  };
}

export interface CursorCliSession {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  messages: CursorCliMessage[];
  mode?: string;
}

interface SessionMeta {
  agentId: string;
  latestRootBlobId: string;
  name: string;
  mode: string;
  createdAt: number;
}

interface MessageContent {
  type: string;
  text?: string;
}

interface ParsedMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContent[];
  providerOptions?: unknown;
}

/**
 * Generate workspace hash from project path (MD5)
 */
function getWorkspaceHash(projectPath: string): string {
  // Resolve symlinks first
  let resolvedPath = projectPath;
  try {
    resolvedPath = fs.realpathSync(projectPath);
  } catch {
    // If path doesn't exist, use original
  }
  
  return crypto.createHash('md5').update(resolvedPath).digest('hex');
}

/**
 * Get the Cursor chats directory
 */
function getCursorChatsDir(): string {
  return path.join(os.homedir(), '.cursor', 'chats');
}

/**
 * Extract text content from message content array or string
 */
function extractTextContent(content: string | MessageContent[]): string {
  if (typeof content === 'string') {
    return content;
  }
  
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n');
  }
  
  return '';
}

/**
 * Clean up user query by removing XML tags and extracting the actual query
 */
function cleanUserQuery(text: string): string {
  // Extract content from <user_query> tags if present
  const userQueryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  if (userQueryMatch) {
    return userQueryMatch[1].trim();
  }
  
  // If text starts with system info tags, skip it
  if (text.startsWith('<user_info>') || text.startsWith('<rules>')) {
    return '';
  }
  
  return text;
}

/**
 * Extract a clean title from user message, skipping system info
 */
function extractSessionTitle(messages: CursorCliMessage[], sessionId: string, metaName?: string): string {
  // Find the first user message with actual content
  for (const msg of messages) {
    if (msg.role === 'user' && msg.content) {
      // Skip if it's system info
      if (msg.content.startsWith('<user_info>') || 
          msg.content.startsWith('<rules>') ||
          msg.content.includes('<user_info>')) {
        continue;
      }
      
      // Use the first 50 characters as title
      let title = msg.content.substring(0, 50);
      if (msg.content.length > 50) {
        title += '...';
      }
      return title;
    }
  }
  
  // Fallback to meta name or session ID
  return metaName || `Session ${sessionId.substring(0, 8)}`;
}

/**
 * Parse blob data to extract JSON messages
 */
function parseBlobData(data: Buffer): ParsedMessage | null {
  try {
    // Convert buffer to string and try to find JSON
    const dataStr = data.toString('utf-8');
    
    // Try to find JSON objects in the data
    // Look for patterns like {"role":... or {"id":...
    const jsonMatches = dataStr.match(/\{[^{}]*"role"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
    
    if (jsonMatches) {
      for (const match of jsonMatches) {
        try {
          const parsed = JSON.parse(match);
          if (parsed.role && (parsed.role === 'user' || parsed.role === 'assistant' || parsed.role === 'system')) {
            return parsed as ParsedMessage;
          }
        } catch {
          // Try next match
        }
      }
    }
    
    // Try parsing the entire buffer as JSON
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.role) {
        return parsed as ParsedMessage;
      }
    } catch {
      // Not valid JSON
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a single CLI session from SQLite database
 */
function parseCliSession(sessionDir: string, sessionId: string): CursorCliSession | null {
  const dbPath = path.join(sessionDir, 'store.db');
  
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  
  try {
    const db = new Database(dbPath, { readonly: true });
    
    // Get meta information
    const metaRow = db.prepare('SELECT value FROM meta WHERE key = 0').get() as { value: string } | undefined;
    
    if (!metaRow) {
      db.close();
      return null;
    }
    
    // Decode hex-encoded meta value
    const metaHex = metaRow.value;
    const metaJson = Buffer.from(metaHex, 'hex').toString('utf-8');
    const meta: SessionMeta = JSON.parse(metaJson);
    
    // Get all blobs
    const blobs = db.prepare('SELECT id, data FROM blobs').all() as { id: string; data: Buffer }[];
    
    db.close();
    
    // Parse messages from blobs
    const messages: CursorCliMessage[] = [];
    let messageIndex = 0;
    
    for (const blob of blobs) {
      const parsed = parseBlobData(blob.data);
      
      if (parsed && (parsed.role === 'user' || parsed.role === 'assistant')) {
        const textContent = extractTextContent(parsed.content);
        
        // Skip empty content
        if (!textContent) {
          continue;
        }
        
        // Clean up user queries
        const cleanedContent = parsed.role === 'user' ? cleanUserQuery(textContent) : textContent;
        
        // Skip if content is too short or looks like metadata
        if (cleanedContent.length < 2) {
          continue;
        }
        
        messages.push({
          id: parsed.id || `msg_${sessionId}_${messageIndex}`,
          role: parsed.role,
          content: cleanedContent,
          timestamp: meta.createdAt + (messageIndex * 1000),
          messageParts: [{
            id: `part_${messageIndex}_0`,
            type: 'text',
            content: cleanedContent,
            order: 0
          }]
        });
        
        messageIndex++;
      }
    }
    
    if (messages.length === 0) {
      return null;
    }
    
    // Generate title from first meaningful user message (skip system info)
    const title = extractSessionTitle(messages, sessionId, meta.name);
    
    // Get directory stats for timestamps
    const stats = fs.statSync(sessionDir);
    
    return {
      id: sessionId,
      title,
      createdAt: new Date(meta.createdAt).toISOString(),
      lastUpdated: stats.mtime.toISOString(),
      messages,
      mode: meta.mode
    };
    
  } catch (error) {
    console.error(`Failed to parse CLI session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Read all Cursor CLI sessions for a project
 */
export function readCursorCliSessions(projectPath: string): CursorCliSession[] {
  try {
    const workspaceHash = getWorkspaceHash(projectPath);
    const chatsDir = path.join(getCursorChatsDir(), workspaceHash);
    
    console.log(`📂 [CURSOR CLI] Reading sessions from: ${chatsDir}`);
    console.log(`📂 [CURSOR CLI] Workspace hash: ${workspaceHash} (from ${projectPath})`);
    
    if (!fs.existsSync(chatsDir)) {
      console.log(`❌ [CURSOR CLI] Chats directory not found: ${chatsDir}`);
      return [];
    }
    
    const sessionDirs = fs.readdirSync(chatsDir)
      .filter(name => {
        const fullPath = path.join(chatsDir, name);
        return fs.statSync(fullPath).isDirectory() && !name.startsWith('.');
      });
    
    console.log(`📋 [CURSOR CLI] Found ${sessionDirs.length} session directories`);
    
    const sessions: CursorCliSession[] = [];
    
    for (const sessionId of sessionDirs) {
      const sessionDir = path.join(chatsDir, sessionId);
      const session = parseCliSession(sessionDir, sessionId);
      
      if (session) {
        sessions.push(session);
      }
    }
    
    // Sort by lastUpdated descending
    sessions.sort((a, b) => 
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
    
    console.log(`✅ [CURSOR CLI] Parsed ${sessions.length} sessions successfully`);
    
    return sessions;
    
  } catch (error) {
    console.error('Failed to read Cursor CLI sessions:', error);
    return [];
  }
}

/**
 * Read a single Cursor CLI session by ID
 */
export function readCursorCliSession(projectPath: string, sessionId: string): CursorCliSession | null {
  try {
    const workspaceHash = getWorkspaceHash(projectPath);
    const sessionDir = path.join(getCursorChatsDir(), workspaceHash, sessionId);
    
    if (!fs.existsSync(sessionDir)) {
      console.log(`❌ [CURSOR CLI] Session directory not found: ${sessionDir}`);
      return null;
    }
    
    return parseCliSession(sessionDir, sessionId);
    
  } catch (error) {
    console.error(`Failed to read Cursor CLI session ${sessionId}:`, error);
    return null;
  }
}
