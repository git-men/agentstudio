/**
 * WeChat Work (企业微信) Integration Types
 *
 * Uses hitl.woa.com as the message transport layer
 */

export interface WecomMessage {
  content: string;
  fromUser: WecomUser;
  timestamp: string;
  msgType: 'text' | 'image' | 'mixed';
  images?: string[];
}

export interface WecomUser {
  name: string;
  alias: string;
}

export interface WecomSessionMapping {
  userId: string;
  sessionId: string;
  agentId: string;
  projectPath?: string;
  createdAt: number;
  lastActivity: number;
}

export interface WecomListenerState {
  running: boolean;
  startedAt?: number;
  messagesProcessed: number;
  lastMessageAt?: number;
  currentHitlSessionId?: string;
}

export interface HitlSendPayload {
  message: string;
  chat_type: 'group' | 'single';
  chat_id?: string;
  wait_reply: boolean;
  images?: string[];
  project_name?: string;
  timeout?: number;
  mention_list?: string[];
}

export interface HitlSendResponse {
  success: boolean;
  session_id?: string;
  error?: string;
}

export interface HitlPollResponse {
  has_reply: boolean;
  replies: HitlReply[];
  status?: string;
}

export interface HitlReply {
  msg_type: string;
  content: string;
  from_user: WecomUser;
  timestamp: string;
}

export interface WecomConfig {
  serviceUrl: string;
  chatId: string;
  defaultAgentId: string;
  defaultProject: string;
  timeout: number;
  pollInterval: number;
  projectName: string;
}
