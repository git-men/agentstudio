/**
 * Unit tests for Cursor Agent Transcript Parser
 * 
 * Tests parsing of ~/.cursor/projects/<path>/agent-transcripts/*.txt files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs and os modules
vi.mock('fs');
vi.mock('os');

// Import the functions to test (will be mocked module)
// We need to import after mocking
const mockFs = vi.mocked(fs);
const mockOs = vi.mocked(os);

// Sample transcript content for testing
const sampleTranscriptSimple = `user:
Hello, can you help me with a task?

assistant:
[Thinking] The user is asking for help with a task. Let me understand what they need.
Of course! I'd be happy to help. What task would you like assistance with?
`;

const sampleTranscriptWithToolCalls = `user:
<user_query>
Please read the file config.json
</user_query>

assistant:
[Thinking] The user wants me to read a configuration file. Let me use the Read tool.
I'll read the config.json file for you.
[Tool call] Read
  path: /path/to/config.json

[Tool result] Read

assistant:
[Thinking] Got the file contents. Let me show the user.
Here's the contents of config.json:
\`\`\`json
{"name": "test"}
\`\`\`
`;

const sampleTranscriptMultipleMessages = `user:
First question

assistant:
First answer

user:
Second question

assistant:
[Thinking] Processing second question
Second answer with thinking
`;

const sampleTranscriptWithMcpTool = `user:
Send a message using hitl

assistant:
[Thinking] I'll use the MCP tool to send a message.
Let me send the message.
[Tool call] CallMcpTool
  server: user-hitl-hil
  toolName: send_message_only
  arguments: {"message":"Hello from test"}

[Tool result] CallMcpTool

assistant:
Message sent successfully!
`;

describe('cursorIdeAgentParser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOs.homedir.mockReturnValue('/Users/testuser');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseTranscriptFile', () => {
    it('should parse a simple user-assistant conversation', async () => {
      // Dynamic import to work with mocked modules
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptSimple);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'test-session-id');
      
      expect(session).not.toBeNull();
      expect(session?.id).toBe('test-session-id');
      expect(session?.messages).toHaveLength(2);
      
      // Check user message
      const userMsg = session?.messages[0];
      expect(userMsg?.role).toBe('user');
      expect(userMsg?.content).toContain('Hello, can you help me with a task?');
      
      // Check assistant message
      const assistantMsg = session?.messages[1];
      expect(assistantMsg?.role).toBe('assistant');
      expect(assistantMsg?.messageParts.some(p => p.type === 'thinking')).toBe(true);
      expect(assistantMsg?.messageParts.some(p => p.type === 'text')).toBe(true);
    });

    it('should parse tool calls correctly', async () => {
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptWithToolCalls);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'test-session-id');
      
      expect(session).not.toBeNull();
      
      // Find message with tool call
      const msgWithTool = session?.messages.find(m => 
        m.messageParts.some(p => p.type === 'tool')
      );
      
      expect(msgWithTool).toBeDefined();
      
      const toolPart = msgWithTool?.messageParts.find(p => p.type === 'tool');
      expect(toolPart?.toolData?.toolName).toBe('Read');
      expect(toolPart?.toolData?.toolInput).toHaveProperty('path');
    });

    it('should parse multiple conversation turns', async () => {
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptMultipleMessages);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'test-session-id');
      
      expect(session).not.toBeNull();
      expect(session?.messages).toHaveLength(4);
      
      // Verify alternating user/assistant pattern
      expect(session?.messages[0].role).toBe('user');
      expect(session?.messages[1].role).toBe('assistant');
      expect(session?.messages[2].role).toBe('user');
      expect(session?.messages[3].role).toBe('assistant');
    });

    it('should handle MCP tool calls', async () => {
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptWithMcpTool);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'test-session-id');
      
      expect(session).not.toBeNull();
      
      // Find MCP tool call
      const msgWithMcp = session?.messages.find(m => 
        m.messageParts.some(p => p.type === 'tool' && p.toolData?.toolName === 'CallMcpTool')
      );
      
      expect(msgWithMcp).toBeDefined();
      
      const mcpToolPart = msgWithMcp?.messageParts.find(p => 
        p.type === 'tool' && p.toolData?.toolName === 'CallMcpTool'
      );
      expect(mcpToolPart?.toolData?.toolInput).toHaveProperty('server');
      expect(mcpToolPart?.toolData?.toolInput).toHaveProperty('toolName');
    });

    it('should return null for non-existent files', async () => {
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(false);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'non-existent');
      
      expect(session).toBeNull();
    });

    it('should extract title from first user message', async () => {
      const { readCursorSession } = await import('../cursorIdeAgentParser.js');
      
      const transcriptWithLongMessage = `user:
This is a very long user message that should be truncated to create a reasonable title for the session

assistant:
Short response
`;
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(transcriptWithLongMessage);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const session = readCursorSession('/test/project', 'test-session-id');
      
      expect(session).not.toBeNull();
      expect(session?.title.length).toBeLessThanOrEqual(53); // 50 chars + "..."
    });
  });

  describe('readCursorHistorySessions', () => {
    it('should read all transcript files from directory', async () => {
      const { readCursorHistorySessions } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'session1.txt',
        'session2.txt',
        '.hidden.txt', // Should be filtered out
      ] as any);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptSimple);
      mockFs.statSync.mockReturnValue({
        birthtime: new Date('2024-01-01T10:00:00Z'),
        mtime: new Date('2024-01-01T11:00:00Z'),
      } as fs.Stats);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const sessions = readCursorHistorySessions('/test/project');
      
      expect(sessions).toHaveLength(2); // .hidden.txt should be filtered
      expect(sessions[0].id).toBe('session1');
      expect(sessions[1].id).toBe('session2');
    });

    it('should return empty array for non-existent directory', async () => {
      const { readCursorHistorySessions } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(false);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const sessions = readCursorHistorySessions('/test/nonexistent');
      
      expect(sessions).toHaveLength(0);
    });

    it('should sort sessions by lastUpdated descending', async () => {
      const { readCursorHistorySessions } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['old.txt', 'new.txt'] as any);
      mockFs.readFileSync.mockReturnValue(sampleTranscriptSimple);
      
      // Return different mtimes for different files
      mockFs.statSync.mockImplementation((filePath) => {
        const filename = path.basename(filePath as string);
        if (filename === 'new.txt') {
          return {
            birthtime: new Date('2024-01-02T10:00:00Z'),
            mtime: new Date('2024-01-02T11:00:00Z'),
          } as fs.Stats;
        }
        return {
          birthtime: new Date('2024-01-01T10:00:00Z'),
          mtime: new Date('2024-01-01T11:00:00Z'),
        } as fs.Stats;
      });
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      const sessions = readCursorHistorySessions('/test/project');
      
      expect(sessions).toHaveLength(2);
      // Newer session should be first
      expect(sessions[0].id).toBe('new');
      expect(sessions[1].id).toBe('old');
    });
  });

  describe('path conversion', () => {
    it('should convert project path to Cursor format', async () => {
      const { readCursorHistorySessions } = await import('../cursorIdeAgentParser.js');
      
      mockFs.existsSync.mockReturnValue(false);
      mockFs.realpathSync.mockImplementation((p) => p as string);
      
      // This should construct path like: ~/.cursor/projects/Users-test-project/agent-transcripts/
      readCursorHistorySessions('/Users/test/project');
      
      // Verify the correct path was checked
      expect(mockFs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('Users-test-project')
      );
    });
  });
});
