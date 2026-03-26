export interface DispatchIMRequest {
  sessionId: string;
  messageContent: string;
  botKey: string;
  chatId: string;
  projectName?: string;
  agentId?: string;
}

export interface DispatchIMResponse {
  success: boolean;
  shortId?: string;
  error?: string;
}

export type DispatchStatus = 'idle' | 'sending' | 'sent' | 'error';
