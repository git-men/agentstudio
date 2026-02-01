/**
 * Cursor Agent Transcript Parser
 * 
 * Parses Cursor CLI agent transcript files (.txt) from ~/.cursor/projects/<path>/agent-transcripts/
 * and converts them to a unified session format compatible with the existing session system.
 * 
 * Transcript format:
 * - `user:` followed by user message content
 * - `assistant:` followed by assistant message content  
 * - `[Thinking]` followed by thinking/reasoning content
 * - `[Tool call] ToolName` followed by tool parameters
 * - `[Tool result] ToolName` followed by tool result
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Types for Cursor transcript parsing
export interface CursorTranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageParts: CursorMessagePart[];
}

export interface CursorMessagePart {
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

export interface CursorSession {
  id: string;
  title: string;
  createdAt: string;
  lastUpdated: string;
  messages: CursorTranscriptMessage[];
}

/**
 * Convert project path to Cursor's directory format
 * /Users/kongjie/projects/agent-studio → Users-kongjie-projects-agent-studio
 */
function convertProjectPathToCursorFormat(projectPath: string): string {
  // Resolve symlinks first
  let resolvedPath = projectPath;
  try {
    resolvedPath = fs.realpathSync(projectPath);
  } catch {
    // If path doesn't exist, use original
  }
  
  // Replace path separators with dashes (Cursor's format)
  return resolvedPath.replace(/^\//, '').replace(/[\/\\]/g, '-');
}

/**
 * Get the Cursor projects directory
 */
function getCursorProjectsDir(): string {
  return path.join(os.homedir(), '.cursor', 'projects');
}

/**
 * Parse a single transcript file
 */
function parseTranscriptFile(filePath: string, sessionId: string): CursorSession | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const messages: CursorTranscriptMessage[] = [];
    let currentRole: 'user' | 'assistant' | null = null;
    let currentContent: string[] = [];
    let currentParts: CursorMessagePart[] = [];
    let partOrder = 0;
    let messageIndex = 0;
    
    // Track tool call IDs for matching with results
    const pendingToolCalls: Map<string, CursorMessagePart> = new Map();
    
    const finishCurrentMessage = () => {
      if (currentRole && (currentContent.length > 0 || currentParts.length > 0)) {
        // Add any remaining text content as a part
        const textContent = currentContent.join('\n').trim();
        if (textContent && !currentParts.some(p => p.type === 'text' && p.content === textContent)) {
          // Check if we already have text parts - if so, append to last one
          const lastTextPart = [...currentParts].reverse().find(p => p.type === 'text');
          if (lastTextPart && lastTextPart.content) {
            lastTextPart.content = (lastTextPart.content + '\n' + textContent).trim();
          } else {
            currentParts.push({
              id: `part_${messageIndex}_text_${partOrder}`,
              type: 'text',
              content: textContent,
              order: partOrder++
            });
          }
        }
        
        messages.push({
          id: `msg_${sessionId}_${messageIndex}`,
          role: currentRole,
          content: currentParts
            .filter(p => p.type === 'text')
            .map(p => p.content)
            .join('\n'),
          timestamp: Date.now() - (1000 * (100 - messageIndex)), // Approximate timestamps
          messageParts: currentParts
        });
        
        messageIndex++;
      }
      
      currentRole = null;
      currentContent = [];
      currentParts = [];
      partOrder = 0;
    };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for role markers
      if (line.startsWith('user:')) {
        finishCurrentMessage();
        currentRole = 'user';
        const afterMarker = line.substring(5).trim();
        if (afterMarker) {
          currentContent.push(afterMarker);
        }
        continue;
      }
      
      if (line.startsWith('assistant:')) {
        finishCurrentMessage();
        currentRole = 'assistant';
        const afterMarker = line.substring(10).trim();
        if (afterMarker) {
          currentContent.push(afterMarker);
        }
        continue;
      }
      
      // Parse content within current message
      if (currentRole) {
        // Check for [Thinking] block
        if (line.startsWith('[Thinking]')) {
          // Save current text content first
          const textContent = currentContent.join('\n').trim();
          if (textContent) {
            currentParts.push({
              id: `part_${messageIndex}_text_${partOrder}`,
              type: 'text',
              content: textContent,
              order: partOrder++
            });
            currentContent = [];
          }
          
          // Extract thinking content
          const thinkingContent = line.substring(10).trim();
          currentParts.push({
            id: `part_${messageIndex}_thinking_${partOrder}`,
            type: 'thinking',
            content: thinkingContent,
            order: partOrder++
          });
          continue;
        }
        
        // Check for [Tool call] block
        if (line.startsWith('[Tool call]')) {
          // Save current text content first
          const textContent = currentContent.join('\n').trim();
          if (textContent) {
            currentParts.push({
              id: `part_${messageIndex}_text_${partOrder}`,
              type: 'text',
              content: textContent,
              order: partOrder++
            });
            currentContent = [];
          }
          
          // Parse tool name from the line
          const toolNameMatch = line.match(/\[Tool call\]\s+(\w+)/);
          const toolName = toolNameMatch ? toolNameMatch[1] : 'Unknown';
          
          // Collect tool parameters from following lines
          const toolParams: Record<string, string> = {};
          let j = i + 1;
          while (j < lines.length && lines[j].startsWith('  ')) {
            const paramLine = lines[j].trim();
            const colonIndex = paramLine.indexOf(':');
            if (colonIndex > 0) {
              const key = paramLine.substring(0, colonIndex).trim();
              const value = paramLine.substring(colonIndex + 1).trim();
              toolParams[key] = value;
            }
            j++;
          }
          i = j - 1; // Skip processed lines
          
          const toolPartId = `part_${messageIndex}_tool_${partOrder}`;
          const toolPart: CursorMessagePart = {
            id: toolPartId,
            type: 'tool',
            order: partOrder++,
            toolData: {
              id: `tool_${messageIndex}_${partOrder}`,
              toolName,
              toolInput: toolParams,
              toolResult: undefined,
              isError: false
            }
          };
          
          currentParts.push(toolPart);
          pendingToolCalls.set(toolName, toolPart);
          continue;
        }
        
        // Check for [Tool result] block
        if (line.startsWith('[Tool result]')) {
          const toolNameMatch = line.match(/\[Tool result\]\s+(\w+)/);
          const toolName = toolNameMatch ? toolNameMatch[1] : 'Unknown';
          
          // Find corresponding tool call and update its result
          const toolPart = pendingToolCalls.get(toolName);
          if (toolPart && toolPart.toolData) {
            // Collect result from following lines
            const resultLines: string[] = [];
            let j = i + 1;
            while (j < lines.length && 
                   !lines[j].startsWith('[Tool call]') && 
                   !lines[j].startsWith('[Tool result]') &&
                   !lines[j].startsWith('[Thinking]') &&
                   !lines[j].startsWith('user:') &&
                   !lines[j].startsWith('assistant:')) {
              resultLines.push(lines[j]);
              j++;
            }
            i = j - 1; // Skip processed lines
            
            toolPart.toolData.toolResult = resultLines.join('\n').trim() || '(empty result)';
          }
          continue;
        }
        
        // Regular content line
        currentContent.push(line);
      }
    }
    
    // Finish last message
    finishCurrentMessage();
    
    if (messages.length === 0) {
      return null;
    }
    
    // Extract title from first user message
    const firstUserMessage = messages.find(m => m.role === 'user');
    let title = firstUserMessage?.content?.substring(0, 50) || `Session ${sessionId.substring(0, 8)}`;
    if (title.length >= 50) {
      title += '...';
    }
    // Clean up title - remove XML tags and special characters
    title = title.replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim();
    if (!title) {
      title = `Session ${sessionId.substring(0, 8)}`;
    }
    
    // Get file stats for timestamps
    const stats = fs.statSync(filePath);
    
    return {
      id: sessionId,
      title,
      createdAt: stats.birthtime.toISOString(),
      lastUpdated: stats.mtime.toISOString(),
      messages
    };
    
  } catch (error) {
    console.error(`Failed to parse transcript file ${filePath}:`, error);
    return null;
  }
}

/**
 * Read all Cursor transcript sessions for a project
 */
export function readCursorHistorySessions(projectPath: string): CursorSession[] {
  try {
    const cursorProjectPath = convertProjectPathToCursorFormat(projectPath);
    const transcriptsDir = path.join(getCursorProjectsDir(), cursorProjectPath, 'agent-transcripts');
    
    console.log(`📂 [CURSOR] Reading transcripts from: ${transcriptsDir}`);
    
    if (!fs.existsSync(transcriptsDir)) {
      console.log(`❌ [CURSOR] Transcripts directory not found: ${transcriptsDir}`);
      return [];
    }
    
    const files = fs.readdirSync(transcriptsDir)
      .filter(file => file.endsWith('.txt'))
      .filter(file => !file.startsWith('.'));
    
    console.log(`📋 [CURSOR] Found ${files.length} transcript files`);
    
    const sessions: CursorSession[] = [];
    
    for (const filename of files) {
      const sessionId = filename.replace('.txt', '');
      const filePath = path.join(transcriptsDir, filename);
      
      const session = parseTranscriptFile(filePath, sessionId);
      if (session) {
        sessions.push(session);
      }
    }
    
    // Sort by lastUpdated descending
    sessions.sort((a, b) => 
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    );
    
    console.log(`✅ [CURSOR] Parsed ${sessions.length} sessions successfully`);
    
    return sessions;
    
  } catch (error) {
    console.error('Failed to read Cursor history sessions:', error);
    return [];
  }
}

/**
 * Read a single Cursor session by ID
 */
export function readCursorSession(projectPath: string, sessionId: string): CursorSession | null {
  try {
    const cursorProjectPath = convertProjectPathToCursorFormat(projectPath);
    const filePath = path.join(
      getCursorProjectsDir(), 
      cursorProjectPath, 
      'agent-transcripts',
      `${sessionId}.txt`
    );
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ [CURSOR] Session file not found: ${filePath}`);
      return null;
    }
    
    return parseTranscriptFile(filePath, sessionId);
    
  } catch (error) {
    console.error(`Failed to read Cursor session ${sessionId}:`, error);
    return null;
  }
}
