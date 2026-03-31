import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentStorage } from '../services/agentStorage';
import { ClaudeHistoryMessage, ClaudeHistorySession } from '../types/claude-history';
import { sessionNameService } from '../services/sessionNameService.js';
// Note: Cursor/CodeBuddy session reading is now handled via engine.readSessions()
// Claude session reading still uses readClaudeHistorySessions() below (pending migration)
import { sessionManager } from '../services/sessionManager';
import { getProjectsDir, getAllProjectsDirs } from '../config/engineConfig.js';
// Note: getEngineType is no longer needed here - engine routing is handled via engineManager
import { engineManager } from '../engines/index.js';
import { resolvePath } from '../config/paths.js';

const router: express.Router = express.Router();

// Storage instances
const globalAgentStorage = new AgentStorage();

// Helper functions for reading Agent SDK history from projects directory
function convertProjectPathToClaudeFormat(projectPath: string): string {
  // Expand ~ to home directory before any filesystem operations
  let resolvedPath = projectPath;
  if (resolvedPath.startsWith('~')) {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
  }

  // Resolve symlinks to get the real path
  // This is important because Claude CLI stores sessions using the real path
  try {
    const realPath = fs.realpathSync(resolvedPath);
    if (realPath !== resolvedPath) {
      console.log(`🔗 [DEBUG] Resolved symlink: ${resolvedPath} -> ${realPath}`);
    }
    resolvedPath = realPath;
  } catch (error) {
    console.log(`⚠️ [DEBUG] Could not resolve path: ${resolvedPath}, using as-is`);
  }
  
  // Convert path like /Users/kongjie/Desktop/.workspace2.nosync
  // to: -Users-kongjie-Desktop--workspace2-nosync
  // On Windows: C:\Users\talonwang\project -> C--Users-talonwang-project
  // With spaces: /Users/kongjie/hello world -> -Users-kongjie-hello-world
  // Claude CLI replaces '/', '\', '.', ':', ' ' with '-'
  return resolvedPath.replace(/[\/\\\.:\ ]/g, '-');
}

// SubAgent消息流中的单个消息部分
interface SubAgentMessagePart {
  id: string;
  type: 'text' | 'thinking' | 'tool';
  content?: string;
  toolData?: {
    id: string;
    toolName: string;
    toolInput: any;
    toolResult?: string;
    isError?: boolean;
  };
  order: number;
}

// SubAgent消息流中的单条消息
interface SubAgentMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  messageParts: SubAgentMessagePart[];
}

// 读取子Agent的消息文件并提取完整消息流
function readSubAgentMessageFlow(projectPath: string, agentId: string, sessionId?: string): SubAgentMessage[] {
  try {
    const claudeProjectPath = convertProjectPathToClaudeFormat(projectPath);
    // Search all directories (macOS EMFILE workaround may store files in custom dir)
    let agentFilePath: string | null = null;
    for (const projectsDir of getAllProjectsDirs()) {
      const historyDir = path.join(projectsDir, claudeProjectPath);

      // New format: {historyDir}/{sessionId}/subagents/agent-{agentId}.jsonl
      if (sessionId) {
        const nestedPath = path.join(historyDir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
        if (fs.existsSync(nestedPath)) {
          agentFilePath = nestedPath;
          break;
        }
      }

      // Legacy flat format: {historyDir}/agent-{agentId}.jsonl
      const flatPath = path.join(historyDir, `agent-${agentId}.jsonl`);
      if (fs.existsSync(flatPath)) {
        agentFilePath = flatPath;
        break;
      }

      // Fallback: scan all {sessionId}/subagents/ directories if sessionId not provided
      if (!sessionId) {
        try {
          const entries = fs.readdirSync(historyDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const scanPath = path.join(historyDir, entry.name, 'subagents', `agent-${agentId}.jsonl`);
              if (fs.existsSync(scanPath)) {
                agentFilePath = scanPath;
                break;
              }
            }
          }
        } catch {
          // directory read failed, skip
        }
        if (agentFilePath) break;
      }
    }

    if (!agentFilePath) {
      console.log(`⚠️ [SUBAGENT] Sub-agent file not found for agentId: ${agentId}${sessionId ? ` (session: ${sessionId})` : ''}`);
      return [];
    }
    
    console.log(`📂 [SUBAGENT] Reading sub-agent message flow: ${agentFilePath}`);

    const content = fs.readFileSync(agentFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return [];

    const rawMessages: ClaudeHistoryMessage[] = lines.map(line => JSON.parse(line));
    
    // 收集所有tool_result以便后续匹配
    const toolResultMap = new Map<string, { content: string; isError: boolean }>();
    for (const msg of rawMessages) {
      if (msg.type === 'user' && msg.message?.content && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const resultContent = typeof block.content === 'string' 
              ? block.content 
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || String(c)).join('')
                : JSON.stringify(block.content);
            
            toolResultMap.set(block.tool_use_id, {
              content: resultContent,
              isError: block.is_error || false
            });
          }
        }
      }
    }

    // 转换为消息流格式
    const messageFlow: SubAgentMessage[] = [];
    
    for (const msg of rawMessages) {
      // 只处理assistant消息（包含文本、思考、工具调用）
      if (msg.type === 'assistant' && msg.message?.content) {
        const messageParts: SubAgentMessagePart[] = [];
        let partOrder = 0;
        
        if (Array.isArray(msg.message.content)) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              messageParts.push({
                id: `part_${msg.uuid}_${partOrder}`,
                type: 'text',
                content: block.text,
                order: partOrder++
              });
            } else if (block.type === 'thinking' && block.thinking) {
              messageParts.push({
                id: `part_${msg.uuid}_${partOrder}`,
                type: 'thinking',
                content: block.thinking,
                order: partOrder++
              });
            } else if (block.type === 'tool_use' && block.name && block.id) {
              const toolResult = toolResultMap.get(block.id);
              messageParts.push({
                id: `part_${msg.uuid}_${partOrder}`,
                type: 'tool',
                toolData: {
                  id: block.id,
                  toolName: block.name,
                  toolInput: block.input || {},
                  toolResult: toolResult?.content,
                  isError: toolResult?.isError
                },
                order: partOrder++
              });
            }
          }
        } else if (typeof msg.message.content === 'string') {
          // 处理纯文本内容
          messageParts.push({
            id: `part_${msg.uuid}_0`,
            type: 'text',
            content: msg.message.content,
            order: 0
          });
        }
        
        if (messageParts.length > 0) {
          messageFlow.push({
            id: msg.uuid,
            role: 'assistant',
            timestamp: msg.timestamp,
            messageParts
          });
        }
      }
    }

    console.log(`✅ [SUBAGENT] Extracted ${messageFlow.length} messages with ${messageFlow.reduce((sum, m) => sum + m.messageParts.length, 0)} parts from sub-agent ${agentId}`);
    return messageFlow;

  } catch (error) {
    console.error(`Failed to read sub-agent message flow for ${agentId}:`, error);
    return [];
  }
}

// Function to get AgentStorage instance for specific project directory
const getAgentStorageForRequest = (req: express.Request): AgentStorage => {
  const raw = req.query.projectPath as string || req.body?.projectPath as string;
  const workingDir = raw ? resolvePath(raw) : process.cwd();
  return new AgentStorage(workingDir);
};

// Process compact context messages - detect and convert the 4-message or 5-message pattern
function processCompactContextMessages(messages: ClaudeHistoryMessage[]): ClaudeHistoryMessage[] {
  const processedMessages: ClaudeHistoryMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const currentMsg = messages[i];

    // Case 1a: New format (5-message pattern) - Check for compact_boundary message first
    if ((currentMsg as any).type === 'system' &&
        (currentMsg as any).subtype === 'compact_boundary' &&
        currentMsg.parentUuid === null &&
        i + 4 < messages.length) {

      const summaryMsg = messages[i + 1];
      const metaMsg = messages[i + 2];
      const commandMsg = messages[i + 3];
      const outputMsg = messages[i + 4];

      // Verify this is the new 5-message compact pattern
      if (summaryMsg.isCompactSummary &&
          summaryMsg.parentUuid === currentMsg.uuid &&
          metaMsg.isMeta === true &&
          commandMsg.type === 'user' &&
          commandMsg.message?.content &&
          typeof commandMsg.message.content === 'string' &&
          commandMsg.message.content.includes('<command-name>/compact</command-name>') &&
          commandMsg.parentUuid === metaMsg.uuid &&
          outputMsg.type === 'user' &&
          outputMsg.message?.content &&
          typeof outputMsg.message.content === 'string' &&
          outputMsg.message.content.includes('<local-command-stdout>') &&
          outputMsg.parentUuid === commandMsg.uuid) {

        // Create synthetic user command message
        const userCommandMessage: ClaudeHistoryMessage = {
          type: 'user',
          uuid: `synthetic_cmd_${commandMsg.uuid}`,
          timestamp: commandMsg.timestamp,
          sessionId: commandMsg.sessionId,
          parentUuid: currentMsg.parentUuid,
          message: {
            role: 'user',
            content: '/compact'
          },
          isCompactCommand: true
        };

        // Create synthetic AI response with compressed content
        const aiResponseMessage: ClaudeHistoryMessage = {
          type: 'assistant',
          uuid: `synthetic_ai_${summaryMsg.uuid}`,
          timestamp: summaryMsg.timestamp,
          sessionId: summaryMsg.sessionId,
          parentUuid: userCommandMessage.uuid,
          message: {
            role: 'assistant',
            content: extractContentFromClaudeMessage(summaryMsg, messages) || '会话上下文已压缩'
          },
          isCompactSummary: true
        };

        processedMessages.push(userCommandMessage, aiResponseMessage);
        i += 5; // Skip all 5 messages
        continue;
      }
    }

    // Case 1b: Old format (4-message pattern) - Check for isCompactSummary with parentUuid === null
    if (currentMsg.isCompactSummary && currentMsg.parentUuid === null && i + 3 < messages.length) {
      const metaMsg = messages[i + 1];
      const commandMsg = messages[i + 2];
      const outputMsg = messages[i + 3];

      // Verify this is the old 4-message manual compact pattern
      if (metaMsg.isMeta === true &&
          commandMsg.type === 'user' &&
          commandMsg.message?.content &&
          typeof commandMsg.message.content === 'string' &&
          commandMsg.message.content.includes('<command-name>/compact</command-name>') &&
          commandMsg.parentUuid === metaMsg.uuid &&
          outputMsg.type === 'user' &&
          outputMsg.message?.content &&
          typeof outputMsg.message.content === 'string' &&
          outputMsg.message.content.includes('<local-command-stdout>') &&
          outputMsg.parentUuid === commandMsg.uuid) {

        // Create synthetic user command message
        const userCommandMessage: ClaudeHistoryMessage = {
          type: 'user',
          uuid: `synthetic_cmd_${commandMsg.uuid}`,
          timestamp: commandMsg.timestamp,
          sessionId: commandMsg.sessionId,
          parentUuid: currentMsg.parentUuid,
          message: {
            role: 'user',
            content: '/compact'
          },
          isCompactCommand: true
        };

        // Create synthetic AI response with compressed content
        const aiResponseMessage: ClaudeHistoryMessage = {
          type: 'assistant',
          uuid: `synthetic_ai_${currentMsg.uuid}`,
          timestamp: currentMsg.timestamp,
          sessionId: currentMsg.sessionId,
          parentUuid: userCommandMessage.uuid,
          message: {
            role: 'assistant',
            content: extractContentFromClaudeMessage(currentMsg, messages) || '会话上下文已压缩'
          },
          isCompactSummary: true
        };

        processedMessages.push(userCommandMessage, aiResponseMessage);
        i += 4; // Skip all 4 messages
        continue;
      }
    }
    
    // Case 2: Auto compact - Single message with isCompactSummary
    if (currentMsg.isCompactSummary && currentMsg.parentUuid === null && 
        !(i + 1 < messages.length && messages[i + 1].isMeta === true)) {
      
      // Create synthetic AI response for auto-compressed content
      const aiResponseMessage: ClaudeHistoryMessage = {
        type: 'assistant',
        uuid: `synthetic_auto_${currentMsg.uuid}`,
        timestamp: currentMsg.timestamp,
        sessionId: currentMsg.sessionId,
        parentUuid: currentMsg.parentUuid,
        message: {
          role: 'assistant',
          content: extractContentFromClaudeMessage(currentMsg, messages) || '会话上下文已自动压缩'
        },
        isCompactSummary: true
      };
      
      processedMessages.push(aiResponseMessage);
      i++;
      continue;
    }
    
    // Regular message - pass through
    processedMessages.push(currentMsg);
    i++;
  }

  return processedMessages;
}


interface ReadSessionsOptions {
  /** Filter out automated task sessions whose title starts with [TASK_...] */
  excludeAutomatedTasks?: boolean;
  /** Max sessions to return (newest first based on file mtime) */
  limit?: number;
}

function readClaudeHistorySessions(projectPath: string, options?: ReadSessionsOptions): ClaudeHistorySession[] {
  try {
    const claudeProjectPath = convertProjectPathToClaudeFormat(projectPath);
    const allDirs = getAllProjectsDirs();

    console.log(`📂 [DEBUG] Searching Claude history in dirs:`, allDirs.map(d => path.join(d, claudeProjectPath)));

    // Collect sessions from all directories; use a Map keyed by sessionId for deduplication.
    // Earlier directories in allDirs have higher priority (they contain newer sessions).
    const sessionMap = new Map<string, ClaudeHistorySession>();

    for (const projectsDir of allDirs) {
      const historyDir = path.join(projectsDir, claudeProjectPath);

      if (!fs.existsSync(historyDir)) {
        console.log(`⏭️  [DEBUG] Directory not found, skipping: ${historyDir}`);
        continue;
      }

      console.log(`📂 [DEBUG] Reading from: ${historyDir}`);

      const jsonlFiles = fs.readdirSync(historyDir)
        .filter(file => file.endsWith('.jsonl'))
        .filter(file => !file.startsWith('.'))
        .filter(file => !file.startsWith('agent-')); // 过滤掉 agent-xxx.jsonl 文件

      // Sort files by modification time (newest first) for better perf with limit
      const sortedFiles = jsonlFiles.map(file => {
        try {
          const stat = fs.statSync(path.join(historyDir, file));
          return { file, mtime: stat.mtimeMs };
        } catch {
          return { file, mtime: 0 };
        }
      }).sort((a, b) => b.mtime - a.mtime);

      // Apply limit: process at most N files per directory
      const filesToProcess = options?.limit
        ? sortedFiles.slice(0, options.limit)
        : sortedFiles;

      const sessions: ClaudeHistorySession[] = [];

    for (const { file: filename } of filesToProcess) {
      const sessionId = filename.replace('.jsonl', '');
      const filePath = path.join(historyDir, filename);
      
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.trim());
        
        if (lines.length === 0) continue;

        const messages: ClaudeHistoryMessage[] = lines.map(line => JSON.parse(line));
        
        // Find session title using priority: summary > first user message > default
        const summaryMessage = messages.find(msg => msg.type === 'summary');
        let title = summaryMessage?.summary;
        
        // If no summary, try to extract from first user message
        if (!title) {
          const firstUserMessage = messages.find(msg => 
            msg.type === 'user' && 
            msg.message?.content && 
            !(msg as any).toolUseResult // Exclude tool result messages
          );
          
          if (firstUserMessage?.message?.content) {
            const content = firstUserMessage.message.content;
            let textContent = '';
            
            // Handle both string content and array content
            if (typeof content === 'string') {
              textContent = content;
            } else if (Array.isArray(content)) {
              // Find first text block in array
              const textBlock = content.find((block: any) => block.type === 'text');
              if (textBlock?.text) {
                textContent = textBlock.text;
              }
            }
            
            // Extract first 50 characters, remove newlines, trim
            if (textContent) {
              title = textContent
                .replace(/\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 50);
              // Add ellipsis if truncated
              if (textContent.length > 50) {
                title += '...';
              }
            }
          }
        }
        
        // Final fallback
        if (!title) {
          title = `会话 ${sessionId.slice(0, 8)}`;
        }

        // Skip automated task sessions early (before expensive message processing)
        if (options?.excludeAutomatedTasks && /^\[TASK_\w+\]/.test(title)) {
          continue;
        }

        // Process compact context messages before filtering
        const processedMessages = processCompactContextMessages(messages);

        // Filter user and assistant messages, but exclude tool_result-only user messages, isMeta messages, 
        // and internal tool messages with sourceToolUseID
        const conversationMessages = processedMessages.filter(msg => {
          // Filter out isMeta messages (rule 1)
          if ((msg as any).isMeta === true) {
            return false;
          }
          
          // Filter out internal tool messages with sourceToolUseID (e.g., Skill command loading messages)
          if ((msg as any).sourceToolUseID) {
            return false;
          }
          
          // Filter out /clear command messages and its related output messages
          if (msg.type === 'user' && msg.message?.content && typeof msg.message.content === 'string') {
            // Check for /clear command format
            if (msg.message.content.includes('<command-name>/clear</command-name>')) {
              return false;
            }
            // Check for /clear command's output (local-command-stdout that follows /clear command)
            if (msg.message.content.includes('<local-command-stdout></local-command-stdout>') && 
                msg.parentUuid) {
              // Find the parent message to check if it was a /clear command
              const parentMsg = messages.find(m => m.uuid === msg.parentUuid);
              if (parentMsg && parentMsg.message?.content && typeof parentMsg.message.content === 'string' &&
                  parentMsg.message.content.includes('<command-name>/clear</command-name>')) {
                return false;
              }
            }
          }
          
          if (msg.type === 'assistant') return true;
          if (msg.type === 'user') {
            // Check if this user message contains only tool_result
            if (msg.message?.content && Array.isArray(msg.message.content)) {
              const hasNonToolResult = msg.message.content.some((block: any) => block.type !== 'tool_result');
              return hasNonToolResult; // Only include if it has content other than tool_result
            }
            // Include user messages with string content or no content array
            return typeof msg.message?.content === 'string' || !msg.message?.content;
          }
          return false;
        });
        
        if (conversationMessages.length === 0) continue;

        // Convert messages to our format and group consecutive assistant messages
        const convertedMessages: any[] = [];
        let i = 0;

        while (i < conversationMessages.length) {
          const msg = conversationMessages[i];
          
          if (msg.type === 'user') {
            // Check if this is a local-command-stdout message
            const content = msg.message?.content;
            if (typeof content === 'string' && content.includes('<local-command-stdout>')) {
              // Extract content from local-command-stdout tag
              const outputMatch = content.match(/<local-command-stdout>([^<]*)<\/local-command-stdout>/);
              const displayOutput = outputMatch ? outputMatch[1] : '';
              
              // Create AI response message
              convertedMessages.push({
                id: `msg_${convertedMessages.length}_${msg.uuid}`,
                role: 'assistant',
                content: displayOutput,
                timestamp: new Date(msg.timestamp).getTime(),
                messageParts: [{
                  id: `part_0_${msg.uuid}`,
                  type: 'text',
                  content: displayOutput,
                  order: 0
                }]
              });
            } else {
              // Regular user message
              convertedMessages.push({
                id: `msg_${convertedMessages.length}_${msg.uuid}`,
                role: msg.message?.role || msg.type,
                content: extractContentFromClaudeMessage(msg, messages),
                timestamp: new Date(msg.timestamp).getTime(),
                messageParts: convertClaudeMessageToMessageParts(msg, messages)
              });
            }
            i++;
          } else if (msg.type === 'assistant') {
            // Find all consecutive assistant messages and combine them
            const assistantMessages = [msg];
            let j = i + 1;
            
            // Collect all consecutive assistant messages
            while (j < conversationMessages.length && conversationMessages[j].type === 'assistant') {
              assistantMessages.push(conversationMessages[j]);
              j++;
            }
            
            // Create combined assistant message
            const combinedMessage = {
              id: `msg_${convertedMessages.length}_${msg.uuid}`,
              role: 'assistant',
              content: '',
              timestamp: new Date(msg.timestamp).getTime(),
              messageParts: [] as any[]
            };
            
            // Combine all assistant message parts
            assistantMessages.forEach((assistantMsg) => {
              const textContent = extractContentFromClaudeMessage(assistantMsg, messages);
              const msgParts = convertClaudeMessageToMessageParts(assistantMsg, messages);
              
              combinedMessage.content += textContent;
              combinedMessage.messageParts.push(...msgParts.map(part => ({
                ...part,
                order: combinedMessage.messageParts.length + part.order
              })));
            });
            
            convertedMessages.push(combinedMessage);
            i = j; // Skip to next non-assistant message
          } else {
            i++;
          }
        }

        // Process tool results - find tool_result messages and associate them with tool_use
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.type === 'user' && msg.message?.content && Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                // Find the assistant message that contains the matching tool_use
                // Look backwards through conversation messages (not all messages)
                for (let j = convertedMessages.length - 1; j >= 0; j--) {
                  const assistantMsg = convertedMessages[j];
                  if (assistantMsg && assistantMsg.role === 'assistant') {
                    // Find the tool part with matching claudeId
                    const toolPart = assistantMsg.messageParts.find((part: any) => 
                      part.type === 'tool' && 
                      part.toolData && 
                      part.toolData.claudeId === block.tool_use_id
                    );
                    
                    if (toolPart && toolPart.toolData) {
                      toolPart.toolData.toolResult = typeof block.content === 'string' 
                        ? block.content 
                        : Array.isArray(block.content)
                          ? block.content.map((c: any) => c.text || String(c)).join('')
                          : JSON.stringify(block.content);
                      
                      // Check if the original message has toolUseResult (from Claude Code SDK)
                      if (msg.toolUseResult) {
                        toolPart.toolData.toolUseResult = msg.toolUseResult;
                        
                        // If this is a Task tool, read sub-agent message flow
                        if (toolPart.toolData.toolName === 'Task' && msg.toolUseResult.agentId) {
                          const subAgentId = msg.toolUseResult.agentId;
                          console.log(`🔧 [TASK] Found Task tool with sub-agent: ${subAgentId}`);
                          
                          const subAgentMessageFlow = readSubAgentMessageFlow(projectPath, subAgentId, sessionId);
                          
                          if (subAgentMessageFlow.length > 0) {
                            // Attach sub-agent message flow to toolUseResult
                            toolPart.toolData.toolUseResult = {
                              ...msg.toolUseResult,
                              subAgentMessageFlow
                            };
                            console.log(`✅ [TASK] Attached ${subAgentMessageFlow.length} sub-agent messages`);
                          }
                        }
                      }
                      
                      toolPart.toolData.isError = block.is_error || false;
                      break;
                    }
                  }
                }
              }
            }
          }
        }

        // Get timestamps
        const timestamps = conversationMessages
          .map(msg => new Date(msg.timestamp).getTime())
          .filter(t => !isNaN(t));
        
        const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : Date.now();
        const lastUpdated = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();

        const sessionData = {
          id: sessionId,
          title,
          createdAt: new Date(createdAt).toISOString(),
          lastUpdated: new Date(lastUpdated).toISOString(),
          messages: convertedMessages
        };

        sessions.push(sessionData);

      } catch (error) {
        console.error(`Failed to parse Claude history file ${filename}:`, error);
        continue;
      }
    }

      // Merge into the global map; earlier dirs have higher priority (don't overwrite)
      for (const session of sessions) {
        if (!sessionMap.has(session.id)) {
          sessionMap.set(session.id, session);
        }
      }
    }

    // Sort merged sessions by lastUpdated descending
    const sortedSessions = Array.from(sessionMap.values())
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());

    console.log(`📊 [DEBUG] Total unique sessions found: ${sortedSessions.length}`);

    return sortedSessions;

  } catch (error) {
    console.error('Failed to read Claude history sessions:', error);
    return [];
  }
}

/** Strip <think>...</think> tags from text, returning only the non-thinking content. */
function stripThinkTags(text: string): string {
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Handle orphaned </think> (SDK may strip opening <think>)
  const closeIdx = result.indexOf('</think>');
  if (closeIdx !== -1) {
    result = result.slice(closeIdx + '</think>'.length);
  }
  return result.trim();
}

/**
 * Split a text block containing <think>...</think> or orphaned </think> into
 * separate thinking and text message parts. Returns empty array if no think
 * tags are found (caller should fall back to a plain text part).
 */
function splitThinkTagsInText(text: string, blockIndex: number, uuid: string): any[] {
  if (!text) return [];

  const parts: any[] = [];
  let orderOffset = 0;

  // Case 1: Proper <think>...</think> tags
  const fullTagRegex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match;
  let found = false;

  while ((match = fullTagRegex.exec(text)) !== null) {
    found = true;
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) {
        parts.push({
          id: `part_${blockIndex}_t${orderOffset}_${uuid}`,
          type: 'text',
          content: before,
          order: blockIndex * 100 + orderOffset++,
        });
      }
    }
    const inner = match[1].trim();
    if (inner) {
      parts.push({
        id: `part_${blockIndex}_k${orderOffset}_${uuid}`,
        type: 'thinking',
        content: inner,
        order: blockIndex * 100 + orderOffset++,
      });
    }
    lastIndex = match.index + match[0].length;
  }

  if (found) {
    const tail = text.slice(lastIndex).trim();
    if (tail) {
      parts.push({
        id: `part_${blockIndex}_t${orderOffset}_${uuid}`,
        type: 'text',
        content: tail,
        order: blockIndex * 100 + orderOffset,
      });
    }
    return parts;
  }

  // Case 2: Orphaned </think> without opening <think>
  // The SDK sometimes strips the opening <think> tag, leaving content like:
  //   "lThe user is asking...\n</think>\n\n1+1 = 2"
  const closeIdx = text.indexOf('</think>');
  if (closeIdx !== -1) {
    const thinkingContent = text.slice(0, closeIdx).trim();
    const afterClose = text.slice(closeIdx + '</think>'.length).trim();
    if (thinkingContent) {
      parts.push({
        id: `part_${blockIndex}_k0_${uuid}`,
        type: 'thinking',
        content: thinkingContent,
        order: blockIndex * 100,
      });
    }
    if (afterClose) {
      parts.push({
        id: `part_${blockIndex}_t1_${uuid}`,
        type: 'text',
        content: afterClose,
        order: blockIndex * 100 + 1,
      });
    }
    return parts;
  }

  return [];
}

function extractContentFromClaudeMessage(msg: ClaudeHistoryMessage, allMessages: ClaudeHistoryMessage[] = []): string {
  if (!msg.message?.content) return '';
  
  // Handle both array and string content
  if (typeof msg.message.content === 'string') {
    const commandMatch = msg.message.content.match(/<command-name>(.+?)<\/command-name>/);
    if (commandMatch) {
      // Check for two different patterns:
      // Pattern 1: Parent is meta message (3-message local-command pattern)
      const parentMessage = msg.parentUuid ? allMessages.find(m => m.uuid === msg.parentUuid) : null;
      const isMetaParent = parentMessage && (parentMessage as any).isMeta === true;
      
      // Pattern 2: Child is meta message (2-message user-custom-command pattern)
      const childMessage = allMessages.find(m => m.parentUuid === msg.uuid);
      const isMetaChild = childMessage && (childMessage as any).isMeta === true;
      
      if (isMetaParent) {
        // 3-message pattern: return only command name
        return commandMatch[1];
      } else if (isMetaChild) {
        // 2-message pattern: return command name + args
        const argsMatch = msg.message.content.match(/<command-args>([^<]*)<\/command-args>/);
        const args = argsMatch ? argsMatch[1].trim() : '';
        return args ? `${commandMatch[1]} ${args}` : commandMatch[1];
      }
    }
    return stripThinkTags(msg.message.content);
  }
  
  if (Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block: any) => block.type === 'text' || block.type === 'thinking')
      .map((block: any) => stripThinkTags(block.text || block.thinking || ''))
      .join('');
  }
  
  return '';
}

function convertClaudeMessageToMessageParts(msg: ClaudeHistoryMessage, allMessages: ClaudeHistoryMessage[] = []): any[] {
  if (!msg.message?.content) return [];
  
  // Handle compact command messages
  if (msg.isCompactCommand) {
    return [{
      id: `part_0_${msg.uuid}`,
      type: 'command',
      content: '/compact',
      order: 0
    }];
  }
  
  // Handle compact summary messages
  if (msg.isCompactSummary) {
    return [{
      id: `part_0_${msg.uuid}`,
      type: 'compactSummary',
      content: msg.message.content,
      order: 0
    }];
  }
  
  // Handle string content
  if (typeof msg.message.content === 'string') {
    // Rule 2: Check for command message format and create command-specific part
    const commandMatch = msg.message.content.match(/<command-name>(.+?)<\/command-name>/);
    if (commandMatch) {
      // Check for two different patterns:
      // Pattern 1: Parent is meta message (3-message local-command pattern)
      const parentMessage = msg.parentUuid ? allMessages.find(m => m.uuid === msg.parentUuid) : null;
      const isMetaParent = parentMessage && (parentMessage as any).isMeta === true;
      
      // Pattern 2: Child is meta message (2-message user-custom-command pattern)
      const childMessage = allMessages.find(m => m.parentUuid === msg.uuid);
      const isMetaChild = childMessage && (childMessage as any).isMeta === true;
      
      if (isMetaParent) {
        // 3-message pattern: show only command name
        return [{
            id: `part_0_${msg.uuid}`,
            type: 'command',
            content: commandMatch[1], // Only the command name
            originalContent: msg.message.content, // Keep original for reference
            order: 0
          }];
      } else if (isMetaChild) {
        // 2-message pattern: show command name + args
        const argsMatch = msg.message.content.match(/<command-args>([^<]*)<\/command-args>/);
        const args = argsMatch ? argsMatch[1].trim() : '';
        const displayContent = args ? `${commandMatch[1]} ${args}` : commandMatch[1];
        
        return [{
            id: `part_0_${msg.uuid}`,
            type: 'command',
            content: displayContent, // Command name + args
            originalContent: msg.message.content, // Keep original for reference
            order: 0
          }];
      }
    }
    
    // Also handle <think> tags in string content (SDK may embed them here too)
    const stringParts = splitThinkTagsInText(msg.message.content, 0, msg.uuid);
    if (stringParts.length > 0) {
      return stringParts;
    }
    return [{
      id: `part_0_${msg.uuid}`,
      type: 'text',
      content: msg.message.content,
      order: 0
    }];
  }
  
  // Handle array content
  if (Array.isArray(msg.message.content)) {
    return msg.message.content.flatMap((block: any, index: number) => {
      if (block.type === 'text') {
        // Split text blocks containing <think>...</think> or orphaned </think> into
        // separate thinking + text parts. The Claude Agent SDK sometimes embeds
        // thinking content as <think> tags inside text blocks when using third-party
        // models (e.g. MiniMax M2.5), instead of structured thinking content blocks.
        const parts = splitThinkTagsInText(block.text, index, msg.uuid);
        if (parts.length > 0) {
          return parts;
        }
        return {
          id: `part_${index}_${msg.uuid}`,
          type: 'text',
          content: block.text,
          order: index
        };
      } else if (block.type === 'tool_use') {
        return {
          id: `part_${index}_${msg.uuid}`,
          type: 'tool',
          toolData: {
            id: `tool_${index}_${msg.uuid}`,
            claudeId: block.id,
            toolName: block.name,
            toolInput: block.input || {},
            toolResult: '', // Will be filled by tool_result if available
            isExecuting: false, // Historical data is not executing
            isError: false
          },
          order: index
        };
      } else if (block.type === 'tool_result') {
        // Skip tool_result blocks as they will be merged with tool_use blocks
        return null;
      } else if (block.type === 'image') {
        // Handle image content blocks
        return {
          id: `part_${index}_${msg.uuid}`,
          type: 'image',
          imageData: {
            id: `img_${index}_${msg.uuid}`,
            data: block.source?.data || '',
            mediaType: block.source?.media_type || 'image/jpeg',
            filename: `image_${index}.jpg` // Default filename since Claude history may not store original filename
          },
          order: index
        };
      } else if (block.type === 'thinking') {
        // Handle thinking content blocks
        return {
          id: `part_${index}_${msg.uuid}`,
          type: 'thinking',
          content: block.thinking || '',
          order: index
        };
      }
      // Handle other content types
      return {
        id: `part_${index}_${msg.uuid}`,
        type: 'unknown',
        content: JSON.stringify(block),
        order: index
      };
    }).filter((part: any) => part !== null);
  }
  
  return [];
}

// GET /api/sessions/_status - Get all sessions status (for monitoring)
router.get('/_status', (req, res) => {
  try {
    const sessionsInfo = sessionManager.getSessionsInfo();
    res.json({
      activeSessionCount: sessionManager.getActiveSessionCount(),
      sessions: sessionsInfo
    });
  } catch (error) {
    console.error('Failed to get sessions status:', error);
    res.status(500).json({ error: 'Failed to get sessions status' });
  }
});

// GET /api/sessions/by-project - Get sessions by project path (project-centric view)
router.get('/by-project', async (req, res) => {
  try {
    const projectPath = req.query.projectPath ? resolvePath(req.query.projectPath as string) : undefined;
    const { search } = req.query;
    const showAutomated = req.query.showAutomated === 'true';

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath query parameter is required' });
    }

    let sessions: any[] = [];
    const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
    const sessionOpts: ReadSessionsOptions = {
      excludeAutomatedTasks: !showAutomated,
      limit: 200,
    };

    if (defaultEngine.readSessions) {
      const engineSessions = await defaultEngine.readSessions(projectPath);
      sessions = engineSessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated,
        messageCount: session.messages.length,
      }));
      // Filter automated tasks from engine results too
      if (!showAutomated) {
        sessions = sessions.filter(s => !/^\[TASK_\w+\]/.test(s.title || ''));
      }
    } else {
      const claudeSessions = readClaudeHistorySessions(projectPath, sessionOpts);
      sessions = claudeSessions.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated,
        messageCount: session.messages.length,
      }));
    }

    // Merge live sessions from SessionManager that target this projectPath
    const liveSessionsInfo = sessionManager.getSessionsInfo();
    const existingIds = new Set(sessions.map(s => s.id));
    for (const live of liveSessionsInfo) {
      if (live.projectPath === projectPath && !existingIds.has(live.sessionId)) {
        sessions.push({
          id: live.sessionId,
          agentId: live.agentId,
          title: live.sessionTitle || `Session ${live.sessionId.slice(0, 8)}`,
          createdAt: live.lastActivity,
          lastUpdated: live.lastActivity,
          messageCount: 0,
          isActive: live.isActive,
        });
      }
    }

    // Enrich with live status and fresher timestamps
    const liveMap = new Map(liveSessionsInfo.map(s => [s.sessionId, s]));
    sessions = sessions.map(s => {
      const live = liveMap.get(s.id);
      let lastUpdated = s.lastUpdated;
      if (live?.lastActivity) {
        const liveTime = typeof live.lastActivity === 'number'
          ? new Date(live.lastActivity).toISOString()
          : live.lastActivity;
        if (new Date(liveTime).getTime() > new Date(lastUpdated).getTime()) {
          lastUpdated = liveTime;
        }
      }
      return {
        ...s,
        lastUpdated,
        agentId: s.agentId || live?.agentId || undefined,
        isActive: live ? live.isActive : false,
        isProcessing: live ? sessionManager.isSessionBusy(s.id) : false,
      };
    });

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim().toLowerCase();
      sessions = sessions.filter(s => s.title?.toLowerCase().includes(term));
    }

    res.json({ sessions: sessionNameService.applyNames(sessions), projectPath });
  } catch (error) {
    console.error('Failed to get project sessions:', error);
    res.status(500).json({ error: 'Failed to retrieve project sessions' });
  }
});

// PATCH /api/sessions/by-project/:sessionId - 重命名会话（Project 视图）
router.patch('/by-project/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed || trimmed.length > 100) {
      return res.status(400).json({ error: 'title 无效：不能为空且不超过 100 字符' });
    }
    await sessionNameService.setName(sessionId, trimmed);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to rename session:', error);
    res.status(500).json({ error: 'Failed to rename session' });
  }
});

// DELETE /api/sessions/by-project/:sessionId - Delete a session by project path
router.delete('/by-project/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const projectPath = req.query.projectPath ? resolvePath(req.query.projectPath as string) : undefined;

    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath query parameter is required' });
    }

    // Try engine-level deletion first
    const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
    if (defaultEngine.deleteSession) {
      const deleted = await defaultEngine.deleteSession(projectPath, sessionId);
      if (deleted) {
        // Also clean up from in-memory SessionManager if active
        await sessionManager.removeSession(sessionId).catch(() => {});
        return res.json({ success: true });
      }
    }

    // Fallback: delete Claude history .jsonl file
    const claudeProjectPath = convertProjectPathToClaudeFormat(projectPath);
    const allDirs = getAllProjectsDirs();
    let deleted = false;

    for (const projectsDir of allDirs) {
      const historyDir = path.join(projectsDir, claudeProjectPath);
      const filePath = path.join(historyDir, `${sessionId}.jsonl`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️  Deleted session file: ${filePath}`);
        deleted = true;
        break;
      }
    }

    // Also try .cc-sessions storage
    if (!deleted) {
      const agentStorage = new AgentStorage(projectPath);
      // Try deleting from all agent subdirectories
      const sessionsBaseDir = path.join(projectPath, '.cc-sessions');
      if (fs.existsSync(sessionsBaseDir)) {
        const agentDirs = fs.readdirSync(sessionsBaseDir).filter(f => {
          try { return fs.statSync(path.join(sessionsBaseDir, f)).isDirectory(); } catch { return false; }
        });
        for (const agentDir of agentDirs) {
          const filePath = path.join(sessionsBaseDir, agentDir, `${sessionId}.json`);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Deleted .cc-sessions file: ${filePath}`);
            deleted = true;
            break;
          }
        }
      }
    }

    // Clean up from in-memory SessionManager
    await sessionManager.removeSession(sessionId).catch(() => {});

    // Clean up custom name mapping if present
    sessionNameService.clearName(sessionId).catch(() => {});

    res.json({ success: deleted });
  } catch (error) {
    console.error('Failed to delete project session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// GET /api/sessions/:agentId - Get agent sessions
router.get('/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const { search } = req.query;
    const projectPath = req.query.projectPath ? resolvePath(req.query.projectPath as string) : undefined;
    
    console.log(`🔍 [DEBUG] Getting sessions for agent: ${agentId}`);
    console.log(`🔍 [DEBUG] Search term: "${search}"`);
    console.log(`🔍 [DEBUG] Project path: "${projectPath}"`);
    
    // Verify agent exists
    const agent = globalAgentStorage.getAgent(agentId);
    if (!agent) {
      console.log(`❌ [DEBUG] Agent not found: ${agentId}`);
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    console.log(`✅ [DEBUG] Agent found: ${agent.name} (${agent.id})`);
    
    let sessions: any[] = [];
    
    // If projectPath is provided, read from history via engine interface
    if (projectPath) {
      const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
      
      if (defaultEngine.readSessions) {
        // Use engine's own session reader
        console.log(`📂 [DEBUG] Reading ${defaultEngine.type} history sessions for project:`, projectPath);
        const engineSessions = await defaultEngine.readSessions(projectPath);
        console.log(`📊 [DEBUG] Found ${engineSessions.length} sessions via ${defaultEngine.type} engine`);
        
        sessions = engineSessions.map((session) => ({
          id: session.id,
          agentId: agentId,
          title: session.title,
          createdAt: session.createdAt,
          lastUpdated: session.lastUpdated,
          messageCount: session.messages.length
        }));
      } else {
        // Fallback: Read from Claude Code history (Claude engine hasn't migrated yet)
        console.log('📂 [DEBUG] Reading Claude history sessions for project:', projectPath);
        const claudeSessions = readClaudeHistorySessions(projectPath);
        console.log(`📊 [DEBUG] Found ${claudeSessions.length} raw Claude sessions`);
        
        sessions = claudeSessions.map((session) => ({
          id: session.id,
          agentId: agentId,
          title: session.title,
          createdAt: session.createdAt,
          lastUpdated: session.lastUpdated,
          messageCount: session.messages.length
        }));
      }
    } else {
      console.log(`📁 [DEBUG] Using project-specific AgentStorage for sessions`);
      // Use project-specific AgentStorage for sessions (existing behavior)
      const agentStorage = getAgentStorageForRequest(req);
      const agentSessions = agentStorage.getAgentSessions(agentId, search as string);
      console.log(`📊 [DEBUG] Found ${agentSessions.length} sessions from AgentStorage`);
      
      sessions = agentSessions.map((session, index) => {
        const mappedSession = {
          id: session.id,
          agentId: session.agentId,
          title: session.title,
          createdAt: session.createdAt,
          lastUpdated: session.lastUpdated,
          messageCount: session.messages.length
        };
        
        console.log(`🔄 [DEBUG] Mapped AgentStorage session ${index + 1}:`, mappedSession);
        return mappedSession;
      });

      // Fallback: also read from Claude/engine history using agent's effective
      // working directory. This catches sessions created via /api/agents/chat
      // that bypass AgentStorage (e.g. workspace mode).
      const effectivePath = agent.workingDirectory
        ? path.resolve(process.cwd(), resolvePath(agent.workingDirectory))
        : process.cwd();

      const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
      let historySessions: typeof sessions = [];

      try {
        if (defaultEngine.readSessions) {
          console.log(`📂 [DEBUG] Reading ${defaultEngine.type} history for effective path:`, effectivePath);
          const engineSessions = await defaultEngine.readSessions(effectivePath);
          historySessions = engineSessions.map((s) => ({
            id: s.id,
            agentId,
            title: s.title,
            createdAt: s.createdAt,
            lastUpdated: s.lastUpdated,
            messageCount: s.messages.length
          }));
        } else {
          console.log(`📂 [DEBUG] Reading Claude history for effective path:`, effectivePath);
          const claudeSessions = readClaudeHistorySessions(effectivePath);
          historySessions = claudeSessions.map((s) => ({
            id: s.id,
            agentId,
            title: s.title,
            createdAt: s.createdAt,
            lastUpdated: s.lastUpdated,
            messageCount: s.messages.length
          }));
        }
        console.log(`📊 [DEBUG] Found ${historySessions.length} sessions from history fallback`);
      } catch (historyErr) {
        console.warn('⚠️ Failed to read history sessions:', historyErr);
      }

      const existingIds = new Set(sessions.map(s => s.id));
      for (const hs of historySessions) {
        if (!existingIds.has(hs.id)) {
          sessions.push(hs);
          existingIds.add(hs.id);
        }
      }
    }
    
    // Merge in active sessions from SessionManager for this agent.
    // This ensures sessions that exist only in memory (e.g. meta-agent sessions
    // where no history file has been written yet) still appear in the list.
    const liveSessionsInfo = sessionManager.getSessionsInfo();
    const existingSessionIds = new Set(sessions.map(s => s.id));
    for (const live of liveSessionsInfo) {
      if (live.agentId === agentId && !existingSessionIds.has(live.sessionId)) {
        sessions.push({
          id: live.sessionId,
          agentId,
          title: live.sessionTitle || `Session ${live.sessionId.slice(0, 8)}`,
          createdAt: live.lastActivity,
          lastUpdated: live.lastActivity,
          messageCount: 0,
        });
      }
    }

    // Apply search filter if provided
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      sessions = sessions.filter(session =>
        session.title.toLowerCase().includes(searchTerm)
      );
    }

    // Enrich sessions with live status from SessionManager
    const liveSessionMap = new Map(liveSessionsInfo.map(s => [s.sessionId, s]));

    sessions = sessions.map(session => {
      const live = liveSessionMap.get(session.id);
      return {
        ...session,
        isActive: live ? live.isActive : false,
        isProcessing: live ? sessionManager.isSessionBusy(session.id) : false,
      };
    });
    
    res.json({ sessions: sessionNameService.applyNames(sessions) });
  } catch (error) {
    console.error('Failed to get agent sessions:', error);
    res.status(500).json({ error: 'Failed to retrieve agent sessions' });
  }
});

// GET /api/sessions/:agentId/:sessionId/messages - Get session messages
router.get('/:agentId/:sessionId/messages', async (req, res) => {
  try {
    const { agentId, sessionId } = req.params;
    const projectPath = req.query.projectPath ? resolvePath(req.query.projectPath as string) : undefined;
    
    let session: any = null;
    
    // If projectPath is provided, read from history via engine interface
    if (projectPath) {
      const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
      
      if (defaultEngine.readSession) {
        // Use engine's own session reader (efficient: reads single file)
        console.log(`📂 [${defaultEngine.type}] Reading session ${sessionId} in project:`, projectPath);
        session = await defaultEngine.readSession(projectPath, sessionId);
        
        if (session) {
          console.log(`📨 [${defaultEngine.type}] Found session with ${session.messages?.length || 0} messages`);
          session = {
            ...session,
            agentId: agentId
          };
        }
      } else {
        // Fallback: Read from Claude Code history (Claude engine hasn't migrated yet)
        console.log('Reading Claude history messages for session:', sessionId, 'in project:', projectPath);
        const claudeSessions = readClaudeHistorySessions(projectPath);
        session = claudeSessions.find(s => s.id === sessionId);
        
        if (session) {
          console.log('📨 Found session with', session.messages?.length || 0, 'messages');
          session = {
            ...session,
            agentId: agentId
          };
        }
      }
    } else {
      // Use project-specific AgentStorage for sessions (existing behavior)
      const agentStorage = getAgentStorageForRequest(req);
      session = agentStorage.getSession(agentId, sessionId);
    }
    
    // If session not found in history/storage, check if it exists as a live
    // session in SessionManager. Use the live session's actual projectPath to
    // read Claude history from the correct directory.
    if (!session) {
      const liveClaudeSession = sessionManager.getSession(sessionId);
      if (liveClaudeSession) {
        const liveProjectPath = liveClaudeSession.getProjectPath();
        const liveClaudeSessionId = liveClaudeSession.getClaudeSessionId();
        const lookupSessionId = liveClaudeSessionId || sessionId;
        
        console.log(`📋 [LIVE] Session ${sessionId} found in SessionManager, projectPath=${liveProjectPath}, claudeSessionId=${liveClaudeSessionId}`);
        
        // Try to read messages from Claude history using the live session's projectPath
        if (liveProjectPath) {
          const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
          if (defaultEngine.readSession) {
            session = await defaultEngine.readSession(liveProjectPath, lookupSessionId);
          }
          if (!session) {
            const claudeSessions = readClaudeHistorySessions(liveProjectPath);
            session = claudeSessions.find(s => s.id === lookupSessionId);
          }
          if (session) {
            console.log(`� [LIVE] Found session history with ${session.messages?.length || 0} messages`);
            session = { ...session, agentId };
          }
        }
        
        // If still no history on disk, return session metadata with empty messages
        if (!session) {
          console.log(`📋 [LIVE] No history file yet for session ${sessionId}, returning empty messages`);
          return res.json({
            sessionId,
            agentId,
            title: liveClaudeSession.getSessionTitle() || `Session ${sessionId.slice(0, 8)}`,
            messages: []
          });
        }
      } else {
        // Last resort: try reading from Claude/engine history using the agent's
        // effective working directory (covers sessions that were created via chat
        // and whose live ClaudeSession has already been cleaned up).
        const agent = globalAgentStorage.getAgent(agentId);
        const effectivePath = agent?.workingDirectory
          ? path.resolve(process.cwd(), resolvePath(agent.workingDirectory))
          : process.cwd();

        console.log(`🔍 [FALLBACK] Trying history at effective path: ${effectivePath} for session ${sessionId}`);

        const defaultEngine = engineManager.getEngine(engineManager.getDefaultEngineType());
        if (defaultEngine.readSession) {
          session = await defaultEngine.readSession(effectivePath, sessionId);
        }
        if (!session) {
          const claudeSessions = readClaudeHistorySessions(effectivePath);
          session = claudeSessions.find(s => s.id === sessionId) || null;
        }
        if (session) {
          console.log(`✅ [FALLBACK] Found session with ${session.messages?.length || 0} messages`);
          session = { ...session, agentId };
        } else {
          return res.status(404).json({ error: 'Session not found' });
        }
      }
    }
    
    res.json({ 
      sessionId: session.id,
      agentId: session.agentId,
      title: session.title,
      messages: session.messages 
    });
  } catch (error) {
    console.error('Failed to get session messages:', error);
    res.status(500).json({ error: 'Failed to retrieve session messages' });
  }
});

// POST /api/sessions/:agentId - Create new session
router.post('/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Verify agent exists
    const agent = globalAgentStorage.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Use project-specific AgentStorage for sessions
    const agentStorage = getAgentStorageForRequest(req);
    const session = agentStorage.createSession(agentId, req.body.title);
    res.json({ sessionId: session.id, session });
  } catch (error) {
    console.error('Failed to create agent session:', error);
    res.status(500).json({ error: 'Failed to create agent session' });
  }
});

// PATCH /api/sessions/:agentId/:sessionId - 重命名会话（Agent 视图）
router.patch('/:agentId/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    const trimmed = typeof title === 'string' ? title.trim() : '';
    if (!trimmed || trimmed.length > 100) {
      return res.status(400).json({ error: 'title 无效：不能为空且不超过 100 字符' });
    }
    await sessionNameService.setName(sessionId, trimmed);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to rename session:', error);
    res.status(500).json({ error: 'Failed to rename session' });
  }
});

// DELETE /api/sessions/:agentId/:sessionId - Delete session
router.delete('/:agentId/:sessionId', (req, res) => {
  try {
    const { agentId, sessionId } = req.params;
    
    // Use project-specific AgentStorage for sessions
    const agentStorage = getAgentStorageForRequest(req);
    const deleted = agentStorage.deleteSession(agentId, sessionId);

    // Clean up custom name mapping if present
    sessionNameService.clearName(sessionId).catch(() => {});

    res.json({ success: deleted });
  } catch (error) {
    console.error('Failed to delete agent session:', error);
    res.status(500).json({ error: 'Failed to delete agent session' });
  }
});

// POST /api/sessions/:agentId/:sessionId/heartbeat - Update session heartbeat
router.post('/:agentId/:sessionId/heartbeat', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Update heartbeat in SessionManager
    const success = sessionManager.updateHeartbeat(sessionId);
    
    if (success) {
      res.json({ 
        success: true, 
        timestamp: Date.now(),
        message: 'Heartbeat updated successfully'
      });
    } else {
      res.status(404).json({ 
        success: false,
        error: 'Session not found or not active'
      });
    }
  } catch (error) {
    console.error('Failed to update session heartbeat:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update heartbeat' 
    });
  }
});

// DELETE /api/sessions/:agentId/:sessionId/cleanup - Manual cleanup session
router.delete('/:agentId/:sessionId/cleanup', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Manual cleanup session in SessionManager
    const success = await sessionManager.manualCleanupSession(sessionId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Session cleaned up successfully'
      });
    } else {
      res.status(404).json({ 
        success: false,
        error: 'Session not found'
      });
    }
  } catch (error) {
    console.error('Failed to cleanup session:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to cleanup session' 
    });
  }
});

// GET /api/sessions/:agentId/:sessionId/check - Check if session exists in SessionManager
router.get('/:agentId/:sessionId/check', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Check if session exists in SessionManager
    const exists = sessionManager.hasActiveSession(sessionId);
    
    res.json({ 
      exists,
      sessionId,
      message: exists ? 'Session is active in SessionManager' : 'Session not found in SessionManager'
    });
  } catch (error) {
    console.error('Failed to check session:', error);
    res.status(500).json({ 
      exists: false,
      error: 'Failed to check session' 
    });
  }
});

export default router;
