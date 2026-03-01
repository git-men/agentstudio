/**
 * Codex SDK Engine Implementation
 *
 * Uses @openai/codex-sdk TypeScript library to interact with the Codex agent.
 * Implements IAgentEngine and converts SDK ThreadEvents into AGUI events.
 *
 * NOTE: @openai/codex-sdk is an ESM-only package. Since this backend uses CJS
 * module resolution, we load it via dynamic import() instead of static import.
 */

import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  IAgentEngine,
  EngineType,
  EngineConfig,
  EngineCapabilities,
  AGUIEvent,
  ModelInfo,
  SessionDetail,
} from '../types.js';
import { saveImageToHiddenDir } from '../../utils/sessionUtils.js';
import { CodexSdkAguiAdapter } from './codexSdkAguiAdapter.js';
import { readCodexHistorySession, readCodexHistorySessions } from '../codex/historyParser.js';

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

let _codexSdkModule: typeof import('@openai/codex-sdk') | null = null;

async function loadCodexSdk(): Promise<typeof import('@openai/codex-sdk')> {
  if (!_codexSdkModule) {
    _codexSdkModule = await import('@openai/codex-sdk');
  }
  return _codexSdkModule;
}

const MODEL_CACHE_TTL = 5 * 60 * 1000;
let cachedModels: ModelInfo[] | null = null;
let modelsCacheTime = 0;

function getCodexModelsCachePath(): string {
  return path.join(os.homedir(), '.codex', 'models_cache.json');
}

export class CodexSdkEngine implements IAgentEngine {
  readonly type: EngineType = 'codex-sdk';

  readonly capabilities: EngineCapabilities = {
    mcp: {
      supported: true,
      configPath: '~/.codex/config.toml',
      dynamicToolLoading: false,
    },
    skills: {
      supported: true,
      skillsPath: '~/.codex/skills',
      ruleFormat: 'markdown',
    },
    features: {
      multiTurn: true,
      thinking: true,
      vision: true,
      streaming: true,
      subagents: false,
      codeExecution: true,
    },
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
    ui: {
      showMcpToolSelector: false,
      showImageUpload: true,
      showPermissionSelector: true,
      showProviderSelector: false,
      showModelSelector: true,
      showEnvVars: true,
    },
  };

  private codexInstance: any = null;
  private activeAbortControllers: Map<string, AbortController> = new Map();

  private async getCodex(envOverrides?: Record<string, string>): Promise<any> {
    const { Codex } = await loadCodexSdk();
    if (envOverrides && Object.keys(envOverrides).length > 0) {
      return new Codex({
        env: { ...process.env as Record<string, string>, ...envOverrides },
      });
    }
    if (!this.codexInstance) {
      this.codexInstance = new Codex();
    }
    return this.codexInstance;
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    const now = Date.now();
    if (cachedModels && now - modelsCacheTime < MODEL_CACHE_TTL) {
      return cachedModels;
    }

    try {
      const cachePath = getCodexModelsCachePath();
      if (existsSync(cachePath)) {
        const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
          models?: Array<{
            slug?: string;
            display_name?: string;
            description?: string;
            priority?: number;
          }>;
        };

        const models = (parsed.models || [])
          .filter(model => typeof model.slug === 'string' && model.slug.length > 0)
          .sort((a, b) => (a.priority || 0) - (b.priority || 0))
          .map((model) => ({
            id: model.slug as string,
            name: model.display_name || model.slug || 'unknown',
            description: model.description,
            isVision: true,
            isThinking: (model.slug || '').includes('thinking'),
          }));

        if (models.length > 0) {
          cachedModels = models;
          modelsCacheTime = now;
          return models;
        }
      }
    } catch (error) {
      console.warn('[CodexSdkEngine] Failed to read models cache:', error);
    }

    const fallbackModels: ModelInfo[] = [
      { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', isVision: true },
      { id: 'gpt-5.1-codex', name: 'gpt-5.1-codex', isVision: true },
      { id: 'gpt-5-codex', name: 'gpt-5-codex', isVision: true },
    ];
    cachedModels = fallbackModels;
    modelsCacheTime = now;
    return fallbackModels;
  }

  getActiveSessionCount(): number {
    return this.activeAbortControllers.size;
  }

  async sendMessage(
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void,
  ): Promise<{ sessionId: string }> {
    const {
      workspace,
      sessionId: existingSessionId,
      model,
      images,
      envVars,
      permissionMode = 'default',
    } = config;

    const sandboxMode = this.mapSandboxMode(permissionMode);
    const input = this.buildInput(message, images, workspace);

    const threadOptions: Record<string, any> = {
      model: model && model !== 'auto' ? model : undefined,
      sandboxMode,
      workingDirectory: workspace,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
    };

    if (config.additionalDirectories) {
      threadOptions.additionalDirectories = config.additionalDirectories;
    }

    const sessionId = existingSessionId || uuidv4();
    const adapter = new CodexSdkAguiAdapter(sessionId);
    const abortController = new AbortController();

    this.activeAbortControllers.set(sessionId, abortController);

    const emitEvents = (events: AGUIEvent[]) => {
      for (const event of events) {
        onAguiEvent(event);
      }
    };

    try {
      const codex = await this.getCodex(envVars);

      const thread = existingSessionId
        ? codex.resumeThread(existingSessionId, threadOptions)
        : codex.startThread(threadOptions);

      const streamedTurn = await thread.runStreamed(input, {
        signal: abortController.signal,
      });

      for await (const event of streamedTurn.events) {
        if (abortController.signal.aborted) break;
        const aguiEvents = adapter.convertThreadEvent(event as unknown as Record<string, unknown>);
        emitEvents(aguiEvents);
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        console.log(`[CodexSdkEngine] Session ${sessionId} was aborted`);
      } else {
        console.error('[CodexSdkEngine] Error during message processing:', error);
        emitEvents(adapter.handleError(error instanceof Error ? error : new Error(String(error))));
      }
    } finally {
      emitEvents(adapter.finalize());
      this.activeAbortControllers.delete(sessionId);
    }

    return { sessionId: adapter.getThreadId() };
  }

  async interruptSession(sessionId: string): Promise<void> {
    const controller = this.activeAbortControllers.get(sessionId);
    if (!controller) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    controller.abort();
    this.activeAbortControllers.delete(sessionId);
  }

  async readSessions(projectPath: string): Promise<SessionDetail[]> {
    return readCodexHistorySessions(projectPath);
  }

  async readSession(projectPath: string, sessionId: string): Promise<SessionDetail | null> {
    return readCodexHistorySession(projectPath, sessionId);
  }

  mapSandboxMode(permissionMode: EngineConfig['permissionMode']): SandboxMode {
    switch (permissionMode) {
      case 'plan':
        return 'read-only';
      case 'bypassPermissions':
        return 'danger-full-access';
      default:
        return 'workspace-write';
    }
  }

  buildInput(
    message: string,
    images: EngineConfig['images'],
    workspace: string,
  ): any {
    if (!images || images.length === 0) {
      return message;
    }

    const SUPPORTED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
    const inputItems: Array<{ type: string; text?: string; path?: string }> = [{ type: 'text', text: message }];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (!SUPPORTED_MEDIA_TYPES.has(image.mediaType)) {
        console.warn(`[CodexSdkEngine] Unsupported image type: ${image.mediaType}, skipping`);
        continue;
      }
      const relativePath = saveImageToHiddenDir(image.data, image.mediaType, i + 1, workspace);
      const absolutePath = path.join(workspace, relativePath);
      inputItems.push({ type: 'local_image', path: absolutePath });
    }

    return inputItems;
  }
}

export const codexSdkEngine = new CodexSdkEngine();
