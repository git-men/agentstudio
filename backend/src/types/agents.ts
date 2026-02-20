// Agent configuration types
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

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
      { name: 'AgentOutput', enabled: true },
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
  }
];
