/**
 * CodeBuddy Engine Implementation
 * 
 * Wraps the CodeBuddy Agent SDK (@tencent-ai/agent-sdk) and outputs
 * standardized AGUI events. Since CodeBuddy SDK has an API nearly
 * identical to Claude Agent SDK, we reuse the ClaudeAguiAdapter for
 * message-to-AGUI conversion.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  IAgentEngine,
  EngineType,
  EngineConfig,
  EngineCapabilities,
  AGUIEvent,
  ModelInfo,
} from '../types.js';
import { ClaudeAguiAdapter } from '../claude/aguiAdapter.js';

// Dynamic import for @tencent-ai/agent-sdk to handle cases where it's not installed
let queryFn: any = null;

async function getQueryFunction() {
  if (!queryFn) {
    try {
      const sdk = await import('@tencent-ai/agent-sdk');
      queryFn = sdk.query;
    } catch (error) {
      console.error('[CodeBuddyEngine] Failed to import @tencent-ai/agent-sdk:', error);
      throw new Error('CodeBuddy Agent SDK (@tencent-ai/agent-sdk) is not installed. Run: pnpm add @tencent-ai/agent-sdk');
    }
  }
  return queryFn;
}

// Cache for CodeBuddy models
let cachedModels: ModelInfo[] | null = null;
let modelsCacheTime: number = 0;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Active CodeBuddy session tracking
 */
interface CodeBuddySession {
  id: string;
  abortController: AbortController;
  workspace: string;
  startedAt: Date;
}

/**
 * CodeBuddy Engine - Implements IAgentEngine for CodeBuddy Agent SDK
 */
export class CodeBuddyEngine implements IAgentEngine {
  readonly type: EngineType = 'codebuddy';

  readonly capabilities: EngineCapabilities = {
    mcp: {
      supported: true,
      configPath: '~/.codebuddy/mcp.json',
      dynamicToolLoading: false, // v1: static MCP config only
    },
    skills: {
      supported: false, // v1: no skills support
    },
    features: {
      multiTurn: true,
      thinking: true,
      vision: true,
      streaming: true,
      subagents: false, // v1: no subagents
      codeExecution: true,
    },
    permissionModes: ['bypassPermissions'], // v1: only bypass mode
    ui: {
      showMcpToolSelector: false, // v1: no MCP tool selector
      showImageUpload: false, // v1: no image support
      showPermissionSelector: false, // v1: fixed to bypassPermissions
      showProviderSelector: false, // CodeBuddy has no provider concept
      showModelSelector: true, // Models can be fetched via SDK
      showEnvVars: false, // v1: no env vars UI
    },
  };

  private activeSessions: Map<string, CodeBuddySession> = new Map();

  /**
   * Get supported models for CodeBuddy engine
   * 
   * Tries to fetch from SDK first, falls back to hardcoded list.
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Check cache
    const now = Date.now();
    if (cachedModels && (now - modelsCacheTime) < MODEL_CACHE_TTL) {
      return cachedModels;
    }

    // Try SDK-based model fetching
    const fromSdk = await this.fetchModelsFromSdk();
    if (fromSdk.length > 0) {
      cachedModels = fromSdk;
      modelsCacheTime = now;
      return fromSdk;
    }

    // Fallback to hardcoded models
    return this.getHardcodedModels();
  }

  /**
   * Fetch models via CodeBuddy SDK's supportedModels()
   */
  private async fetchModelsFromSdk(): Promise<ModelInfo[]> {
    try {
      const query = await getQueryFunction();
      const abortController = new AbortController();
      const timeoutMs = 15_000;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          abortController.abort();
          reject(new Error('SDK supportedModels() timeout'));
        }, timeoutMs)
      );

      const q = query({
        prompt: '.',
        options: {
          abortController,
          cwd: process.cwd(),
          allowedTools: ['Read'],
          maxTurns: 1,
          permissionMode: 'bypassPermissions',
        },
      });

      const modelsPromise = q.supportedModels();
      const iter = q[Symbol.asyncIterator]();
      const firstResultPromise = iter.next();

      const sdkModels = await Promise.race([
        Promise.all([modelsPromise, firstResultPromise]).then(([models]) => models),
        timeoutPromise,
      ]);

      abortController.abort();

      if (!Array.isArray(sdkModels) || sdkModels.length === 0) return [];

      const models: ModelInfo[] = sdkModels.map((m: any) => ({
        id: m.value || m.id,
        name: m.displayName || m.name || m.value || m.id,
        isVision: true,
        isThinking: (m.displayName || m.name || '').toLowerCase().includes('thinking'),
        description: m.description,
      }));

      console.log(`[CodeBuddyEngine] Fetched ${models.length} models from SDK`);
      return models;
    } catch (error) {
      console.warn('[CodeBuddyEngine] Failed to fetch models from SDK:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Hardcoded fallback models
   */
  private getHardcodedModels(): ModelInfo[] {
    console.log('[CodeBuddyEngine] Using hardcoded model list');
    return [
      { id: 'claude-4.0', name: 'Claude 4.0', isVision: true, description: 'Default model' },
      { id: 'deepseek-v3.1', name: 'DeepSeek V3.1', isVision: false, description: 'DeepSeek model' },
      { id: 'sonnet', name: 'Claude Sonnet', isVision: true, description: 'Balanced model' },
      { id: 'opus', name: 'Claude Opus', isVision: true, description: 'Most capable model' },
    ];
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Send a message using CodeBuddy SDK
   */
  async sendMessage(
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }> {
    const {
      workspace,
      sessionId: existingSessionId,
      model,
      permissionMode = 'bypassPermissions',
    } = config;

    // Create AGUI adapter (reuse ClaudeAguiAdapter since message format is identical)
    const adapter = new ClaudeAguiAdapter(existingSessionId || undefined);

    // Send RUN_STARTED event
    onAguiEvent(adapter.createRunStarted({ message, workspace }));

    try {
      const query = await getQueryFunction();

      // Build SDK options
      const abortController = new AbortController();
      const sessionId = existingSessionId || uuidv4();

      // Build environment variables for authentication
      const env: Record<string, string | undefined> = {};
      if (process.env.CODEBUDDY_API_KEY) {
        env.CODEBUDDY_API_KEY = process.env.CODEBUDDY_API_KEY;
      }
      if (process.env.CODEBUDDY_AUTH_TOKEN) {
        env.CODEBUDDY_AUTH_TOKEN = process.env.CODEBUDDY_AUTH_TOKEN;
      }
      if (process.env.CODEBUDDY_CODE_PATH) {
        env.CODEBUDDY_CODE_PATH = process.env.CODEBUDDY_CODE_PATH;
      }

      const queryOptions: Record<string, any> = {
        abortController,
        cwd: workspace,
        permissionMode: permissionMode as string,
        maxTurns: 100,
        includePartialMessages: true,
      };

      // Add model if specified
      if (model) {
        queryOptions.model = model;
      }

      // Add env vars if any auth tokens are set
      if (Object.keys(env).length > 0) {
        queryOptions.env = env;
      }

      // Resume session if existing
      if (existingSessionId) {
        queryOptions.resume = existingSessionId;
      }

      console.log(`[CodeBuddyEngine] Starting query...`);
      console.log(`   Workspace: ${workspace}`);
      console.log(`   Model: ${model || 'default'}`);
      console.log(`   Session: ${existingSessionId || 'new'}`);

      // Track session
      const session: CodeBuddySession = {
        id: sessionId,
        abortController,
        workspace,
        startedAt: new Date(),
      };
      this.activeSessions.set(sessionId, session);

      // Create query
      const q = query({
        prompt: message,
        options: queryOptions,
      });

      let finalSessionId = sessionId;
      let resultReceived = false;

      try {
        // Iterate over SDK messages
        for await (const sdkMessage of q) {
          // Update session ID from system init
          if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init' && sdkMessage.session_id) {
            finalSessionId = sdkMessage.session_id;
            adapter.setThreadId(sdkMessage.session_id);
            // Update session tracking
            this.activeSessions.delete(sessionId);
            session.id = finalSessionId;
            this.activeSessions.set(finalSessionId, session);
            console.log(`[CodeBuddyEngine] Session ID: ${finalSessionId}`);
          }

          // Convert SDK message to AGUI events using ClaudeAguiAdapter
          const aguiEvents = adapter.convert(sdkMessage as any);
          for (const event of aguiEvents) {
            onAguiEvent(event);
          }

          // Handle result message
          if (sdkMessage.type === 'result') {
            resultReceived = true;
            console.log(`[CodeBuddyEngine] Result received`);
          }
        }
      } catch (iterError) {
        // Check if this was an intentional abort
        if (abortController.signal.aborted) {
          console.log(`[CodeBuddyEngine] Query aborted for session ${finalSessionId}`);
        } else {
          throw iterError;
        }
      }

      // Finalize adapter
      const finalEvents = adapter.finalize();
      for (const event of finalEvents) {
        onAguiEvent(event);
      }

      // Cleanup
      this.activeSessions.delete(finalSessionId);
      console.log(`[CodeBuddyEngine] Request completed, sessionId: ${finalSessionId}`);

      return { sessionId: finalSessionId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[CodeBuddyEngine] Error:', errorMessage);

      // Send error event
      onAguiEvent(adapter.createRunError(errorMessage, 'CODEBUDDY_ENGINE_ERROR'));

      // Finalize (sends RUN_FINISHED to close the stream properly)
      const finalEvents = adapter.finalize();
      for (const event of finalEvents) {
        onAguiEvent(event);
      }

      // Cleanup session tracking
      if (existingSessionId) {
        this.activeSessions.delete(existingSessionId);
      }

      // Don't re-throw: error events already sent to client via SSE.
      // Re-throwing would cause the route layer to send a duplicate RUN_ERROR.
      return { sessionId: existingSessionId || 'error' };
    }
  }

  /**
   * Interrupt a session
   */
  async interruptSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    console.log(`[CodeBuddyEngine] Interrupting session: ${sessionId}`);
    session.abortController.abort();
    this.activeSessions.delete(sessionId);
  }

  /**
   * Clean up stale sessions
   */
  cleanupStaleSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = new Date();

    for (const [sessionId, session] of this.activeSessions) {
      const age = now.getTime() - session.startedAt.getTime();

      if (age > maxAgeMs) {
        console.log(`[CodeBuddyEngine] Cleaning up stale session: ${sessionId}`);
        session.abortController.abort();
        this.activeSessions.delete(sessionId);
      }
    }
  }
}

// Export singleton instance
export const codebuddyEngine = new CodeBuddyEngine();
