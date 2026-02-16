/**
 * CodeBuddy History Parser
 * 
 * Reads and parses CodeBuddy session history from ~/.codebuddy/projects/.
 * CodeBuddy stores sessions in JSONL format similar to Claude SDK format.
 * 
 * Output format matches the frontend's AgentMessage interface:
 *   { id, role, content, timestamp (number), messageParts[] }
 */

import * as path from 'path';
import * as fs from 'fs';
import type { SessionDetail } from '../types.js';
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
 * Extract text content from a CodeBuddy message's content blocks.
 */
function extractTextContent(msg: any): string {
  if (!msg.content) return '';

  if (typeof msg.content === 'string') return msg.content;

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block: any) =>
        block.type === 'text' ||
        block.type === 'input_text' ||
        block.type === 'output_text' ||
        block.type === 'thinking'
      )
      .map((block: any) => block.text || block.thinking || '')
      .join('');
  }

  return '';
}

/**
 * Convert a CodeBuddy message's content blocks to messageParts format
 * that the frontend can render (text, thinking, tool, image parts).
 */
function convertToMessageParts(msg: any, toolResultMap: Map<string, { content: string; isError: boolean }>): any[] {
  if (!msg.content) return [];

  if (typeof msg.content === 'string') {
    return [{
      id: `part_0_${msg.id}`,
      type: 'text',
      content: msg.content,
      order: 0,
    }];
  }

  if (Array.isArray(msg.content)) {
    return msg.content.map((block: any, index: number) => {
      // Text blocks
      if (block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') {
        return {
          id: `part_${index}_${msg.id}`,
          type: 'text',
          content: block.text || '',
          order: index,
        };
      }

      // Thinking blocks
      if (block.type === 'thinking') {
        return {
          id: `part_${index}_${msg.id}`,
          type: 'thinking',
          content: block.thinking || '',
          order: index,
        };
      }

      // Tool use blocks
      if (block.type === 'tool_use' && block.name && block.id) {
        const toolResult = toolResultMap.get(block.id);
        return {
          id: `part_${index}_${msg.id}`,
          type: 'tool',
          toolData: {
            id: `tool_${index}_${msg.id}`,
            claudeId: block.id,
            toolName: block.name,
            toolInput: block.input || {},
            toolResult: toolResult?.content,
            isError: toolResult?.isError || false,
            isExecuting: false,
          },
          order: index,
        };
      }

      // Image blocks
      if (block.type === 'image') {
        return {
          id: `part_${index}_${msg.id}`,
          type: 'image',
          imageData: {
            id: `img_${index}_${msg.id}`,
            data: block.source?.data || '',
            mediaType: block.source?.media_type || 'image/jpeg',
            filename: `image_${index}.jpg`,
          },
          order: index,
        };
      }

      // Tool result blocks are handled separately (skip here)
      if (block.type === 'tool_result') {
        return null;
      }

      // Unknown blocks — serialize
      return {
        id: `part_${index}_${msg.id}`,
        type: 'text',
        content: JSON.stringify(block),
        order: index,
      };
    }).filter((p: any) => p !== null);
  }

  return [];
}

/**
 * Parse a single CodeBuddy JSONL session file into SessionDetail.
 * 
 * Output messages are in frontend-compatible AgentMessage format:
 *   { id, role, content, timestamp, messageParts }
 */
function parseSessionFile(filePath: string, sessionId: string): SessionDetail | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return null;

    const rawMessages: any[] = lines.map(line => JSON.parse(line));
    
    // --- Title extraction ---
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

    // --- Build tool_result map for correlating with tool_use ---
    const toolResultMap = new Map<string, { content: string; isError: boolean }>();
    for (const msg of rawMessages) {
      if (msg.type === 'message' && msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || String(c)).join('')
                : JSON.stringify(block.content);
            toolResultMap.set(block.tool_use_id, {
              content: resultContent,
              isError: block.is_error || false,
            });
          }
        }
      }
    }

    // --- Filter conversation messages (include compact boundaries) ---
    const conversationMessages = rawMessages.filter(msg => {
      // Include compact boundary system messages
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') return true;
      if (msg.type !== 'message') return false;
      if (msg.role === 'assistant') return true;
      if (msg.role === 'user') {
        // Exclude user messages that only contain tool_result
        if (Array.isArray(msg.content)) {
          const hasNonToolResult = msg.content.some((block: any) => block.type !== 'tool_result');
          return hasNonToolResult;
        }
        return true;
      }
      return false;
    });

    if (conversationMessages.length === 0) {
      return {
        id: sessionId,
        title,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: [],
      };
    }

    // --- Convert and merge consecutive assistant messages ---
    const convertedMessages: any[] = [];
    let i = 0;

    while (i < conversationMessages.length) {
      const msg = conversationMessages[i];
      const msgTimestamp = typeof msg.timestamp === 'number' 
        ? msg.timestamp 
        : new Date(msg.timestamp).getTime();

      // Handle compact boundary messages
      if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
        // Look ahead for the compact summary message (next assistant message after boundary)
        let summaryContent = '';
        if (i + 1 < conversationMessages.length) {
          const nextMsg = conversationMessages[i + 1];
          if (nextMsg.role === 'assistant') {
            summaryContent = extractTextContent(nextMsg);
          }
        }

        convertedMessages.push({
          id: `msg_${convertedMessages.length}_compact_${msg.uuid || i}`,
          role: 'assistant',
          content: summaryContent || 'Context compacted',
          timestamp: msgTimestamp || Date.now(),
          messageParts: [{
            id: `part_compact_${msg.uuid || i}`,
            type: 'compactSummary',
            content: summaryContent || 'Context compacted',
            order: 0,
          }],
        });

        // If we consumed the next assistant message as summary, skip it
        if (summaryContent && i + 1 < conversationMessages.length && conversationMessages[i + 1].role === 'assistant') {
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (msg.role === 'user') {
        const parts = convertToMessageParts(msg, toolResultMap);
        convertedMessages.push({
          id: `msg_${convertedMessages.length}_${msg.id}`,
          role: 'user',
          content: extractTextContent(msg),
          timestamp: msgTimestamp,
          messageParts: parts,
        });
        i++;
      } else if (msg.role === 'assistant') {
        // Collect consecutive assistant messages and merge them
        const assistantMessages = [msg];
        let j = i + 1;
        while (j < conversationMessages.length && conversationMessages[j].role === 'assistant') {
          assistantMessages.push(conversationMessages[j]);
          j++;
        }

        const combinedMessage: any = {
          id: `msg_${convertedMessages.length}_${msg.id}`,
          role: 'assistant',
          content: '',
          timestamp: msgTimestamp,
          messageParts: [],
        };

        for (const assistantMsg of assistantMessages) {
          combinedMessage.content += extractTextContent(assistantMsg);
          const parts = convertToMessageParts(assistantMsg, toolResultMap);
          combinedMessage.messageParts.push(
            ...parts.map((part: any) => ({
              ...part,
              order: combinedMessage.messageParts.length + part.order,
            }))
          );
        }

        convertedMessages.push(combinedMessage);
        i = j;
      } else {
        i++;
      }
    }

    // --- Timestamps ---
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
      messages: convertedMessages,
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
