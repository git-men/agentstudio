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
  AGUIEventType,
  EngineImageData,
  ModelInfo,
  SessionDetail,
} from '../types.js';
import { ClaudeAguiAdapter } from '../claude/aguiAdapter.js';
import { readCodebuddyHistorySessions, readCodebuddyHistorySession } from './historyParser.js';
import { saveImageToHiddenDir } from '../../utils/sessionUtils.js';
import { readMcpConfig } from '../../utils/claudeUtils.js';
import { getEnginePaths } from '../../config/engineConfig.js';
import { integrateA2AMcpServer } from '../../services/a2a/a2aIntegration.js';
import { integrateFrontendTools, type SessionRef } from '../../services/frontendTools/index.js';
import * as fs from 'fs';

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
      dynamicToolLoading: true, // SDK supports mcpServers option for dynamic MCP
    },
    skills: {
      supported: false,
    },
    features: {
      multiTurn: true,
      thinking: true,
      vision: true,
      streaming: true,
      subagents: true, // SDK supports agents option + SubagentStart/Stop hooks
      codeExecution: true,
    },
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    ui: {
      showMcpToolSelector: true, // Dynamic MCP tool selection
      showImageUpload: true, // Supported via saving image to disk and @path reference
      showPermissionSelector: true, // SDK supports 6 permission modes
      showProviderSelector: false, // CodeBuddy has no provider concept
      showModelSelector: true, // Models can be fetched via SDK
      showEnvVars: true, // Support passing env vars to SDK
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
   * Process images for CodeBuddy SDK.
   * Saves images to a hidden directory and replaces [imageN] placeholders
   * in the message with @path references so the model can read them.
   */
  private processImages(
    message: string,
    images: EngineImageData[] | undefined,
    workspace: string
  ): string {
    if (!images || images.length === 0) {
      return message;
    }

    console.log(`[CodeBuddyEngine] Processing ${images.length} images`);
    let processedMessage = message;

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const imageIndex = i + 1;
      const placeholder = `[image${imageIndex}]`;

      try {
        const imagePath = saveImageToHiddenDir(
          image.data,
          image.mediaType,
          imageIndex,
          workspace
        );
        console.log(`[CodeBuddyEngine] Saved image ${imageIndex} to: ${imagePath}`);
        processedMessage = processedMessage.replace(placeholder, `@${imagePath}`);
      } catch (error) {
        console.error(`[CodeBuddyEngine] Failed to save image ${imageIndex}:`, error);
      }
    }

    return processedMessage;
  }

  /**
   * Build MCP server configuration by merging frontend-selected tools
   * with engine-native MCP config (~/.codebuddy/mcp.json).
   */
  private buildMcpServers(mcpTools?: string[]): Record<string, any> {
    const mcpServers: Record<string, any> = {};

    // 1. Add frontend-selected MCP tools from AgentStudio config (~/.agentstudio/data/mcp-server.json)
    if (mcpTools && mcpTools.length > 0) {
      try {
        const mcpConfigContent = readMcpConfig();

        // Extract unique server names from mcpTools (format: mcp__serverName__toolName)
        const serverNames = new Set<string>();
        for (const tool of mcpTools) {
          const parts = tool.split('__');
          if (parts.length >= 2 && parts[0] === 'mcp') {
            serverNames.add(parts[1]);
          }
        }

        for (const serverName of serverNames) {
          const serverConfig = mcpConfigContent.mcpServers?.[serverName];
          if (serverConfig && serverConfig.status === 'active') {
            if (serverConfig.type === 'http') {
              mcpServers[serverName] = {
                type: 'http',
                url: serverConfig.url,
                headers: serverConfig.headers || {},
              };
            } else if (serverConfig.type === 'stdio') {
              mcpServers[serverName] = {
                type: 'stdio',
                command: serverConfig.command,
                args: serverConfig.args || [],
                env: serverConfig.env || {},
              };
            } else if (serverConfig.type === 'sse') {
              mcpServers[serverName] = {
                type: 'sse',
                url: serverConfig.url,
                headers: serverConfig.headers || {},
              };
            }
          }
        }
      } catch (error) {
        console.error('[CodeBuddyEngine] Failed to parse MCP configuration:', error);
      }
    }

    // 2. Auto-include ALL engine-native MCP servers (~/.codebuddy/mcp.json)
    try {
      const engineMcpPath = getEnginePaths().mcpConfigPath;
      if (fs.existsSync(engineMcpPath)) {
        const config = JSON.parse(fs.readFileSync(engineMcpPath, 'utf-8'));
        const engineServers = config.mcpServers || {};
        for (const [name, serverConfig] of Object.entries(engineServers) as [string, any][]) {
          if (mcpServers[name]) continue; // Skip duplicates
          if (serverConfig.url) {
            mcpServers[name] = {
              type: serverConfig.type || 'http',
              url: serverConfig.url,
              headers: serverConfig.headers || {},
            };
          } else if (serverConfig.command) {
            mcpServers[name] = {
              type: 'stdio',
              command: serverConfig.command,
              args: serverConfig.args || [],
              env: serverConfig.env || {},
            };
          }
        }
      }
    } catch (error) {
      console.error('[CodeBuddyEngine] Failed to load engine MCP configuration:', error);
    }

    return mcpServers;
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
      images,
      envVars: userEnvVars,
      mcpTools,
      permissionMode = 'bypassPermissions',
    } = config;

    // Create AGUI adapter (reuse ClaudeAguiAdapter since message format is identical)
    // NOTE: Don't send RUN_STARTED yet - wait for system.init to get real session ID from SDK.
    // Sending RUN_STARTED with a generated UUID causes session resume failures because the
    // frontend stores the fake UUID and passes it back, but the SDK doesn't recognize it.
    const adapter = new ClaudeAguiAdapter(existingSessionId || undefined);

    try {
      const query = await getQueryFunction();

      // Build SDK options
      const abortController = new AbortController();
      const sessionId = existingSessionId || uuidv4();

      // Build environment variables: merge auth tokens + user-provided env vars
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
      // Merge user-provided env vars (from UI)
      if (userEnvVars && Object.keys(userEnvVars).length > 0) {
        Object.assign(env, userEnvVars);
        console.log(`[CodeBuddyEngine] Added ${Object.keys(userEnvVars).length} user env vars`);
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

      // Build and add MCP server configuration
      const mcpServers = this.buildMcpServers(mcpTools);
      if (Object.keys(mcpServers).length > 0) {
        queryOptions.mcpServers = mcpServers;
        console.log(`[CodeBuddyEngine] MCP Servers configured:`, Object.keys(mcpServers));
      }

      // Integrate A2A SDK MCP server (in-process)
      await integrateA2AMcpServer(queryOptions, workspace, true);

      // Integrate frontend tools as in-process MCP servers
      let frontendToolSessionRef: SessionRef | null = null;
      if (config.frontendTools && config.frontendTools.length > 0) {
        const ftResult = await integrateFrontendTools(
          queryOptions,
          sessionId,
          'codebuddy',
          config.frontendTools,
          'in-process',
        );
        frontendToolSessionRef = ftResult.sessionRef;
        console.log(`[CodeBuddyEngine] Frontend tools integrated: ${config.frontendTools.map(t => t.name).join(', ')}`);
      }

      // Process images: save to hidden directory and replace placeholders with @path
      const processedMessage = this.processImages(message, images, workspace);

      console.log(`[CodeBuddyEngine] Starting query...`);
      console.log(`   Workspace: ${workspace}`);
      console.log(`   Model: ${model || 'default'}`);
      console.log(`   Session: ${existingSessionId || 'new'}`);
      if (images && images.length > 0) {
        console.log(`   Images: ${images.length} (saved to disk with @path references)`);
      }

      // Track session
      const session: CodeBuddySession = {
        id: sessionId,
        abortController,
        workspace,
        startedAt: new Date(),
      };
      this.activeSessions.set(sessionId, session);

      // Track whether RUN_STARTED has been sent
      let runStartedSent = false;

      // Helper: execute query and iterate over SDK messages
      const executeQuery = async (options: Record<string, any>) => {
        const q = query({
          prompt: processedMessage,
          options,
        });

        let finalSid = sessionId;
        let resultReceived = false;

        for await (const sdkMessage of q) {
          // Update session ID from system init
          if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init' && sdkMessage.session_id) {
            finalSid = sdkMessage.session_id;
            adapter.setThreadId(sdkMessage.session_id);
            // Update session tracking
            this.activeSessions.delete(sessionId);
            session.id = finalSid;
            this.activeSessions.set(finalSid, session);
            // Update frontend tool session ref so bridge matches the real ID
            if (frontendToolSessionRef) {
              frontendToolSessionRef.current = finalSid;
            }
            console.log(`[CodeBuddyEngine] SDK Session ID: ${finalSid}`);

            // NOW send RUN_STARTED with the real SDK session ID
            if (!runStartedSent) {
              onAguiEvent(adapter.createRunStarted({ message, workspace }));
              runStartedSent = true;
            }
          }

          // If we haven't received system.init yet but getting other messages,
          // send RUN_STARTED with what we have (fallback)
          if (!runStartedSent) {
            onAguiEvent(adapter.createRunStarted({ message, workspace }));
            runStartedSent = true;
          }

          // Handle compact boundary events (auto-compaction / manual /compact)
          if (sdkMessage.type === 'system' && (sdkMessage as any).subtype === 'compact_boundary') {
            const compactMetadata = (sdkMessage as any).compact_metadata;
            console.log(`[CodeBuddyEngine] Compact boundary detected:`, {
              trigger: compactMetadata?.trigger,
              preTokens: compactMetadata?.pre_tokens,
            });
            onAguiEvent({
              type: 'CUSTOM' as AGUIEventType,
              name: 'auto_compact',
              data: {
                trigger: compactMetadata?.trigger || 'auto',
                preTokens: compactMetadata?.pre_tokens || 0,
                sessionId: finalSid,
              },
              timestamp: Date.now(),
            } as any);
            continue;
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

        // If no messages at all, still send RUN_STARTED (edge case)
        if (!runStartedSent) {
          onAguiEvent(adapter.createRunStarted({ message, workspace }));
          runStartedSent = true;
        }

        return finalSid;
      };

      let finalSessionId = sessionId;

      try {
        finalSessionId = await executeQuery(queryOptions);
      } catch (iterError) {
        // Check if this was an intentional abort
        if (abortController.signal.aborted) {
          console.log(`[CodeBuddyEngine] Query aborted for session ${finalSessionId}`);
        } else {
          // Check if this is a resume failure - retry without resume
          const iterErrorMessage = iterError instanceof Error ? iterError.message : String(iterError);
          if (existingSessionId && (
            iterErrorMessage.includes('No conversation found') ||
            iterErrorMessage.includes('conversation') && iterErrorMessage.includes('not found') ||
            iterErrorMessage.includes('session') && iterErrorMessage.includes('not found')
          )) {
            console.log(`[CodeBuddyEngine] Resume failed for session ${existingSessionId}, retrying without resume...`);
            // Remove resume option and retry as new session
            delete queryOptions.resume;
            finalSessionId = await executeQuery(queryOptions);
          } else {
            throw iterError;
          }
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

      // Ensure RUN_STARTED was sent before error/finish events
      onAguiEvent(adapter.createRunStarted({ message, workspace }));

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
   * Read all sessions for a project from CodeBuddy history
   */
  async readSessions(projectPath: string): Promise<SessionDetail[]> {
    return readCodebuddyHistorySessions(projectPath);
  }

  /**
   * Read a single session by ID from CodeBuddy history
   */
  async readSession(projectPath: string, sessionId: string): Promise<SessionDetail | null> {
    return readCodebuddyHistorySession(projectPath, sessionId);
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
