/**
 * Claude Engine Implementation
 * 
 * Wraps the Claude Agent SDK and outputs standardized AGUI events.
 * This engine supports providers (Claude versions), MCP tools, and
 * all the advanced features of the Claude SDK.
 */

import type {
  IAgentEngine,
  EngineType,
  EngineConfig,
  EngineCapabilities,
  AGUIEvent,
  ModelInfo,
} from '../types.js';
import { ClaudeAguiAdapter } from './aguiAdapter.js';
import { sessionManager } from '../../services/sessionManager.js';
import { buildQueryOptions } from '../../utils/claudeUtils.js';
import { handleSessionManagement, buildUserMessageContent } from '../../utils/sessionUtils.js';
import { AgentStorage } from '../../services/agentStorage.js';
import { getDefaultVersionId, getVersionByIdInternal } from '../../services/claudeVersionStorage.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Agent storage for getting agent configurations
const globalAgentStorage = new AgentStorage();

// Cache for Claude models (similar to Cursor engine)
let cachedModels: ModelInfo[] | null = null;
let modelsCacheTime: number = 0;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Default agent configuration for AGUI mode
const DEFAULT_AGUI_AGENT = {
  id: 'agui-default',
  name: 'AGUI Default Agent',
  description: 'Default agent for AGUI API',
  version: '1.0.0',
  maxTurns: 100,
  permissionMode: 'acceptEdits',
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  allowedTools: [
    { name: 'Write', enabled: true },
    { name: 'Read', enabled: true },
    { name: 'Edit', enabled: true },
    { name: 'Glob', enabled: true },
    { name: 'Bash', enabled: true },
    { name: 'Task', enabled: true },
    { name: 'WebFetch', enabled: true },
    { name: 'WebSearch', enabled: true },
    { name: 'TodoWrite', enabled: true },
    { name: 'Grep', enabled: true },
  ],
  enabled: true,
};

/**
 * Claude Engine - Implements IAgentEngine for Claude SDK
 */
export class ClaudeEngine implements IAgentEngine {
  readonly type: EngineType = 'claude';

  readonly capabilities: EngineCapabilities = {
    mcp: {
      supported: true,
      configPath: '~/.claude/mcp.json',
      dynamicToolLoading: true,
    },
    skills: {
      supported: true,
      skillsPath: '~/.claude/skills',
      ruleFormat: 'markdown',
    },
    features: {
      multiTurn: true,
      thinking: true,
      vision: true,
      streaming: true,
      subagents: true,
      codeExecution: true,
    },
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    ui: {
      showMcpToolSelector: true,
      showImageUpload: true,
      showPermissionSelector: true,
      showProviderSelector: true,
      showModelSelector: true,
      showEnvVars: true,
    },
  };

  /**
   * Get supported models for Claude engine.
   * 
   * Uses a 4-level fallback strategy with caching:
   * 1. SDK `query().supportedModels()` — most accurate (reflects API key permissions & CLI version)
   * 2. REST API `GET {ANTHROPIC_BASE_URL}/v1/models` — broad model list from API
   * 3. Default provider config from `claudeVersionStorage` — works offline
   * 4. Hardcoded fallback — always available
   * 
   * Results are cached for MODEL_CACHE_TTL (5 minutes) to avoid repeated
   * SDK/API calls on frequent frontend polling.
   */
  async getSupportedModels(): Promise<ModelInfo[]> {
    // Check cache first
    const now = Date.now();
    if (cachedModels && (now - modelsCacheTime) < MODEL_CACHE_TTL) {
      return cachedModels;
    }

    // Level 1: SDK supportedModels() — most accurate
    const fromSdk = await this.fetchModelsFromSdk();
    if (fromSdk.length > 0) {
      cachedModels = fromSdk;
      modelsCacheTime = now;
      return fromSdk;
    }

    // Level 2: REST API /v1/models
    const fromApi = await this.fetchModelsFromApi();
    if (fromApi.length > 0) {
      cachedModels = fromApi;
      modelsCacheTime = now;
      return fromApi;
    }

    // Level 3: Default provider config
    const fromProvider = await this.getModelsFromDefaultProvider();
    if (fromProvider.length > 0) {
      cachedModels = fromProvider;
      modelsCacheTime = now;
      return fromProvider;
    }

    // Level 4: Hardcoded fallback (no cache — always re-evaluate upper levels next time)
    return this.getHardcodedModels();
  }

  /**
   * Force refresh models from all sources (bypasses cache).
   * Analogous to CursorEngine.refreshModels().
   */
  async refreshModels(): Promise<ModelInfo[]> {
    cachedModels = null;
    modelsCacheTime = 0;
    return this.getSupportedModels();
  }

  /**
   * Level 1: Fetch models via Claude Agent SDK's Query.supportedModels().
   * 
   * This creates a lightweight query instance, waits for initialization,
   * calls supportedModels(), then immediately aborts the session.
   * The result is the most accurate list because the SDK reflects the
   * current API key permissions and CLI version.
   */
  private async fetchModelsFromSdk(): Promise<ModelInfo[]> {
    try {
      const abortController = new AbortController();
      const timeoutMs = 15_000; // 15s timeout for SDK init + model fetch

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
        },
      });

      // supportedModels() waits on Query's internal "initialization" promise.
      // Initialization is triggered when the session starts (first iteration).
      const modelsPromise = q.supportedModels();

      // Start iteration so the SDK starts the CLI and sends init
      const iter = q[Symbol.asyncIterator]();
      const firstResultPromise = iter.next();

      const sdkModels = await Promise.race([
        Promise.all([modelsPromise, firstResultPromise]).then(([models]) => models),
        timeoutPromise,
      ]);

      // Immediately abort — we only needed the model list
      abortController.abort();

      if (!Array.isArray(sdkModels) || sdkModels.length === 0) return [];

      const models: ModelInfo[] = sdkModels.map((m) => ({
        id: m.value,
        name: m.displayName,
        isVision: !m.displayName.toLowerCase().includes('haiku'), // Haiku has limited vision support
        isThinking: m.displayName.toLowerCase().includes('thinking'),
        description: m.description,
      }));

      console.log(`[ClaudeEngine] Fetched ${models.length} models from SDK supportedModels()`);
      return models;
    } catch (error) {
      console.warn('[ClaudeEngine] Failed to fetch models from SDK:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  /**
   * Level 2: Fetch models from Anthropic REST API `/v1/models`.
   */
  private async fetchModelsFromApi(): Promise<ModelInfo[]> {
    const baseUrl = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const url = `${baseUrl}/v1/models`;

    const apiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      (await this.getApiKeyFromDefaultProvider());

    if (!apiKey) {
      console.warn('[ClaudeEngine] No API key for /v1/models (ANTHROPIC_API_KEY or default provider)');
      return [];
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`[ClaudeEngine] /v1/models returned ${res.status}`);
        return [];
      }

      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          object?: string;
          created?: number;
          created_at?: string;
          display_name?: string;
          name?: string;
          owned_by?: string;
        }>;
        object?: string;
      };

      const data = json?.data;
      if (!Array.isArray(data) || data.length === 0) return [];

      const models: ModelInfo[] = data.map((m) => {
        const name =
          m.display_name ?? (m as { name?: string }).name ?? m.id;
        const nameLower = name.toLowerCase();
        const isThinking = nameLower.includes('thinking');
        const isVision = !nameLower.includes('haiku');
        return {
          id: m.id,
          name,
          isVision,
          isThinking,
          description: m.owned_by ? `${m.owned_by}: ${name}` : undefined,
        };
      });

      console.log(`[ClaudeEngine] Fetched ${models.length} models from ${url}`);
      return models;
    } catch (error) {
      console.warn('[ClaudeEngine] Failed to fetch models from API:', error);
      return [];
    }
  }

  /**
   * Helper: Get API key from the default provider in claudeVersionStorage.
   */
  private async getApiKeyFromDefaultProvider(): Promise<string | null> {
    try {
      const versionId = await getDefaultVersionId();
      if (!versionId) return null;
      const version = await getVersionByIdInternal(versionId);
      const env = version?.environmentVariables ?? {};
      return env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Level 3: Get models from the default provider config in claudeVersionStorage.
   */
  private async getModelsFromDefaultProvider(): Promise<ModelInfo[]> {
    try {
      const versionId = await getDefaultVersionId();
      if (!versionId) return [];
      const version = await getVersionByIdInternal(versionId);
      if (!version?.models?.length) return [];

      const models: ModelInfo[] = version.models.map((m) => ({
        id: m.id,
        name: m.name,
        isVision: m.isVision ?? true,
        isThinking: (m.name || '').toLowerCase().includes('thinking'),
        description: m.description,
      }));
      console.log(`[ClaudeEngine] Using ${models.length} models from default provider (${version.alias})`);
      return models;
    } catch (error) {
      console.warn('[ClaudeEngine] Failed to get models from default provider:', error);
      return [];
    }
  }

  /**
   * Level 4: Hardcoded fallback model list.
   * Uses short aliases that Claude CLI / SDK accepts as valid model identifiers.
   */
  private getHardcodedModels(): ModelInfo[] {
    console.log('[ClaudeEngine] Using hardcoded model list (all remote sources unavailable)');
    return [
      { id: 'sonnet', name: 'Claude Sonnet', isVision: true, description: 'Balanced performance and cost' },
      { id: 'sonnet-thinking', name: 'Claude Sonnet (Thinking)', isVision: true, isThinking: true, description: 'Sonnet with extended thinking' },
      { id: 'opus', name: 'Claude Opus', isVision: true, description: 'Most capable model' },
      { id: 'opus-thinking', name: 'Claude Opus (Thinking)', isVision: true, isThinking: true, description: 'Opus with extended thinking' },
      { id: 'haiku', name: 'Claude Haiku', isVision: false, description: 'Fast and cost-effective' },
    ];
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return sessionManager.getActiveSessionCount();
  }

  /**
   * Send a message using Claude SDK
   */
  async sendMessage(
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }> {
    const {
      workspace,
      sessionId,
      providerId,
      permissionMode = 'acceptEdits',
      mcpTools,
      model,
      envVars,
    } = config;

    // Create AGUI adapter
    const adapter = new ClaudeAguiAdapter(sessionId || undefined);

    // Send RUN_STARTED event
    onAguiEvent(adapter.createRunStarted({ message, workspace }));

    try {
      // Get agent configuration - first try from storage, fallback to default
      // Priority: claude-code > first enabled agent > default config
      let agentConfig = globalAgentStorage.getAgent('claude-code');
      if (!agentConfig) {
        const allAgents = globalAgentStorage.getAllAgents();
        agentConfig = allAgents.find(a => a.enabled) || null;
      }
      
      // Use default config if no agent found
      const defaultAgent = agentConfig || DEFAULT_AGUI_AGENT;
      console.log(`[ClaudeEngine] Using agent: ${defaultAgent.id || defaultAgent.name}`);

      // Temporary session ID for MCP tools (will be updated when Claude responds)
      const tempSessionId = sessionId || `temp_${Date.now()}`;

      console.log(`[ClaudeEngine] Building query options...`);
      console.log(`[ClaudeEngine] - workspace: ${workspace}`);
      console.log(`[ClaudeEngine] - permissionMode: ${permissionMode}`);
      console.log(`[ClaudeEngine] - model: ${model}`);
      console.log(`[ClaudeEngine] - providerId: ${providerId}`);

      // Build query options for Claude SDK
      const { queryOptions } = await buildQueryOptions(
        defaultAgent,
        workspace,
        mcpTools,
        permissionMode,
        model,
        providerId,
        undefined, // subagentConfigs
        envVars,
        tempSessionId,
        defaultAgent.id,
        true // enableA2AStreaming
      );

      console.log(`[ClaudeEngine] Query options built successfully`);
      console.log(`[ClaudeEngine] - final model: ${queryOptions.model}`);
      console.log(`[ClaudeEngine] - final permissionMode: ${queryOptions.permissionMode}`);

      // Enable partial messages for streaming
      queryOptions.includePartialMessages = true;

      // Build config snapshot for session management
      const configSnapshot = {
        model: queryOptions.model,
        claudeVersionId: providerId,
        permissionMode: queryOptions.permissionMode,
        mcpTools: mcpTools || [],
        allowedTools: defaultAgent.allowedTools
          ?.filter((tool: any) => tool.enabled)
          .map((tool: any) => tool.name) || [],
      };

      console.log(`[ClaudeEngine] Handling session management...`);

      // Handle session management
      const { claudeSession, actualSessionId } = await handleSessionManagement(
        defaultAgent.id,
        sessionId || null,
        workspace,
        queryOptions,
        providerId,
        model,
        'reuse',
        configSnapshot
      );

      console.log(`[ClaudeEngine] Session created: ${actualSessionId}`);
      console.log(`[ClaudeEngine] Building user message content...`);

      // Build user message content
      const userMessage = await buildUserMessageContent(
        message,
        undefined, // images
        queryOptions.model || 'sonnet',
        workspace,
        providerId
      );

      console.log(`[ClaudeEngine] User message built, sending to Claude SDK...`);

      // Track if we've received stream events
      let hasReceivedStreamEvents = false;
      let finalSessionId = actualSessionId || tempSessionId;
      let resultReceived = false;

      // Create a promise that resolves when result is received
      const resultPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!resultReceived) {
            console.error(`[ClaudeEngine] Timeout waiting for result`);
            reject(new Error('Timeout waiting for Claude response'));
          }
        }, 600000); // 10 minutes timeout

        // Send message and handle SDK events
        console.log(`[ClaudeEngine] Calling sendMessage...`);
        claudeSession.sendMessage(
          userMessage,
          (sdkMessage: SDKMessage) => {
            console.log(`[ClaudeEngine] SDK callback received: type=${sdkMessage.type}`);
            
            // Update session ID if received
            if (sdkMessage.session_id) {
              finalSessionId = sdkMessage.session_id;
              adapter.setThreadId(sdkMessage.session_id);
              console.log(`[ClaudeEngine] Session ID updated: ${sdkMessage.session_id}`);
            }

            // Convert SDK message to AGUI events
            const aguiEvents = adapter.convert(sdkMessage as any);
            console.log(`[ClaudeEngine] Converted to ${aguiEvents.length} AGUI events`);
            
            if (aguiEvents.length > 0) {
              hasReceivedStreamEvents = true;
            }

            // Send each AGUI event
            for (const event of aguiEvents) {
              onAguiEvent(event);
            }

            // Handle result event
            if (sdkMessage.type === 'result') {
              console.log(`[ClaudeEngine] Result received, finalizing...`);
              resultReceived = true;
              clearTimeout(timeout);
              
              // Finalize adapter (close any open blocks)
              const finalEvents = adapter.finalize();
              for (const event of finalEvents) {
                onAguiEvent(event);
              }
              
              resolve();
            }
          }
        ).then((reqId: string) => {
          console.log(`[ClaudeEngine] sendMessage returned: requestId=${reqId}`);
        }).catch(reject);
      });

      // Wait for the result
      await resultPromise;
      console.log(`📨 [ClaudeEngine] Request completed, sessionId: ${finalSessionId}`);

      return { sessionId: finalSessionId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClaudeEngine] Error:', errorMessage);
      
      // Send error event
      onAguiEvent(adapter.createRunError(errorMessage, 'CLAUDE_ENGINE_ERROR'));
      
      // Send run finished
      onAguiEvent(adapter.createRunFinished());
      
      throw error;
    }
  }

  /**
   * Interrupt a session
   */
  async interruptSession(sessionId: string): Promise<void> {
    console.log(`🛑 [ClaudeEngine] Interrupting session: ${sessionId}`);
    const result = await sessionManager.interruptSession(sessionId);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to interrupt session');
    }
  }
}

// Export singleton instance
export const claudeEngine = new ClaudeEngine();
