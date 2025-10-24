// ==================== SDK 类型导入 ====================
import type {
  PermissionMode,
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage
} from '@anthropic-ai/claude-agent-sdk';

// 业务类型从本地文件导入
import type {
  AgentConfig as SharedAgentConfig,
  AgentMessage as SharedAgentMessage,
  AgentTool as SharedAgentTool,
  MessagePart as SharedMessagePart
} from './agents';

// 重新导出 SDK 类型
export type {
  PermissionMode,
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKSystemMessage
};

// 重新导出业务类型
export type {
  SharedAgentConfig as AgentConfig,
  SharedAgentMessage as AgentMessage,
  SharedAgentTool as AgentTool,
  SharedMessagePart as MessagePart
};

// 前端特有类型
export interface ImageData {
  id: string;
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  filename?: string;
}

export interface ToolUsageData {
  id: string;
  toolName: string;
  toolInput: any;
  toolResult?: string;
  toolUseResult?: any;
  isError?: boolean;
  isExecuting?: boolean;
  claudeId?: string;
}

// ==================== 项目特有类型 ====================

export interface Slide {
  path: string;
  title: string;
  exists: boolean;
  index: number;
}

export interface SlidesResponse {
  slides: Slide[];
  total: number;
  title: string;
}

export interface SlideContent {
  content: string;
  path: string;
  index: number;
}

// 聊天消息类型
export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  images?: ImageData[];
  toolUsage?: ToolUsageData[];
  messageParts?: SharedMessagePart[];
}

export interface ChatContext {
}

export interface AIProvider {
  provider: string;
  models: string[];
}

export interface AIModelsResponse {
  models: AIProvider[];
  available: boolean;
}

// Agent 配置类型已通过 SharedAgentConfig 重新导出为 AgentConfig

// Agent 会话类型
export interface AgentSession {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  lastUpdated: number;
  messages: SharedAgentMessage[];
  claudeSessionId?: string | null;
  claudeVersionId?: string;
  customData?: Record<string, unknown>;
}

// Re-export for compatibility
export type { Slide as SlideType, ChatMessage as ChatMessageType };