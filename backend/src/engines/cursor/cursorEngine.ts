/**
 * Cursor Engine Implementation
 * 
 * Wraps Cursor CLI and outputs standardized AGUI events.
 * Uses `cursor agent --print --output-format json` command.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  IAgentEngine,
  EngineType,
  EngineConfig,
  EngineCapabilities,
  AGUIEvent,
  ModelInfo,
} from '../types.js';
import { CursorAguiAdapter } from './aguiAdapter.js';

// Cache for Cursor models
let cachedModels: ModelInfo[] | null = null;
let modelsCacheTime: number = 0;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Find cursor command path
 */
function findCursorCommand(): string {
  const possiblePaths = [
    process.env.CURSOR_CLI_PATH,
    `${process.env.HOME}/.local/bin/cursor`, // Cursor Agent CLI default location
    `${process.env.HOME}/.local/bin/agent`,  // Direct agent binary
    '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
    '/usr/local/bin/cursor',
  ];

  for (const path of possiblePaths) {
    if (!path) continue;
    
    if (existsSync(path)) {
      console.log(`[CursorEngine] Found cursor at: ${path}`);
      return path;
    }
  }

  // Try to find in PATH using which
  try {
    const result = execSync('which cursor', { stdio: 'pipe' }).toString().trim();
    if (result) {
      console.log(`[CursorEngine] Found cursor in PATH: ${result}`);
      return result;
    }
  } catch {
    // cursor not in PATH
  }

  console.warn('[CursorEngine] Cursor command not found, using default "cursor"');
  return 'cursor';
}

/**
 * Active Cursor session tracking
 */
interface CursorSession {
  id: string;
  process: ChildProcess;
  workspace: string;
  startedAt: Date;
}

/**
 * Cursor Engine - Implements IAgentEngine for Cursor CLI
 */
export class CursorEngine implements IAgentEngine {
  readonly type: EngineType = 'cursor';

  readonly capabilities: EngineCapabilities = {
    mcp: {
      supported: false, // Cursor uses its own tool system
    },
    skills: {
      supported: true,
      skillsPath: '.cursor/rules',
      ruleFormat: 'markdown',
    },
    features: {
      multiTurn: true,
      thinking: true, // Depends on model
      vision: true, // Via image URL in message
      streaming: true,
      subagents: false, // Cursor doesn't support Task tool
      codeExecution: true,
    },
    permissionModes: ['bypassPermissions'], // --force only
    ui: {
      showMcpToolSelector: false, // Cursor uses its own tool system
      showImageUpload: true, // Supported via image URL in message
      showPermissionSelector: false, // Only bypassPermissions (--force)
      showProviderSelector: false, // Cursor doesn't need provider selection
      showModelSelector: true, // Models can be fetched via --list-models
      showEnvVars: false, // Not supported
    },
  };

  private activeSessions: Map<string, CursorSession> = new Map();

  /**
   * Get supported models for Cursor engine
   * Fetches from CLI cache or executes `cursor agent --list-models`
   */
  getSupportedModels(): ModelInfo[] {
    // Check cache first
    const now = Date.now();
    if (cachedModels && (now - modelsCacheTime) < MODEL_CACHE_TTL) {
      return cachedModels;
    }

    // Try to fetch from CLI
    try {
      const cursorCmd = findCursorCommand();
      const output = execSync(`${cursorCmd} agent --list-models`, {
        encoding: 'utf8',
        timeout: 10000, // 10 second timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const models = this.parseModelList(output);
      if (models.length > 0) {
        cachedModels = models;
        modelsCacheTime = now;
        console.log(`[CursorEngine] Fetched ${models.length} models from CLI`);
        return models;
      }
    } catch (error) {
      console.warn(`[CursorEngine] Failed to fetch models from CLI:`, error);
    }

    // Return cached or fallback models
    if (cachedModels) {
      return cachedModels;
    }

    // Fallback to hardcoded models
    return this.getFallbackModels();
  }

  /**
   * Parse model list from CLI output
   */
  private parseModelList(output: string): ModelInfo[] {
    const models: ModelInfo[] = [];
    const lines = output.split('\n');
    
    // Skip header lines until we find model entries
    // Format: "model-id - Model Name" or "model-id - Model Name  (default)" or "(current)"
    // Note: Model IDs can contain dots (e.g., gpt-5.2-codex), and (default)/(current) are separated by 2+ spaces
    const modelLineRegex = /^([a-z0-9.-]+)\s+-\s+(.+?)(?:\s{2,}\((default|current)\))?$/i;
    
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(modelLineRegex);
      
      if (match) {
        const [, id, name] = match;
        const cleanName = name.trim();
        const isThinking = cleanName.toLowerCase().includes('thinking');
        const isVision = !cleanName.toLowerCase().includes('codex'); // Codex models are typically code-only
        
        models.push({
          id,
          name: cleanName,
          isVision,
          isThinking,
        });
      }
    }
    
    return models;
  }

  /**
   * Fallback models when CLI is unavailable
   */
  private getFallbackModels(): ModelInfo[] {
    return [
      { id: 'auto', name: 'Auto', isVision: true },
      { id: 'sonnet-4.5', name: 'Claude 4.5 Sonnet', isVision: true },
      { id: 'sonnet-4.5-thinking', name: 'Claude 4.5 Sonnet (Thinking)', isVision: true, isThinking: true },
      { id: 'opus-4.5', name: 'Claude 4.5 Opus', isVision: true },
      { id: 'opus-4.5-thinking', name: 'Claude 4.5 Opus (Thinking)', isVision: true, isThinking: true },
      { id: 'gpt-5.2', name: 'GPT 5.2', isVision: true },
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro', isVision: true },
      { id: 'gemini-3-flash', name: 'Gemini 3 Flash', isVision: true },
    ];
  }

  /**
   * Force refresh models from CLI (bypasses cache)
   */
  async refreshModels(): Promise<ModelInfo[]> {
    cachedModels = null;
    modelsCacheTime = 0;
    return this.getSupportedModels();
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Send a message using Cursor CLI
   */
  async sendMessage(
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }> {
    const {
      workspace,
      sessionId: existingSessionId,
      model = 'sonnet-4.5',
      timeout = 600000, // 10 minutes default
    } = config;

    // Create session ID
    const sessionId = existingSessionId || `cursor-${uuidv4()}`;

    // Create AGUI adapter
    const adapter = new CursorAguiAdapter(sessionId);

    // Send RUN_STARTED event
    onAguiEvent(adapter.createRunStarted({ message, workspace, model }));

    return new Promise((resolve, reject) => {
      // Find cursor command
      const cursorCmd = findCursorCommand();

      // Build command arguments
      // Use stream-json with --stream-partial-output for real-time streaming
      const args = [
        'agent',
        '--print',
        '--output-format', 'stream-json',
        '--stream-partial-output',
        '--workspace', workspace,
        '--force', // Equivalent to bypassPermissions
        '--model', model,
        '--approve-mcps', // Auto-approve MCP tools
      ];

      // Add session resume if continuing conversation
      if (existingSessionId) {
        args.push('--resume', existingSessionId);
      }

      console.log(`[CursorEngine] Executing: ${cursorCmd} ${args.join(' ')}`);
      console.log(`[CursorEngine] Working directory: ${workspace}`);

      // Spawn cursor process
      const cursorProcess = spawn(cursorCmd, args, {
        cwd: workspace,
        env: {
          ...process.env,
          CURSOR_API_KEY: process.env.CURSOR_API_KEY,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Handle spawn errors
      cursorProcess.on('error', (error) => {
        console.error(`[CursorEngine] Spawn error:`, error);
        onAguiEvent(adapter.createRunError(`Failed to start cursor: ${error.message}`, 'SPAWN_ERROR'));
        const finalEvents = adapter.finalize();
        for (const event of finalEvents) {
          onAguiEvent(event);
        }
        reject(error);
      });

      // Track session
      const session: CursorSession = {
        id: sessionId,
        process: cursorProcess,
        workspace,
        startedAt: new Date(),
      };
      this.activeSessions.set(sessionId, session);

      // Set up timeout
      const timeoutId = setTimeout(() => {
        console.log(`[CursorEngine] Session ${sessionId} timed out`);
        cursorProcess.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
        
        onAguiEvent(adapter.createRunError('Cursor command timed out', 'TIMEOUT'));
        const finalEvents = adapter.finalize();
        for (const event of finalEvents) {
          onAguiEvent(event);
        }
        
        reject(new Error('Cursor command timed out'));
      }, timeout);

      // Write message to stdin
      cursorProcess.stdin?.write(message + '\n');
      cursorProcess.stdin?.end();
      console.log(`[CursorEngine] Message written to stdin for session ${sessionId}`);

      let buffer = '';
      let hasError = false;

      // Process stdout line by line
      cursorProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse and convert to AGUI events
          const events = adapter.parseStreamLine(line);
          for (const event of events) {
            onAguiEvent(event);
          }
        }
      });

      // Process stderr
      cursorProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        console.log(`[CursorEngine] stderr: ${text}`);
        
        // Only treat actual errors as errors
        if (text.toLowerCase().includes('error')) {
          hasError = true;
          onAguiEvent(adapter.createRunError(text, 'CURSOR_ERROR'));
        }
      });

      // Handle process exit
      cursorProcess.on('close', (code, signal) => {
        clearTimeout(timeoutId);
        this.activeSessions.delete(sessionId);

        console.log(`[CursorEngine] Process exited with code ${code}, signal ${signal}`);

        // Process any remaining buffer
        if (buffer.trim()) {
          const events = adapter.parseStreamLine(buffer);
          for (const event of events) {
            onAguiEvent(event);
          }
        }

        // Finalize
        const finalEvents = adapter.finalize();
        for (const event of finalEvents) {
          onAguiEvent(event);
        }

        if (code === 0 || !hasError) {
          resolve({ sessionId });
        } else {
          reject(new Error(`Cursor agent exited with code ${code}`));
        }
      });

      // Handle process errors
      cursorProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        this.activeSessions.delete(sessionId);

        console.error('[CursorEngine] Process error:', error);
        onAguiEvent(adapter.createRunError(error.message, 'PROCESS_ERROR'));
        
        const finalEvents = adapter.finalize();
        for (const event of finalEvents) {
          onAguiEvent(event);
        }

        reject(error);
      });
    });
  }

  /**
   * Interrupt a session
   */
  async interruptSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    console.log(`[CursorEngine] Interrupting session: ${sessionId}`);
    
    // Kill the process
    session.process.kill('SIGTERM');
    this.activeSessions.delete(sessionId);
  }

  /**
   * Clean up stale sessions (called periodically)
   */
  cleanupStaleSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = new Date();
    
    for (const [sessionId, session] of this.activeSessions) {
      const age = now.getTime() - session.startedAt.getTime();
      
      if (age > maxAgeMs) {
        console.log(`[CursorEngine] Cleaning up stale session: ${sessionId}`);
        session.process.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
      }
    }
  }
}

// Export singleton instance
export const cursorEngine = new CursorEngine();
