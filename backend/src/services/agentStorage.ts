import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { AgentConfig, AgentSession, AgentMessage, BUILTIN_AGENTS } from '../types/agents';
import { Options, query } from '@anthropic-ai/claude-agent-sdk';
import { AGENTS_DIR } from '../config/paths.js';

/**
 * Parse an agent from a .md file with YAML frontmatter.
 * Returns null if the file has no frontmatter or cannot be parsed.
 */
function parseAgentMdFile(filePath: string): AgentConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = matter(content);
    const fm = parsed.data as Record<string, unknown>;
    if (!fm || Object.keys(fm).length === 0) return null;

    const markdownBody = parsed.content.trim();
    const preset = fm.preset as string | undefined;
    let systemPrompt: unknown;
    if (preset) {
      systemPrompt = { type: 'preset', preset, ...(markdownBody ? { append: markdownBody } : {}) };
    } else {
      systemPrompt = markdownBody || (fm.systemPrompt as string);
    }

    const { preset: _preset, ...restFm } = fm;
    return { ...restFm, systemPrompt } as unknown as AgentConfig;
  } catch {
    return null;
  }
}

export class AgentStorage {
  private agentsDir: string;
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this.agentsDir = AGENTS_DIR;
    this.workingDir = workingDir;
    
      // Ensure directories exist
      this.ensureDirectoriesExist();
      
      // Initialize built-in agents if not exists
      this.initializeBuiltinAgents();
  }

  private ensureDirectoriesExist(): void {
    // Ensure global agents directory exists
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    }
  }

  private getSessionsDir(): string {
    const sessionsDir = path.join(this.workingDir, '.cc-sessions');
    // console.log('AgentStorage getSessionsDir - workingDir:', this.workingDir, 'sessionsDir:', sessionsDir);
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    return sessionsDir;
  }

  /**
   * Get the builtin agents source directory
   * Priority: npm package dir > project dir
   */
  private getBuiltinAgentsSourceDir(): string | null {
    // 1. Check npm package directory (when installed via npm)
    const npmAgentsDir = path.resolve(__dirname, '../../agents');
    if (fs.existsSync(npmAgentsDir)) {
      return npmAgentsDir;
    }
    
    // 2. Check development project directory
    const cwd = process.cwd();
    const projectAgentsDir = path.join(cwd, 'agents');
    if (fs.existsSync(projectAgentsDir)) {
      return projectAgentsDir;
    }
    
    return null;
  }

  /**
   * Copy a directory recursively
   */
  private copyDirectory(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Initialize built-in agents from source directory and hardcoded list
   */
  private initializeBuiltinAgents(): void {
    // 1. Initialize from source agents directory (scripts, views, etc.)
    const sourceAgentsDir = this.getBuiltinAgentsSourceDir();
    if (sourceAgentsDir) {
      try {
        const agentDirs = fs.readdirSync(sourceAgentsDir, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory());
        
        for (const agentDir of agentDirs) {
          const agentId = agentDir.name;
          const srcDir = path.join(sourceAgentsDir, agentId);
          const destDir = path.join(this.agentsDir, agentId);
          
          // Only copy if destination doesn't exist
          if (!fs.existsSync(destDir)) {
            console.log(`[AgentStorage] Copying builtin agent: ${agentId} -> ${destDir}`);
            this.copyDirectory(srcDir, destDir);
          }
          
          // Also create the agent config file if it exists in source
          // Priority: agent.md (preferred) > agent.json (legacy)
          const sourceAgentMd = path.join(srcDir, 'agent.md');
          const sourceAgentJson = path.join(srcDir, 'agent.json');
          const destAgentJsonConfig = path.join(this.agentsDir, `${agentId}.json`);
          const destAgentMdConfig = path.join(this.agentsDir, `${agentId}.md`);

          if (fs.existsSync(sourceAgentMd) && !fs.existsSync(destAgentMdConfig) && !fs.existsSync(destAgentJsonConfig)) {
            fs.copyFileSync(sourceAgentMd, destAgentMdConfig);
            console.log(`[AgentStorage] Copied agent config: ${agentId}.md`);
          } else if (fs.existsSync(sourceAgentJson) && !fs.existsSync(destAgentJsonConfig)) {
            const agentConfig = JSON.parse(fs.readFileSync(sourceAgentJson, 'utf-8'));
            const now = new Date().toISOString();
            const fullAgent: AgentConfig = {
              version: '1.0.0',
              maxTurns: 25,
              permissionMode: 'acceptEdits',
              author: agentConfig.author || 'AgentStudio System',
              createdAt: now,
              updatedAt: now,
              source: 'local',
              enabled: true,
              ...agentConfig
            } as AgentConfig;
            
            this.saveAgent(fullAgent);
            console.log(`[AgentStorage] Created agent config: ${agentId}.json`);
          }
        }
      } catch (error) {
        console.error('[AgentStorage] Error initializing builtin agents from source:', error);
      }
    }

    // 2. Initialize hardcoded BUILTIN_AGENTS (like claude-code)
    BUILTIN_AGENTS.forEach(agentTemplate => {
      const agentPath = path.join(this.agentsDir, `${agentTemplate.id}.json`);
      if (!fs.existsSync(agentPath)) {
        const now = new Date().toISOString();
        const fullAgent: AgentConfig = {
          version: '1.0.0',
          maxTurns: 25,
          permissionMode: 'acceptEdits',
          author: 'Claude Agent System',
          createdAt: now,
          updatedAt: now,
          ...agentTemplate
        } as AgentConfig;
        
        this.saveAgent(fullAgent);
      }
    });
  }

  // Agent management
  getAllAgents(): AgentConfig[] {
    const allFiles = fs.readdirSync(this.agentsDir)
      .filter(file => file.endsWith('.json') || file.endsWith('.md'));

    // Collect agents; .json takes precedence over .md for the same id
    const agentMap = new Map<string, AgentConfig>();

    // Process .md files first (lower priority)
    for (const file of allFiles.filter(f => f.endsWith('.md'))) {
      const agentId = file.slice(0, -3);
      try {
        const filePath = path.join(this.agentsDir, file);
        const agentData = this.readAgentFile(filePath);
        if (agentData) {
          agentMap.set(agentId, agentData);
        }
      } catch (error) {
        console.error(`Failed to read agent file ${file}:`, error);
      }
    }

    // Process .json files (higher priority — overrides .md for same id)
    for (const file of allFiles.filter(f => f.endsWith('.json'))) {
      const agentId = file.slice(0, -5);
      try {
        const filePath = path.join(this.agentsDir, file);
        const agentData = this.readAgentFile(filePath);
        if (agentData) {
          agentMap.set(agentId, agentData);
        }
      } catch (error) {
        console.error(`Failed to read agent file ${file}:`, error);
      }
    }

    return Array.from(agentMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  getAgent(agentId: string): AgentConfig | null {
    try {
      // .json takes precedence over .md (allows local overrides)
      const jsonPath = path.join(this.agentsDir, `${agentId}.json`);
      if (fs.existsSync(jsonPath)) {
        return this.readAgentFile(jsonPath);
      }

      const mdPath = path.join(this.agentsDir, `${agentId}.md`);
      if (fs.existsSync(mdPath)) {
        return this.readAgentFile(mdPath);
      }

      return null;
    } catch (error) {
      console.error(`Failed to read agent ${agentId}:`, error);
      return null;
    }
  }

  /**
   * Read a single agent file (.json or .md) and annotate with source/installPath.
   */
  private readAgentFile(filePath: string): AgentConfig | null {
    const isMd = filePath.endsWith('.md');

    let agentData: AgentConfig | null;
    if (isMd) {
      agentData = parseAgentMdFile(filePath);
    } else {
      agentData = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentConfig;
    }

    if (!agentData) return null;

    // Detect symlink to set source / installPath
    let isSymlink = false;
    let realPath = filePath;
    try {
      const stats = fs.lstatSync(filePath);
      isSymlink = stats.isSymbolicLink();
      if (isSymlink) {
        const linkTarget = fs.readlinkSync(filePath);
        realPath = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(path.dirname(filePath), linkTarget);
      }
    } catch (error) {
      console.warn(`Failed to check if ${filePath} is symlink:`, error);
    }

    agentData.source = isSymlink ? 'plugin' : 'local';
    if (isSymlink) {
      agentData.installPath = realPath;
    }

    return agentData;
  }

  saveAgent(agent: AgentConfig): void {
    try {
      agent.updatedAt = new Date().toISOString();
      const filePath = path.join(this.agentsDir, `${agent.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(agent, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save agent ${agent.id}:`, error);
      throw error;
    }
  }

  deleteAgent(agentId: string): boolean {
    try {
      console.log(`🗑️ [BACKEND DEBUG] Attempting to delete agent: ${agentId}`);
      const filePath = path.join(this.agentsDir, `${agentId}.json`);
      console.log(`🗑️ [BACKEND DEBUG] File path: ${filePath}, exists: ${fs.existsSync(filePath)}`);
      
      if (fs.existsSync(filePath)) {
        // Don't delete built-in agents, just disable them
        const agent = this.getAgent(agentId);
        console.log(`🗑️ [BACKEND DEBUG] Agent data:`, {
          found: !!agent,
          id: agent?.id,
          name: agent?.name,
          enabled: agent?.enabled
        });
        
        if (agent && BUILTIN_AGENTS.some(builtin => builtin.id === agentId)) {
          // Allow deletion of deprecated built-in agents (code-assistant, document-writer)
          const DEPRECATED_BUILTINS = ['code-assistant', 'document-writer'];
          if (DEPRECATED_BUILTINS.includes(agentId)) {
            console.log(`✅ [BACKEND DEBUG] Deleting deprecated built-in agent: ${agentId}`);
          } else {
            // Protect current built-in agents (ppt-editor, general-chat, claude-code)
            console.log(`🛑 [BACKEND DEBUG] Protected built-in agent, disabling instead: ${agentId}`);
            agent.enabled = false;
            this.saveAgent(agent);
            return true;
          }
        }
        
        console.log(`🗑️ [BACKEND DEBUG] Deleting file: ${filePath}`);
        fs.unlinkSync(filePath);
        
        // Also delete all sessions for this agent
        this.deleteAgentSessions(agentId);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete agent ${agentId}:`, error);
      return false;
    }
  }

  createAgent(agentData: Omit<AgentConfig, 'createdAt' | 'updatedAt'>): AgentConfig {
    const now = new Date().toISOString();
    const agent: AgentConfig = {
      ...agentData,
      source: 'local', // Created agents are always local
      createdAt: now,
      updatedAt: now
    };
    
    this.saveAgent(agent);
    return agent;
  }


  // Session management
  getAgentSessionsDir(agentId: string): string {
    const dir = path.join(this.getSessionsDir(), agentId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getAgentSessions(agentId: string, searchTerm?: string): AgentSession[] {
    const sessionsDir = this.getAgentSessionsDir(agentId);
    const sessionFiles = fs.readdirSync(sessionsDir)
      .filter(file => file.endsWith('.json'));
    
    const sessions: AgentSession[] = [];
    for (const file of sessionFiles) {
      try {
        const filePath = path.join(sessionsDir, file);
        const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        sessions.push(sessionData);
      } catch (error) {
        console.error(`Failed to read session file ${file}:`, error);
      }
    }
    
    let filteredSessions = sessions;
    
    // Filter by search term if provided
    if (searchTerm && searchTerm.trim()) {
      const searchTermLower = searchTerm.trim().toLowerCase();
      filteredSessions = sessions.filter(session => {
        if (session.title.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        
        return session.messages.some(message => {
          if (message.content && message.content.toLowerCase().includes(searchTermLower)) {
            return true;
          }
          
          if (message.messageParts) {
            return message.messageParts.some(part => {
              if (part.type === 'text' && part.content && part.content.toLowerCase().includes(searchTermLower)) {
                return true;
              }
              if (part.type === 'tool' && part.toolData) {
                if (part.toolData.toolName.toLowerCase().includes(searchTermLower)) {
                  return true;
                }
                const inputStr = JSON.stringify(part.toolData.toolInput).toLowerCase();
                if (inputStr.includes(searchTermLower)) {
                  return true;
                }
              }
              return false;
            });
          }
          
          return false;
        });
      });
    }
    
    return filteredSessions.sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  getSession(agentId: string, sessionId: string): AgentSession | null {
    try {
      const sessionsDir = this.getAgentSessionsDir(agentId);
      const filePath = path.join(sessionsDir, `${sessionId}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
      console.error(`Failed to read session ${sessionId} for agent ${agentId}:`, error);
      return null;
    }
  }

  createSession(agentId: string, title?: string): AgentSession {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const agent = this.getAgent(agentId);
    
    const session: AgentSession = {
      id: sessionId,
      agentId,
      title: title || `${agent?.name || 'Agent'} 会话 ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      messages: []
    };
    
    this.saveSession(session);
    return session;
  }

  createSessionWithId(agentId: string, sessionId: string, title?: string): AgentSession {
    const agent = this.getAgent(agentId);
    
    const session: AgentSession = {
      id: sessionId, // Use AI-provided session_id
      agentId,
      title: title || `${agent?.name || 'Agent'} 会话 ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      messages: []
      // claudeSessionId will be set when AI returns it in init message
    };
    
    this.saveSession(session);
    return session;
  }

  saveSession(session: AgentSession): void {
    try {
      const sessionsDir = this.getAgentSessionsDir(session.agentId);
      const filePath = path.join(sessionsDir, `${session.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to save session ${session.id}:`, error);
      throw error;
    }
  }

  deleteSession(agentId: string, sessionId: string): boolean {
    try {
      const sessionsDir = this.getAgentSessionsDir(agentId);
      const filePath = path.join(sessionsDir, `${sessionId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Failed to delete session ${sessionId}:`, error);
      return false;
    }
  }

  deleteAgentSessions(agentId: string): void {
    try {
      const sessionsDir = this.getAgentSessionsDir(agentId);
      const sessionFiles = fs.readdirSync(sessionsDir);
      for (const file of sessionFiles) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(sessionsDir, file));
        }
      }
    } catch (error) {
      console.error(`Failed to delete sessions for agent ${agentId}:`, error);
    }
  }

  // Helper method to check if session title should be updated
  private shouldUpdateTitle(title: string): boolean {
    return title.includes('会话') && title.includes(new Date().toLocaleString().split(' ')[0]);
  }

  // Generate intelligent session title based on first user message using Claude Code SDK
  private async updateSessionTitle(session: AgentSession): Promise<void> {
    // Only update if it's still the default title
    if (!this.shouldUpdateTitle(session.title)) {
      return;
    }
    
    // Find the first user message
    const firstUserMessage = session.messages.find(msg => msg.role === 'user');
    if (!firstUserMessage) {
      return;
    }

    let userQuestion = '';
    
    // Extract text content from the message
    if (firstUserMessage.content) {
      userQuestion = firstUserMessage.content;
    } else if (firstUserMessage.messageParts) {
      userQuestion = firstUserMessage.messageParts
        .filter(part => part.type === 'text')
        .map(part => part.content)
        .join(' ');
    }

    if (userQuestion) {
      try {
        // Use Claude Code SDK to generate a concise title
        
        const titlePrompt = `请为以下用户问题生成一个简洁的标题（不超过25个字符），用于会话列表显示：

用户问题：${userQuestion}

要求：
1. 提取问题的核心要点
2. 使用简洁明了的中文
3. 不超过25个字符
4. 不需要引号或其他标点符号
5. 直接输出标题内容，不要任何前缀或后缀`;

        const queryOptions: Options = {
          systemPrompt: "你是一个专门生成简洁标题的助手。请直接输出标题内容，不要任何解释或格式化。",
          allowedTools: [],  // No tools needed for title generation
          maxTurns: 1,
          cwd: process.cwd()
        };

        let generatedTitle = '';
        
        for await (const sdkMessage of query({
          prompt: titlePrompt,
          options: queryOptions
        })) {
          if (sdkMessage.type === 'assistant' && sdkMessage.message?.content) {
            for (const block of sdkMessage.message.content) {
              if (block.type === 'text') {
                generatedTitle += block.text;
              }
            }
          }
        }
        
        if (generatedTitle.trim()) {
          // Clean the generated title
          let cleanTitle = generatedTitle.trim()
            .replace(/^["'"']|["'"']$/g, '') // Remove quotes
            .replace(/\n/g, ' ') // Replace newlines
            .replace(/\s+/g, ' '); // Collapse spaces
          
          // Ensure it's not too long
          if (cleanTitle.length > 30) {
            cleanTitle = cleanTitle.substring(0, 27) + '...';
          }
          
          session.title = cleanTitle;
          console.log(`Generated title for session ${session.id}: "${cleanTitle}"`);
        } else {
          // Fallback to simple truncation if AI generation fails
          this.fallbackTitleGeneration(session, userQuestion);
        }
      } catch (error) {
        console.error('Failed to update session title with Claude SDK:', error);
        // Fallback to simple truncation
        this.fallbackTitleGeneration(session, userQuestion);
      }
    }
  }

  // Fallback title generation when Claude SDK fails
  private fallbackTitleGeneration(session: AgentSession, userQuestion: string): void {
    let fallbackTitle = userQuestion.trim()
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 25);
    
    // Take first sentence if it's reasonable
    const firstSentence = fallbackTitle.split(/[.!?。！？]/)[0];
    if (firstSentence.length > 8 && firstSentence.length < 25) {
      fallbackTitle = firstSentence;
    }
    
    if (fallbackTitle.length > 22) {
      fallbackTitle = fallbackTitle.substring(0, 22) + '...';
    }
    
    session.title = fallbackTitle;
    console.log(`Fallback title for session ${session.id}: "${fallbackTitle}"`);
  }

  addMessageToSession(agentId: string, sessionId: string, message: Omit<AgentMessage, 'id' | 'timestamp' | 'agentId'>): AgentMessage | null {
    const session = this.getSession(agentId, sessionId);
    if (!session) {
      return null;
    }

    const newMessage: AgentMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      messageParts: message.messageParts || [],
      agentId
    };

    session.messages.push(newMessage);
    session.lastUpdated = Date.now();
    
    // Save session first, then update title asynchronously
    this.saveSession(session);
    
    // Update session title based on first user message (async, doesn't block)
    if (message.role === 'user' && this.shouldUpdateTitle(session.title)) {
      this.updateSessionTitle(session).then(() => {
        // Save again after title is updated
        this.saveSession(session);
        console.log(`Session title updated to: "${session.title}"`);
      }).catch(err => {
        console.error('Failed to update session title:', err);
      });
    }
    
    return newMessage;
  }
}