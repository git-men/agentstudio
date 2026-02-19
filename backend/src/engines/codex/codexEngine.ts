/**
 * Codex Engine Implementation
 *
 * Wraps Codex CLI (`codex exec --json`) and emits standardized AGUI events.
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
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
  EngineImageData,
  SessionDetail,
} from '../types.js';
import { saveImageToHiddenDir } from '../../utils/sessionUtils.js';
import { CodexAguiAdapter } from './aguiAdapter.js';
import { readCodexHistorySession, readCodexHistorySessions } from './historyParser.js';

interface CodexSession {
  id: string;
  process: ChildProcess;
  workspace: string;
  startedAt: Date;
}

interface CodexExecutionResult {
  sessionId: string;
  failed: boolean;
  errorMessage?: string;
}

const MODEL_CACHE_TTL = 5 * 60 * 1000;
let cachedModels: ModelInfo[] | null = null;
let modelsCacheTime = 0;

function findCodexCommand(): string {
  const possiblePaths = [
    process.env.CODEX_CLI_PATH,
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ];

  for (const candidate of possiblePaths) {
    if (!candidate) continue;
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const fromPath = execSync('which codex', { stdio: 'pipe' }).toString().trim();
    if (fromPath) return fromPath;
  } catch {
    // ignored
  }

  return 'codex';
}

function shouldRetryWithoutResume(errorMessage?: string): boolean {
  if (!errorMessage) return false;
  const normalized = errorMessage.toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('unknown session') ||
    normalized.includes('no conversation found') ||
    normalized.includes('thread')
  );
}

function getCodexModelsCachePath(): string {
  return path.join(os.homedir(), '.codex', 'models_cache.json');
}

function processImagesForCodex(images: EngineImageData[] | undefined, workspace: string): string[] {
  if (!images || images.length === 0) return [];

  const filePaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const relativePath = saveImageToHiddenDir(image.data, image.mediaType, i + 1, workspace);
    filePaths.push(path.join(workspace, relativePath));
  }
  return filePaths;
}

export class CodexEngine implements IAgentEngine {
  readonly type: EngineType = 'codex';

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

  private activeSessions: Map<string, CodexSession> = new Map();

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
      console.warn('[CodexEngine] Failed to read models cache:', error);
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
    return this.activeSessions.size;
  }

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
      envVars,
      permissionMode = 'default',
    } = config;

    const imagePaths = processImagesForCodex(images, workspace);

    if (existingSessionId) {
      const resumed = await this.executeCodexCommand(
        message,
        workspace,
        model,
        imagePaths,
        envVars,
        permissionMode,
        existingSessionId,
        true,
        onAguiEvent
      );

      if (resumed.failed && shouldRetryWithoutResume(resumed.errorMessage)) {
        console.log(`[CodexEngine] Resume failed for session ${existingSessionId}, retrying without resume`);
        const retried = await this.executeCodexCommand(
          message,
          workspace,
          model,
          imagePaths,
          envVars,
          permissionMode,
          undefined,
          false,
          onAguiEvent
        );
        return { sessionId: retried.sessionId };
      }

      return { sessionId: resumed.sessionId };
    }

    const result = await this.executeCodexCommand(
      message,
      workspace,
      model,
      imagePaths,
      envVars,
      permissionMode,
      undefined,
      false,
      onAguiEvent
    );

    return { sessionId: result.sessionId };
  }

  private buildCodexArgs(
    workspace: string,
    model: string | undefined,
    imagePaths: string[],
    permissionMode: EngineConfig['permissionMode'],
    existingSessionId: string | undefined,
    useResume: boolean
  ): string[] {
    const options: string[] = ['--json', '--skip-git-repo-check'];

    // `codex exec resume` has a smaller option surface (no --cd/--sandbox).
    // Keep resume args compatible with recent Codex CLI versions.
    if (useResume) {
      if (permissionMode === 'bypassPermissions') {
        options.push('--dangerously-bypass-approvals-and-sandbox');
      }
    } else if (permissionMode === 'bypassPermissions') {
      options.push('--dangerously-bypass-approvals-and-sandbox');
    } else if (permissionMode === 'plan') {
      options.push('--sandbox', 'read-only');
    } else {
      options.push('--sandbox', 'workspace-write');
    }

    if (model && model !== 'auto') {
      options.push('--model', model);
    }

    for (const imagePath of imagePaths) {
      options.push('--image', imagePath);
    }

    if (existingSessionId && useResume) {
      return ['exec', 'resume', ...options, existingSessionId, '-'];
    }
    return ['exec', ...options, '--cd', workspace, '-'];
  }

  private executeCodexCommand(
    message: string,
    workspace: string,
    model: string | undefined,
    imagePaths: string[],
    envVars: Record<string, string> | undefined,
    permissionMode: EngineConfig['permissionMode'],
    existingSessionId: string | undefined,
    useResume: boolean,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<CodexExecutionResult> {
    const initialSessionId = existingSessionId || uuidv4();
    const adapter = new CodexAguiAdapter(initialSessionId);
    const codexCmd = findCodexCommand();
    const args = this.buildCodexArgs(
      workspace,
      model,
      imagePaths,
      permissionMode,
      existingSessionId,
      useResume
    );

    return new Promise((resolve) => {
      let trackedSessionId = initialSessionId;
      let buffer = '';
      let failed = false;
      let errorMessage: string | undefined;
      let settled = false;

      const codexProcess = spawn(codexCmd, args, {
        cwd: workspace,
        env: {
          ...process.env,
          ...(envVars || {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const session: CodexSession = {
        id: trackedSessionId,
        process: codexProcess,
        workspace,
        startedAt: new Date(),
      };
      this.activeSessions.set(trackedSessionId, session);

      const emitEvents = (events: AGUIEvent[]) => {
        for (const event of events) {
          if (event.type === 'RUN_ERROR') {
            failed = true;
            errorMessage = (event as any).error || errorMessage;
          }

          if (event.type === 'RUN_STARTED' && typeof (event as any).threadId === 'string') {
            const newId = (event as any).threadId as string;
            if (newId && newId !== trackedSessionId) {
              this.activeSessions.delete(trackedSessionId);
              trackedSessionId = newId;
              session.id = newId;
              this.activeSessions.set(newId, session);
            }
          }

          if (
            event.type === 'CUSTOM' &&
            (event as any).name === 'session_id_updated' &&
            typeof (event as any).data?.sessionId === 'string'
          ) {
            const newId = (event as any).data.sessionId as string;
            if (newId && newId !== trackedSessionId) {
              this.activeSessions.delete(trackedSessionId);
              trackedSessionId = newId;
              session.id = newId;
              this.activeSessions.set(newId, session);
            }
          }

          onAguiEvent(event);
        }
      };

      const settle = (result: CodexExecutionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      codexProcess.on('error', (error) => {
        if (settled) return;
        failed = true;
        errorMessage = error.message;
        emitEvents([adapter.createRunError(`Failed to start Codex CLI: ${error.message}`, 'SPAWN_ERROR')]);
        emitEvents(adapter.finalize());
        this.activeSessions.delete(trackedSessionId);
        settle({
          sessionId: adapter.getThreadId(),
          failed,
          errorMessage,
        });
      });

      codexProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const events = adapter.parseStreamLine(line);
          if (events.length > 0) emitEvents(events);
        }
      });

      codexProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          console.log(`[CodexEngine] stderr: ${text}`);
        }
      });

      codexProcess.stdin?.write(`${message}\n`);
      codexProcess.stdin?.end();

      codexProcess.on('close', (code) => {
        if (settled) return;
        if (buffer.trim()) {
          emitEvents(adapter.parseStreamLine(buffer));
        }

        if (code !== 0 && !failed) {
          failed = true;
          errorMessage = `Codex CLI exited with code ${code}`;
          emitEvents([adapter.createRunError(errorMessage, 'PROCESS_EXIT')]);
        }

        emitEvents(adapter.finalize());
        this.activeSessions.delete(trackedSessionId);
        settle({
          sessionId: adapter.getThreadId(),
          failed,
          errorMessage,
        });
      });
    });
  }

  async interruptSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.process.kill('SIGTERM');
    this.activeSessions.delete(sessionId);
  }

  async readSessions(projectPath: string): Promise<SessionDetail[]> {
    return readCodexHistorySessions(projectPath);
  }

  async readSession(projectPath: string, sessionId: string): Promise<SessionDetail | null> {
    return readCodexHistorySession(projectPath, sessionId);
  }

  cleanupStaleSessions(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.startedAt.getTime() > maxAgeMs) {
        session.process.kill('SIGTERM');
        this.activeSessions.delete(sessionId);
      }
    }
  }
}

export const codexEngine = new CodexEngine();
