import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentStorage } from '../services/agentStorage';
import { ClaudeHistoryMessage, ClaudeHistorySession } from '../types/claude-history';
// Note: Cursor/CodeBuddy session reading is now handled via engine.readSessions()
// Claude session reading still uses readClaudeHistorySessions() below (pending migration)
import { sessionManager } from '../services/sessionManager';
import { getProjectsDir, getAllProjectsDirs } from '../config/sdkConfig.js';
// Note: getEngineType is no longer needed here - engine routing is handled via engineManager
import { engineManager } from '../engines/index.js';
import { resolvePath } from '../config/paths.js';

const router: express.Router = express.Router();

// Storage instances
const globalAgentStorage = new AgentStorage();

// Helper functions for reading Agent SDK history from projects directory
function convertProjectPathToClaudeFormat(projectPath: string): string {
  // First, resolve symlinks to get the real path
  // This is important because Claude CLI stores sessions using the real path
  let resolvedPath = projectPath;
  try {
    resolvedPath = fs.realpathSync(projectPath);
    if (resolvedPath !== projectPath) {
      console.log(`🔗 [DEBUG] Resolved symlink: ${projectPath} -> ${resolvedPath}`);
    }
  } catch (error) {
    // If the path doesn't exist or can't be resolved, use the original path
    console.log(`⚠️ [DEBUG] Could not resolve path: ${projectPath}, using original`);
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
function readSubAgentMessageFlow(projectPath: string, agentId: string): SubAgentMessage[] {
  try {
    const claudeProjectPath = convertProjectPathToClaudeFormat(projectPath);
    // Search all directories (macOS EMFILE workaround may store files in custom dir)
    let agentFilePath: string | null = null;
    for (const projectsDir of getAllProjectsDirs()) {
      const historyDir = path.join(projectsDir, claudeProjectPath);
      const candidatePath = path.join(historyDir, `agent-${agentId}.jsonl`);
      if (fs.existsSync(candidatePath)) {
        agentFilePath = candidatePath;
        break;
      }
    }

    if (!agentFilePath) {
      console.log(`❌ [SUBAGENT] Sub-agent file not found for agentId: ${agentId}`);
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


function readClaudeHistorySessions(projectPath: string): ClaudeHistorySession[] {
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

      const sessions: ClaudeHistorySession[] = [];

    for (const filename of jsonlFiles) {
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
                          
                          const subAgentMessageFlow = readSubAgentMessageFlow(projectPath, subAgentId);
                          
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
    return msg.message.content;
  }
  
  if (Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((block: any) => block.type === 'text' || block.type === 'thinking')
      .map((block: any) => block.text || block.thinking || '')
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
    
    return [{
      id: `part_0_${msg.uuid}`,
      type: 'text',
      content: msg.message.content,
      order: 0
    }];
  }
  
  // Handle array content
  if (Array.isArray(msg.message.content)) {
    return msg.message.content.map((block: any, index: number) => {
      if (block.type === 'text') {
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
    }
    
    // Apply search filter if provided
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      sessions = sessions.filter(session =>
        session.title.toLowerCase().includes(searchTerm)
      );
    }

    // Enrich sessions with live status from SessionManager
    const liveSessionsInfo = sessionManager.getSessionsInfo();
    const liveSessionMap = new Map(liveSessionsInfo.map(s => [s.sessionId, s]));

    sessions = sessions.map(session => {
      const live = liveSessionMap.get(session.id);
      return {
        ...session,
        isActive: live ? live.isActive : false,
        isProcessing: live ? sessionManager.isSessionBusy(session.id) : false,
      };
    });
    
    res.json({ sessions });
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
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
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

// DELETE /api/sessions/:agentId/:sessionId - Delete session
router.delete('/:agentId/:sessionId', (req, res) => {
  try {
    const { agentId, sessionId } = req.params;
    
    // Use project-specific AgentStorage for sessions
    const agentStorage = getAgentStorageForRequest(req);
    const deleted = agentStorage.deleteSession(agentId, sessionId);
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
