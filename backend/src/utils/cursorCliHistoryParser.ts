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
import { execSync } from 'child_process';

/**
 * Image data structure for message images
 */
interface MessageImage {
  id: string;
  data: string;  // base64 encoded
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  filename?: string;
}

/**
 * Extract image references from message content and load image data
 * Looks for @.agentstudio-images/xxx.png patterns and reads the actual files
 * 
 * @param content - Message content that may contain @path references
 * @param projectPath - Project path where .agentstudio-images directory is located
 * @returns Array of image data objects
 */
function extractAndLoadImages(content: string, projectPath: string): MessageImage[] {
  const images: MessageImage[] = [];
  
  // Match @.agentstudio-images/imageN_timestamp.ext patterns
  const imagePathRegex = /@(\.agentstudio-images\/image\d+_\d+\.(png|jpg|jpeg|gif|webp))/gi;
  let match;
  let index = 0;
  
  while ((match = imagePathRegex.exec(content)) !== null) {
    const relativePath = match[1];
    const fullPath = path.join(projectPath, relativePath);
    
    try {
      if (fs.existsSync(fullPath)) {
        const imageBuffer = fs.readFileSync(fullPath);
        const base64Data = imageBuffer.toString('base64');
        const ext = path.extname(fullPath).toLowerCase().slice(1);
        
        // Map extension to media type
        const mediaTypeMap: Record<string, MessageImage['mediaType']> = {
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'webp': 'image/webp'
        };
        
        const mediaType = mediaTypeMap[ext] || 'image/png';
        
        images.push({
          id: `img_${index}_${Date.now()}`,
          data: base64Data,
          mediaType,
          filename: path.basename(fullPath)
        });
        
        index++;
      }
    } catch (error) {
      console.warn(`[CursorCLI] Failed to load image from ${fullPath}:`, error);
    }
  }
  
  return images;
}

/**
 * Execute SQLite query using native sqlite3 CLI
 * This properly handles WAL mode which sql.js doesn't support
 */
function executeSqliteQuery(dbPath: string, query: string): string {
  try {
    // Use -json for structured output, fall back to raw if not available
    const result = execSync(`sqlite3 -json "${dbPath}" "${query}"`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large results
    });
    return result;
  } catch (error) {
    console.error('[CursorCLI] SQLite query failed:', error);
    throw error;
  }
}

/**
 * Execute SQLite query and return raw blob data as hex
 */
function executeSqliteBlobQuery(dbPath: string, query: string): Array<{ id: string; data: string }> {
  try {
    // Use hex() to convert blob to hex string for safe transport
    const result = execSync(`sqlite3 "${dbPath}" "${query}"`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
    
    // Parse pipe-separated output: id|hex_data
    const lines = result.trim().split('\n').filter(line => line.length > 0);
    return lines.map(line => {
      const pipeIndex = line.indexOf('|');
      if (pipeIndex === -1) return { id: line, data: '' };
      return {
        id: line.substring(0, pipeIndex),
        data: line.substring(pipeIndex + 1),
      };
    });
  } catch (error) {
    console.error('[CursorCLI] SQLite blob query failed:', error);
    return [];
  }
}

// Types for CLI session parsing
export interface CursorCliMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  messageParts: CursorCliMessagePart[];
  images?: MessageImage[];  // Images loaded from @.agentstudio-images/ references
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
    toolUseResult?: Record<string, unknown>; // Object format for frontend components
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

interface MessageContentText {
  type: 'text';
  text: string;
}

interface MessageContentToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

interface MessageContentToolResult {
  type: 'tool-result';
  toolName: string;
  result: unknown;
  isError?: boolean;
}

type MessageContent = MessageContentText | MessageContentToolCall | MessageContentToolResult | { type: string; text?: string };

interface ParsedMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | MessageContent[];
  providerOptions?: unknown;
}

interface ToolResultMessage {
  role: 'tool';
  id: string;
  content: Array<{
    type: 'tool-result';
    toolName: string;
    result: unknown;
    isError?: boolean;
  }>;
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
      .filter((c): c is MessageContentText | { type: string; text: string } => 
        c.type === 'text' && 'text' in c && typeof c.text === 'string')
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
 * Parse text content and extract thinking blocks
 * Returns { thinking: string | null, text: string }
 */
function parseThinkingContent(text: string): { thinking: string | null; text: string } {
  // Match <think>...</think> or <thinking>...</thinking> blocks
  const thinkingMatch = text.match(/<think(?:ing)?>\s*([\s\S]*?)\s*<\/think(?:ing)?>/);
  
  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    // Remove thinking block from text
    const remainingText = text
      .replace(/<think(?:ing)?>\s*[\s\S]*?\s*<\/think(?:ing)?>/g, '')
      .trim();
    return { thinking, text: remainingText };
  }
  
  return { thinking: null, text };
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
function parseBlobData(data: Buffer): ParsedMessage | ToolResultMessage | null {
  try {
    // Convert buffer to string
    const dataStr = data.toString('utf-8');
    
    // Try parsing as JSON first
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.role) {
        return parsed;
      }
    } catch {
      // Not valid JSON, continue
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert tool name to Cursor format (e.g., "Glob" -> "globToolCall")
 */
function toCursorToolName(toolName: string): string {
  // Convert first letter to lowercase and add "ToolCall" suffix
  return toolName.charAt(0).toLowerCase() + toolName.slice(1) + 'ToolCall';
}

/**
 * Convert snake_case keys to camelCase
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert all keys in an object from snake_case to camelCase
 * Also handles arrays containing objects
 */
function convertKeysToCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = snakeToCamel(key);
    const value = obj[key];
    
    if (Array.isArray(value)) {
      // Handle arrays - convert objects within arrays
      result[camelKey] = value.map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return convertKeysToCamelCase(item as Record<string, unknown>);
        }
        return item;
      });
    } else if (value && typeof value === 'object') {
      // Recursively convert nested objects
      result[camelKey] = convertKeysToCamelCase(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

/**
 * Extract tool calls from message content
 * @param content - Array of message content items
 * @param isUserMessage - Whether this is a user message (to clean <user_query> tags)
 */
function extractToolCalls(content: MessageContent[], isUserMessage: boolean = false): CursorCliMessagePart[] {
  const parts: CursorCliMessagePart[] = [];
  let order = 0;
  
  for (const item of content) {
    if (item.type === 'text' && 'text' in item && item.text) {
      // Clean user query tags if this is a user message
      let textContent = isUserMessage ? cleanUserQuery(item.text) : item.text;
      // Skip empty text after cleaning
      if (!textContent.trim()) continue;
      
      // For assistant messages, check for thinking blocks
      if (!isUserMessage) {
        const { thinking, text } = parseThinkingContent(textContent);
        
        // Add thinking part if present
        if (thinking) {
          parts.push({
            id: `part_thinking_${order}`,
            type: 'thinking',
            content: thinking,
            order: order++
          });
        }
        
        // Update textContent to the remaining text
        textContent = text;
        
        // Skip if no remaining text
        if (!textContent.trim()) continue;
      }
      
      parts.push({
        id: `part_text_${order}`,
        type: 'text',
        content: textContent,
        order: order++
      });
    } else if (item.type === 'tool-call' && 'toolCallId' in item) {
      parts.push({
        id: item.toolCallId,
        type: 'tool',
        order: order++,
        toolData: {
          id: item.toolCallId,
          toolName: toCursorToolName(item.toolName), // Convert to Cursor tool name format (e.g., "globToolCall")
          toolInput: convertKeysToCamelCase(item.args || {}), // Convert snake_case to camelCase
        }
      });
    }
  }
  
  return parts;
}

/**
 * Parse a single CLI session from SQLite database
 * 
 * @param sessionDir - Path to the session directory containing store.db
 * @param sessionId - Session ID
 * @param projectPath - Optional project path for loading image references
 */
async function parseCliSession(sessionDir: string, sessionId: string, projectPath?: string): Promise<CursorCliSession | null> {
  const dbPath = path.join(sessionDir, 'store.db');
  
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  
  try {
    // Use native sqlite3 CLI to properly handle WAL mode
    // sql.js doesn't support WAL and would miss recent changes
    
    // Get meta information
    // The value in meta table is stored as a hex-encoded JSON string
    const metaValue = execSync(`sqlite3 "${dbPath}" "SELECT value FROM meta WHERE key = 0"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    
    if (!metaValue) {
      return null;
    }
    
    // Decode hex-encoded meta value (stored as hex string in the database)
    const metaJson = Buffer.from(metaValue, 'hex').toString('utf-8');
    const meta: SessionMeta = JSON.parse(metaJson);
    
    // Get all blobs with hex-encoded data
    const blobRows = executeSqliteBlobQuery(dbPath, 'SELECT id, hex(data) FROM blobs');
    
    // Convert hex strings to Buffer
    const blobs: { id: string; data: Buffer }[] = blobRows.map(row => ({
      id: row.id,
      data: Buffer.from(row.data, 'hex'),
    }));
    
    // Parse messages from blobs - use Map to deduplicate by message id
    const messageMap = new Map<string, CursorCliMessage>();
    const toolResults = new Map<string, { toolName: string; result: unknown; isError?: boolean }>();
    let messageIndex = 0;
    
    // Track seen content to deduplicate messages with same content
    const seenContent = new Set<string>();
    
    // First pass: collect all messages and tool results
    for (const blob of blobs) {
      const parsed = parseBlobData(blob.data);
      if (!parsed) continue;
      
      // Handle tool results
      if (parsed.role === 'tool' && 'id' in parsed) {
        const toolMsg = parsed as ToolResultMessage;
        if (Array.isArray(toolMsg.content)) {
          for (const item of toolMsg.content) {
            if (item.type === 'tool-result') {
              toolResults.set(toolMsg.id, {
                toolName: item.toolName,
                result: item.result,
                isError: item.isError
              });
            }
          }
        }
        continue;
      }
      
      // Skip system messages
      if (parsed.role === 'system') continue;
      
      // Handle user and assistant messages
      if (parsed.role === 'user' || parsed.role === 'assistant') {
        // Generate a unique message ID using blob.id (from database)
        // This ensures each blob is processed independently
        const msgId = `${parsed.role}_${blob.id}`;
        
        // Skip if we already have this exact message (by message ID)
        if (messageMap.has(msgId)) continue;
        
        let textContent = '';
        let messageParts: CursorCliMessagePart[] = [];
        
        const isUserMessage = parsed.role === 'user';
        
        if (Array.isArray(parsed.content)) {
          // Extract text content and tool calls from content array
          // Pass isUserMessage to clean <user_query> tags
          messageParts = extractToolCalls(parsed.content as MessageContent[], isUserMessage);
          textContent = messageParts
            .filter(p => p.type === 'text' && p.content)
            .map(p => p.content)
            .join('\n');
        } else if (typeof parsed.content === 'string') {
          // For string content, clean user query tags if needed
          let rawContent = isUserMessage ? cleanUserQuery(parsed.content) : parsed.content;
          
          if (rawContent) {
            // For assistant messages, parse thinking blocks
            if (!isUserMessage) {
              const { thinking, text } = parseThinkingContent(rawContent);
              
              if (thinking) {
                messageParts.push({
                  id: `part_thinking_${messageIndex}`,
                  type: 'thinking',
                  content: thinking,
                  order: messageParts.length
                });
              }
              
              textContent = text;
            } else {
              textContent = rawContent;
            }
            
            if (textContent) {
              messageParts.push({
                id: `part_${messageIndex}_0`,
                type: 'text',
                content: textContent,
                order: messageParts.length
              });
            }
          }
        }
        
        // textContent is already cleaned, use it directly
        const cleanedContent = textContent;
        
        // Skip if no meaningful content (no text, no thinking, no tool calls)
        const hasToolCalls = messageParts.some(p => p.type === 'tool');
        const hasThinking = messageParts.some(p => p.type === 'thinking');
        if (!cleanedContent && !hasToolCalls && !hasThinking) {
          continue;
        }
        
        // Skip system info in user messages
        if (parsed.role === 'user' && 
            (cleanedContent.startsWith('<user_info>') || 
             cleanedContent.startsWith('<rules>') ||
             cleanedContent.includes('<user_info>'))) {
          continue;
        }
        
        // Create content hash for deduplication (based on role + text content + tool calls)
        const toolCallIds = messageParts
          .filter(p => p.type === 'tool' && p.toolData)
          .map(p => p.toolData!.id)
          .sort()
          .join(',');
        const contentHash = `${parsed.role}:${cleanedContent.substring(0, 200)}:${toolCallIds}`;
        
        // Skip if we've already seen this exact content
        if (seenContent.has(contentHash)) {
          continue;
        }
        seenContent.add(contentHash);
        
        // For user messages, try to extract and load image references
        let images: MessageImage[] | undefined;
        if (parsed.role === 'user' && projectPath && cleanedContent.includes('@.agentstudio-images/')) {
          images = extractAndLoadImages(cleanedContent, projectPath);
          if (images.length > 0) {
            console.log(`📷 [CursorCLI] Loaded ${images.length} image(s) for user message`);
          }
        }
        
        messageMap.set(msgId, {
          id: msgId,
          role: parsed.role,
          content: cleanedContent,
          timestamp: meta.createdAt + (messageIndex * 1000),
          messageParts: messageParts.length > 0 ? messageParts : [{
            id: `part_${messageIndex}_0`,
            type: 'text',
            content: cleanedContent,
            order: 0
          }],
          images  // Include loaded images if any
        });
        
        messageIndex++;
      }
    }
    
    // Second pass: attach tool results to tool calls
    for (const message of messageMap.values()) {
      for (const part of message.messageParts) {
        if (part.type === 'tool' && part.toolData) {
          const result = toolResults.get(part.toolData.id);
          if (result) {
            part.toolData.toolResult = typeof result.result === 'string' 
              ? result.result 
              : JSON.stringify(result.result);
            
            // Also set toolUseResult as object with camelCase keys for frontend components
            if (result.result && typeof result.result === 'object') {
              part.toolData.toolUseResult = convertKeysToCamelCase(result.result as Record<string, unknown>);
            } else if (typeof result.result === 'string') {
              // Try to parse string as JSON
              try {
                const parsed = JSON.parse(result.result);
                if (typeof parsed === 'object' && parsed !== null) {
                  part.toolData.toolUseResult = convertKeysToCamelCase(parsed);
                }
              } catch {
                // Not JSON, leave toolUseResult undefined
              }
            }
            
            part.toolData.isError = result.isError;
          }
        }
      }
    }
    
    // Convert map to array and sort by timestamp
    const messages = Array.from(messageMap.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    
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
export async function readCursorCliSessions(projectPath: string): Promise<CursorCliSession[]> {
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
      const session = await parseCliSession(sessionDir, sessionId);
      
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
export async function readCursorCliSession(projectPath: string, sessionId: string): Promise<CursorCliSession | null> {
  try {
    const workspaceHash = getWorkspaceHash(projectPath);
    
    // Strip 'cursor-' prefix if present (added by AgentStudio for internal tracking)
    const actualSessionId = sessionId.startsWith('cursor-') ? sessionId.slice(7) : sessionId;
    const sessionDir = path.join(getCursorChatsDir(), workspaceHash, actualSessionId);
    
    if (!fs.existsSync(sessionDir)) {
      console.log(`❌ [CURSOR CLI] Session directory not found: ${sessionDir}`);
      return null;
    }
    
    // Pass projectPath for loading image references
    // Use original sessionId (with prefix) to maintain consistency
    return await parseCliSession(sessionDir, sessionId, projectPath);
    
  } catch (error) {
    console.error(`Failed to read Cursor CLI session ${sessionId}:`, error);
    return null;
  }
}
