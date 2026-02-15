/**
 * CodeBuddy History Parser
 * 
 * Reads and parses CodeBuddy session history from ~/.codebuddy/projects/.
 * CodeBuddy stores sessions in JSONL format with a different message structure
 * than Claude.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SessionDetail, SessionMessage } from '../types.js';
import { getEnginePaths } from '../../config/engineConfig.js';

/**
 * Convert project path to CodeBuddy directory format.
 * CodeBuddy: strips leading '/' then replaces '/' with '-' (keeps '.' as-is)
 * Example: /Users/kongjie/project → Users-kongjie-project
 */
export function convertProjectPathToCodebuddyFormat(projectPath: string): string {
  let resolvedPath = projectPath;
  try {
    resolvedPath = fs.realpathSync(projectPath);
  } catch {
    // If the path doesn't exist or can't be resolved, use the original path
  }
  
  return resolvedPath.replace(/^\//, '').replace(/\//g, '-');
}

/**
 * Get the CodeBuddy history directory for a project.
 */
function getHistoryDir(projectPath: string): string {
  const codebuddyProjectPath = convertProjectPathToCodebuddyFormat(projectPath);
  return path.join(getEnginePaths().projectsDataDir, codebuddyProjectPath);
}

/**
 * Parse a single CodeBuddy JSONL session file into SessionDetail.
 */
function parseSessionFile(filePath: string, sessionId: string): SessionDetail | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return null;

    const rawMessages: any[] = lines.map(line => JSON.parse(line));
    
    // Find session title: use first topic message, or first user message text
    const topicMessages = rawMessages.filter(msg => msg.type === 'topic');
    let title = topicMessages.length > 0 ? topicMessages[0].topic : undefined;
    
    if (!title) {
      const firstUserMessage = rawMessages.find(msg => 
        msg.type === 'message' && msg.role === 'user'
      );
      if (firstUserMessage?.content) {
        const contentArr = firstUserMessage.content;
        if (Array.isArray(contentArr)) {
          const textBlock = contentArr.find((block: any) => 
            block.type === 'input_text' || block.type === 'text'
          );
          if (textBlock?.text) {
            title = textBlock.text
              .replace(/\n/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 50);
            if (textBlock.text.length > 50) {
              title += '...';
            }
          }
        }
      }
    }
    
    if (!title) {
      title = `会话 ${sessionId.slice(0, 8)}`;
    }

    // Convert CodeBuddy messages to unified SessionMessage format
    const messages: SessionMessage[] = rawMessages
      .filter(msg => msg.type === 'message' && (msg.role === 'user' || msg.role === 'assistant'))
      .map(msg => {
        const timestamp = typeof msg.timestamp === 'number' 
          ? new Date(msg.timestamp).toISOString() 
          : msg.timestamp;
        
        // Convert CodeBuddy content format to unified format
        let unifiedContent: string | any[] = '';
        if (Array.isArray(msg.content)) {
          unifiedContent = msg.content.map((block: any) => {
            if (block.type === 'input_text') {
              return { type: 'text', text: block.text };
            }
            if (block.type === 'output_text') {
              return { type: 'text', text: block.text };
            }
            return block;
          });
        } else if (typeof msg.content === 'string') {
          unifiedContent = msg.content;
        }
        
        return {
          type: msg.role as 'user' | 'assistant',
          uuid: msg.id || sessionId,
          timestamp,
          sessionId,
          message: {
            role: msg.role as 'user' | 'assistant',
            content: unifiedContent,
          },
          cwd: msg.cwd,
        } as SessionMessage;
      });

    // Get timestamps for session metadata
    const allTimestamps = rawMessages
      .filter(msg => msg.timestamp)
      .map(msg => typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp).getTime());
    
    const createdAt = allTimestamps.length > 0 
      ? new Date(Math.min(...allTimestamps)).toISOString() 
      : new Date().toISOString();
    const lastUpdated = allTimestamps.length > 0 
      ? new Date(Math.max(...allTimestamps)).toISOString() 
      : new Date().toISOString();

    return {
      id: sessionId,
      title,
      createdAt,
      lastUpdated,
      messages,
    };
  } catch (parseError) {
    console.error(`Failed to parse CodeBuddy session file: ${filePath}`, parseError);
    return null;
  }
}

/**
 * Read all CodeBuddy sessions for a project.
 */
export function readCodebuddyHistorySessions(projectPath: string): SessionDetail[] {
  try {
    const historyDir = getHistoryDir(projectPath);
    
    console.log(`📂 [CodeBuddy] History directory: ${historyDir}`);
    
    if (!fs.existsSync(historyDir)) {
      console.log('❌ [CodeBuddy] History directory not found:', historyDir);
      return [];
    }

    const jsonlFiles = fs.readdirSync(historyDir)
      .filter(file => file.endsWith('.jsonl'))
      .filter(file => !file.startsWith('.'))
      .filter(file => !file.startsWith('agent-'));

    const sessions: SessionDetail[] = [];

    for (const filename of jsonlFiles) {
      const sessionId = filename.replace('.jsonl', '');
      const filePath = path.join(historyDir, filename);
      
      const session = parseSessionFile(filePath, sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    // Sort by lastUpdated (newest first)
    sessions.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
    
    console.log(`📊 [CodeBuddy] Found ${sessions.length} sessions`);
    return sessions;
  } catch (error) {
    console.error('Failed to read CodeBuddy history sessions:', error);
    return [];
  }
}

/**
 * Read a single CodeBuddy session by ID.
 */
export function readCodebuddyHistorySession(projectPath: string, sessionId: string): SessionDetail | null {
  try {
    const historyDir = getHistoryDir(projectPath);
    const filePath = path.join(historyDir, `${sessionId}.jsonl`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    return parseSessionFile(filePath, sessionId);
  } catch (error) {
    console.error(`Failed to read CodeBuddy session ${sessionId}:`, error);
    return null;
  }
}
