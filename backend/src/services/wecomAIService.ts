/**
 * WeChat Work AI Service
 *
 * Adapts AgentStudio's AI architecture for WeChat Work (via hitl.woa.com)
 * Follows the SlackAIService pattern but uses polling instead of webhooks
 */

import { sessionManager } from './sessionManager.js';
import { AgentStorage } from './agentStorage.js';
import { ProjectMetadataStorage } from './projectMetadataStorage.js';
import { WecomHitlClient } from './wecomHitlClient.js';
import { buildQueryOptions } from '../utils/claudeUtils.js';
import { getDefaultVersionId, getVersionByIdInternal } from './claudeVersionStorage.js';
import type { WecomMessage, WecomSessionMapping, WecomListenerState, WecomConfig } from '../types/wecom.js';
import type { ProjectWithAgentInfo } from '../types/projects.js';

const WECOM_MESSAGES = {
  THINKING: '🤔 正在思考...',
  COMPLETED: '✅ 完成',
  ERROR: (msg: string) => `❌ 错误: ${msg}`,
  SESSION_BUSY: '🚦 正在处理其他消息，请稍后再试...',
  BOT_READY: '🤖 AgentStudio Bot 就绪，@我 发送任务\n\n'
    + '支持格式:\n'
    + '• `agent:<名称> <消息>` - 指定 Agent\n'
    + '• `proj:<目录名> <消息>` - 指定项目\n'
    + '• `/agents` - 查看可用 Agent\n'
    + '• `/projects` - 查看可用项目\n'
    + '• `/stop` - 停止监听',
};

export class WecomAIService {
  private client: WecomHitlClient;
  private agentStorage: AgentStorage;
  private projectStorage: ProjectMetadataStorage;
  private config: WecomConfig;
  private sessionMappings = new Map<string, WecomSessionMapping>();
  private listenerState: WecomListenerState = {
    running: false,
    messagesProcessed: 0,
  };
  private processing = false;

  constructor(config: WecomConfig) {
    this.config = config;
    this.client = new WecomHitlClient(config);
    this.agentStorage = new AgentStorage();
    this.projectStorage = new ProjectMetadataStorage();
  }

  getState(): WecomListenerState {
    return { ...this.listenerState };
  }

  async startListener(): Promise<void> {
    if (this.listenerState.running) return;
    this.listenerState = {
      running: true,
      startedAt: Date.now(),
      messagesProcessed: 0,
    };
    console.log('✅ WeChat Work listener started');
    this.listenLoop().catch((err) => {
      console.error('❌ WeChat Work listener fatal error:', err);
      this.listenerState.running = false;
    });
  }

  stopListener(): void {
    this.listenerState.running = false;
    console.log('⏹️  WeChat Work listener stopped');
  }

  private async listenLoop(): Promise<void> {
    while (this.listenerState.running) {
      try {
        const reply = await this.client.sendAndWaitReply(
          WECOM_MESSAGES.BOT_READY,
          this.config.pollInterval,
          this.config.timeout,
        );

        if (!reply) {
          console.log('[wecom] Listen timeout, restarting...');
          continue;
        }

        await this.handleMessage({
          content: reply.content,
          fromUser: reply.from_user,
          timestamp: reply.timestamp,
          msgType: 'text',
        });
      } catch (err: any) {
        console.error('[wecom] Listen error:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  /**
   * Handle an incoming WeChat Work message
   * Can be called from the listener or via REST API
   */
  async handleMessage(msg: WecomMessage): Promise<void> {
    const userId = msg.fromUser.alias || msg.fromUser.name;
    console.log(`[wecom] Message from ${userId}: ${msg.content.slice(0, 100)}`);

    this.listenerState.messagesProcessed++;
    this.listenerState.lastMessageAt = Date.now();

    if (this.processing) {
      await this.client.sendMessage(WECOM_MESSAGES.SESSION_BUSY);
      return;
    }

    const parsed = this.parseMessage(msg.content);

    if (parsed.command) {
      await this.handleCommand(parsed.command);
      return;
    }

    this.processing = true;
    try {
      await this.processWithClaude(userId, parsed, msg);
    } finally {
      this.processing = false;
    }
  }

  private async processWithClaude(
    userId: string,
    parsed: { agentId?: string; project?: string; message: string },
    msg: WecomMessage,
  ): Promise<void> {
    const agentId = parsed.agentId || this.resolveAgentId(userId);
    const agent = this.agentStorage.getAgent(agentId);
    if (!agent || !agent.enabled) {
      await this.client.sendMessage(WECOM_MESSAGES.ERROR(`Agent "${agentId}" 不可用`));
      return;
    }

    const projectPath = this.resolveProjectPath(userId, parsed.project);
    const agentDisplayName = agent.name || agentId;
    const projectDisplayName = projectPath?.split('/').pop() || '默认';

    await this.client.sendMessage(
      `⏳ ${agentDisplayName} 正在处理...\n📁 项目: ${projectDisplayName}`,
    );

    try {
      const mapping = this.getOrCreateMapping(userId, agentId, projectPath);
      const existingSessionId = mapping.sessionId;

      let claudeSession = existingSessionId
        ? sessionManager.getSession(existingSessionId)
        : null;

      const versionConfig = await this.getClaudeVersionConfig();

      if (!claudeSession) {
        const queryOptions = await buildQueryOptions(
          agent,
          projectPath || undefined,
          undefined,
          agent.permissionMode || 'default',
          versionConfig.model,
          undefined,
          versionConfig.env || undefined,
        );

        claudeSession = await sessionManager.createNewSession(agentId, queryOptions.queryOptions);
        console.log(`[wecom] Created new session for ${userId}`);
      }

      const userMessage = parsed.message;

      const responseState = {
        thinkingContent: '',
        fullResponse: '',
        toolSummaries: [] as string[],
        lastUpdateTime: 0,
      };

      const UPDATE_THROTTLE = 5000;

      await new Promise<void>((resolve, reject) => {
        claudeSession!.sendMessage(userMessage, async (sdkMessage: any) => {
          try {
            if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init' && sdkMessage.session_id) {
              sessionManager.confirmSessionId(claudeSession!, sdkMessage.session_id);
              this.updateMapping(userId, { sessionId: sdkMessage.session_id });
              console.log(`[wecom] Session confirmed: ${sdkMessage.session_id}`);
            }

            if (sdkMessage.type === 'assistant' && sdkMessage.subtype === 'thinking') {
              responseState.thinkingContent = sdkMessage.thinking || sdkMessage.text || '';
            }

            if (sdkMessage.type === 'assistant' && sdkMessage.subtype !== 'thinking') {
              const text = this.extractText(sdkMessage);
              if (text) {
                responseState.fullResponse += text;
                responseState.thinkingContent = '';
              }
            }

            if (sdkMessage.type === 'tool_use' && sdkMessage.subtype === 'start') {
              const toolName = sdkMessage.tool_use?.name || 'unknown';
              const summary = this.formatToolUse(toolName, sdkMessage.tool_use?.input);
              responseState.toolSummaries.push(summary);
              responseState.fullResponse += `${responseState.fullResponse ? '\n' : ''}${summary}\n`;
              responseState.thinkingContent = '';
            }

            const now = Date.now();
            if (now - responseState.lastUpdateTime > UPDATE_THROTTLE && responseState.toolSummaries.length > 0) {
              responseState.lastUpdateTime = now;
              const progress = `⏳ 进行中...\n${responseState.toolSummaries.slice(-3).join('\n')}`;
              await this.client.sendMessage(progress).catch(() => {});
            }

            if (sdkMessage.type === 'result') {
              resolve();
            }
          } catch (err) {
            console.error('[wecom] SDK message handler error:', err);
          }
        }).catch(reject);
      });

      const finalText = this.buildFinalOutput(responseState);
      await this.client.sendMessage(`✅ ${agentDisplayName} 完成\n\n${finalText}`);
    } catch (err: any) {
      console.error('[wecom] Claude processing error:', err);
      await this.client.sendMessage(WECOM_MESSAGES.ERROR(err.message?.slice(0, 200) || '未知错误'));
    }
  }

  private async handleCommand(cmd: string): Promise<void> {
    switch (cmd) {
      case '/agents': {
        const agents = this.agentStorage.getAllAgents().filter((a: any) => a.enabled);
        const list = agents
          .map((a: any) => `• \`${a.id}\` - ${a.name}: ${a.description || ''}`)
          .join('\n');
        await this.client.sendMessage(`🤖 可用 Agent:\n${list || '(无)'}\n\n使用: agent:<名称> <消息>`);
        break;
      }
      case '/projects': {
        const projects = this.projectStorage.getAllProjects();
        const list = projects
          .slice(0, 15)
          .map((p: ProjectWithAgentInfo) => `• \`${p.dirName}\` - ${p.name}`)
          .join('\n');
        const more = projects.length > 15 ? `\n... 还有 ${projects.length - 15} 个` : '';
        await this.client.sendMessage(`📁 可用项目:\n${list}${more}\n\n使用: proj:<目录名> <消息>`);
        break;
      }
      case '/stop':
        await this.client.sendMessage('👋 Bot 已停止监听');
        this.stopListener();
        break;
      case '/status': {
        const state = this.getState();
        await this.client.sendMessage(
          `📊 状态:\n• 运行中: ${state.running}\n• 已处理: ${state.messagesProcessed} 条\n• 活跃会话: ${this.sessionMappings.size}`,
        );
        break;
      }
      default:
        await this.client.sendMessage(`❓ 未知命令: ${cmd}\n可用: /agents, /projects, /status, /stop`);
    }
  }

  private parseMessage(raw: string): { agentId?: string; project?: string; command?: string; message: string } {
    const text = raw.trim();

    if (text.startsWith('/')) {
      return { command: text.split(/\s/)[0].toLowerCase(), message: text };
    }

    let message = text;
    let agentId: string | undefined;
    let project: string | undefined;

    const agentMatch = message.match(/agent:(\S+)/i);
    if (agentMatch) {
      agentId = agentMatch[1];
      message = message.replace(/agent:\S+/gi, '').trim();
    }

    const projMatch = message.match(/proj:(\S+)/i);
    if (projMatch) {
      project = projMatch[1];
      message = message.replace(/proj:\S+/gi, '').trim();
    }

    // Also support Chinese format: "在 xxx yyy"
    if (!project) {
      const cnMatch = message.match(/^在\s+(\S+)\s+(.+)$/s);
      if (cnMatch) {
        project = cnMatch[1];
        message = cnMatch[2];
      }
    }

    return { agentId, project, message };
  }

  private resolveAgentId(userId: string): string {
    const existing = this.sessionMappings.get(userId);
    return existing?.agentId || this.config.defaultAgentId;
  }

  private resolveProjectPath(userId: string, projectName?: string): string | null {
    if (projectName) {
      const allProjects = this.projectStorage.getAllProjects();
      const match = allProjects.find(
        (p: ProjectWithAgentInfo) =>
          p.dirName.toLowerCase() === projectName.toLowerCase() ||
          p.dirName.toLowerCase().includes(projectName.toLowerCase()),
      );
      if (match) return match.realPath || match.path;
    }

    const existing = this.sessionMappings.get(userId);
    if (existing?.projectPath) return existing.projectPath;

    if (this.config.defaultProject) {
      const allProjects = this.projectStorage.getAllProjects();
      const def = allProjects.find(
        (p: ProjectWithAgentInfo) => p.realPath === this.config.defaultProject || p.path === this.config.defaultProject,
      );
      if (def) return def.realPath || def.path;
    }

    return null;
  }

  private getOrCreateMapping(userId: string, agentId: string, projectPath: string | null): WecomSessionMapping {
    let mapping = this.sessionMappings.get(userId);
    if (!mapping) {
      mapping = {
        userId,
        sessionId: '',
        agentId,
        projectPath: projectPath || undefined,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessionMappings.set(userId, mapping);
    } else {
      mapping.agentId = agentId;
      if (projectPath) mapping.projectPath = projectPath;
      mapping.lastActivity = Date.now();
    }
    return mapping;
  }

  private updateMapping(userId: string, update: Partial<WecomSessionMapping>): void {
    const existing = this.sessionMappings.get(userId);
    if (existing) {
      Object.assign(existing, update, { lastActivity: Date.now() });
    }
  }

  private async getClaudeVersionConfig() {
    try {
      const defaultVersionId = await getDefaultVersionId();
      if (defaultVersionId) {
        const ver = await getVersionByIdInternal(defaultVersionId);
        if (ver) {
          const model = ver.models?.length ? ver.models[0].id : undefined;
          return { versionId: ver.id, model, env: ver.environmentVariables || null };
        }
      }
    } catch (err) {
      console.error('[wecom] Failed to get Claude version:', err);
    }
    return { env: null } as { versionId?: string; model?: string; env: Record<string, string> | null };
  }

  private extractText(sdkMessage: any): string {
    if (sdkMessage.message?.content && Array.isArray(sdkMessage.message.content)) {
      return sdkMessage.message.content
        .filter((b: any) => b.type === 'text' && b.text)
        .map((b: any) => b.text)
        .join('');
    }
    if (sdkMessage.subtype === 'text' && sdkMessage.text) return sdkMessage.text;
    if (typeof sdkMessage.message === 'string') return sdkMessage.message;
    return '';
  }

  private formatToolUse(name: string, input: any): string {
    if (!input) return `🔧 ${name}()`;
    const params: string[] = [];
    for (const [k, v] of Object.entries(input).slice(0, 2)) {
      const s = typeof v === 'string' ? (v.length > 40 ? v.slice(0, 37) + '...' : v) : JSON.stringify(v)?.slice(0, 40);
      params.push(`${k}=${s}`);
    }
    return `🔧 ${name}(${params.join(', ')})`;
  }

  private buildFinalOutput(state: { fullResponse: string; toolSummaries: string[] }): string {
    const text = state.fullResponse.trim();
    if (!text && state.toolSummaries.length > 0) {
      return `执行了 ${state.toolSummaries.length} 个操作:\n${state.toolSummaries.join('\n')}`;
    }
    const MAX = 4000;
    return text.length > MAX ? text.slice(0, MAX) + '\n...(已截断)' : text || '(无输出)';
  }
}
