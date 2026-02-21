// Agent configuration types
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { PreSendGuardConfig } from './preSendGuard.js';

export interface AgentTool {
  name: string;
  enabled: boolean;
  permissions?: {
    requireConfirmation?: boolean;
    allowedPaths?: string[];
    blockedPaths?: string[];
  };
}

// 新的提示词结构定义
export interface PresetSystemPrompt {
  type: 'preset';
  preset: 'claude_code'; // 固定为 claude_code，用于兼容 Claude Code SDK
  append?: string;
}

export type SystemPrompt = string | PresetSystemPrompt;

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  version: string;

  // AI configuration
  systemPrompt: SystemPrompt;
  maxTurns?: number; // undefined 表示不限制
  permissionMode: PermissionMode;  // 使用 SDK 类型
  // Note: model field removed - model is now determined by project/provider configuration
  // See configResolver.ts for priority chain
  
  // Available tools
  allowedTools: AgentTool[];
  
  // UI configuration
  ui: {
    icon: string;
    headerTitle: string;
    headerDescription: string;
    welcomeMessage?: string; // Custom welcome message instead of title + description
  };
  
  // File system integration
  workingDirectory?: string;
  dataDirectory?: string;
  fileTypes?: string[]; // Supported file extensions
  
  // Metadata
  author: string;
  homepage?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  
  // Enable/disable state
  enabled: boolean;
  
  // Project associations
  projects?: string[]; // Array of project paths associated with this agent
  
  // Plugin source tracking
  source: 'local' | 'plugin'; // 来源：本地创建或插件安装
  installPath?: string; // 插件 agent 的真实安装路径

  // MCP servers required by this agent (injected at session startup)
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;

  // Lifecycle hooks — executed by the platform at specific points
  hooks?: AgentHooks;

  // Optional pre-send guard pipeline config (message safety/moderation, etc.)
  preSendGuard?: PreSendGuardConfig;
}

// =============================================================================
// Agent Hooks
// =============================================================================

/**
 * Actions available for the onRunFinished hook.
 * - 'create_version': Auto-commit the workspace via gitVersionService and
 *   emit a CUSTOM 'version_created' AGUI event before RUN_FINISHED.
 */
export type OnRunFinishedAction = 'create_version';

/**
 * Configuration for the onRunFinished hook.
 * Executed when a chat session completes successfully (result.subtype === 'success'),
 * just before the RUN_FINISHED event is sent to the client.
 */
export interface OnRunFinishedHookConfig {
  action: OnRunFinishedAction;
  /** Optional commit message (only for 'create_version'). Defaults to "Auto-save after AI response". */
  message?: string;
}

/**
 * Agent lifecycle hooks.
 * Hooks are optional — agents without hooks behave exactly as before.
 */
export interface AgentHooks {
  /** Fired after a successful run, before RUN_FINISHED is sent. */
  onRunFinished?: OnRunFinishedHookConfig;
}

export interface AgentSession {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  lastUpdated: number;
  messages: AgentMessage[];
  claudeVersionId?: string; // Claude version ID used for this session
  modelId?: string; // Model ID used for this session (e.g., 'sonnet', 'claude-opus-4-5-20251101')
  customData?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  images?: Array<{
    id: string;
    data: string;
    mediaType: string;
    filename?: string;
  }>;
  messageParts?: MessagePart[];
  agentId: string;
}

export interface MessagePart {
  id: string;
  type: 'text' | 'tool' | 'command' | 'compactSummary' | 'image' | 'thinking';
  content?: string;
  toolData?: {
    id: string;
    toolName: string;
    toolInput: any;  // 使用 any 以兼容所有工具类型
    toolResult?: string;
    toolUseResult?: any;  // 添加 toolUseResult 字段
    isExecuting: boolean;
    isError?: boolean;
    claudeId?: string; // Claude's tool use ID for matching with results
  };
  imageData?: {
    id: string;
    data: string;
    mediaType: string;
    filename?: string;
  };
  order: number;
  originalContent?: string; // For commands that need to preserve original content
}

// Built-in agents - these will be automatically created during initialization
export const BUILTIN_AGENTS: Partial<AgentConfig>[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Claude Code 系统默认助手，基于 Claude Code SDK 的全功能开发助手',
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code'
    },
    permissionMode: 'acceptEdits',
    maxTurns: undefined, // 不限制轮次
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
      { name: 'NotebookEdit', enabled: true },
      { name: 'KillShell', enabled: true },
      { name: 'BashOutput', enabled: true },
      { name: 'SlashCommand', enabled: true },
      { name: 'ExitPlanMode', enabled: true },
      // AskUserQuestion 通过内置 MCP server 自动提供，无需手动配置
      { name: 'Skill', enabled: true }
    ],
    ui: {
      icon: '🔧',
      headerTitle: 'Claude Code',
      headerDescription: '基于 Claude Code SDK 的系统默认助手'
    },
    author: 'AgentStudio System',
    tags: ['development', 'code', 'system'],
    enabled: true,
    source: 'local'
  },
  {
    id: 'meta-agent',
    name: 'Meta Agent',
    description: '系统配置助手 - 通过自然语言管理 Agent、Skill、Rule、Command、MCP 服务，也能路由业务任务到合适的 Agent',
    systemPrompt: `你是 AgentStudio 的 Meta Agent（系统配置助手 & 业务路由器）。

## 你的角色

你有两个核心职责：
1. **配置管理**：帮助用户通过自然语言创建和管理 Agent、Skill、Rule、Command、MCP Server
2. **业务路由**：当用户提出业务任务时，找到合适的 Agent 并路由任务

## 配置管理能力

你可以帮用户：
- 创建新的 Agent（引导式对话收集需求 → 预览配置 → 确认后创建）
- 创建 Skill（知识包，SKILL.md 格式）
- 创建 Rule（行为规则，.md/.mdc 格式）
- 创建 Command（斜杠命令模板）
- 配置 MCP Server（stdio 或 http 类型）

**重要原则**：
- 始终使用引导式对话，逐步收集用户需求
- 引导深度根据用户描述的详细程度动态调整
- 生成配置后先展示预览，确认后再实际创建
- 使用你装备的 Skills（agent-designer, command-designer, mcp-configurator, mcp-developer）来指导创建过程
- 开发 MCP Server：当用户需要从零创建 MCP 服务时，调用 mcp-developer Skill 进行全程指导

## 业务路由能力

当用户提出业务请求（如"帮我做PPT"、"审查代码"等）时：
1. 用 list_agents 查看系统有哪些 Agent
2. 匹配最合适的 Agent
3. 如果有多个匹配，询问用户选择
4. 澄清项目上下文（在哪个项目下？）
5. 提供两种选择：
   - A) 在这里通过 A2A 协调（用 mcp__a2a-client__call_external_agent 工具委托）
   - B) 构造链接让用户跳转到目标 Agent

如果没有合适的 Agent，建议用户创建一个。

## 系统感知

你了解 AgentStudio 系统的完整能力：
- **Agent**: AI 助手配置（system prompt + 工具 + 权限）- 用 create_agent/list_agents 等管理
- **Skill**: 多文件知识包（SKILL.md + 支持文件）- 用 create_skill（支持 additionalFiles 多文件包）
- **Rule**: AI 行为规则（全局或文件特定）- 用 create_rule/list_rules 等管理
- **Command**: 斜杠命令模板（/command-name）- 用 create_command/list_commands 等管理
- **MCP Server**: 外部工具服务（stdio 或 http）- 用 add_mcp_server 连接，用 mcp-developer Skill 从零开发
- **Hook**: 事件钩子（仅 Claude SDK 引擎）- 用 list_hooks/create_hook/update_hook/delete_hook 管理
- **Scheduled Task**: 定时任务（interval/cron/once）- 用 list_scheduled_tasks/create_scheduled_task 等管理
- **Plugin**: Marketplace 插件包 - 用 list_marketplaces/list_marketplace_plugins/install_plugin/uninstall_plugin 管理
- **Agent Chat URL**: 创建 Agent 后用 get_agent_chat_url 获取测试链接给用户

## 交互风格

- 友好、专业
- 引导式对话，不一次问太多问题
- 动态调整引导深度
- 使用中文交互（除非用户使用英文）
- 预览后确认，给用户修改的机会`,
    permissionMode: 'bypassPermissions',
    maxTurns: 50,
    allowedTools: [
      { name: 'Read', enabled: true },
      { name: 'Grep', enabled: true },
      { name: 'Glob', enabled: true },
      { name: 'Bash', enabled: true },
      { name: 'Task', enabled: true },
      { name: 'WebSearch', enabled: true },
      { name: 'TodoWrite', enabled: true },
      { name: 'Skill', enabled: true },
      // A2A client tool (injected automatically at runtime via integrateA2AMcpServer)
      { name: 'mcp__a2a-client__call_external_agent', enabled: true }
    ],
    workingDirectory: '~/.as-jarvis',
    ui: {
      icon: '⚙️',
      headerTitle: 'Meta Agent',
      headerDescription: '系统配置助手 & 业务路由'
    },
    author: 'AgentStudio System',
    tags: ['system', 'meta', 'configuration', 'routing'],
    enabled: true,
    source: 'local'
  }
];
