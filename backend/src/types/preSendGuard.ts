export type PreSendGuardDecision = 'allow' | 'block' | 'rewrite' | 'require_confirm';

export type PreSendGuardErrorPolicy = 'allow' | 'block';

export interface PreSendGuardProviderConfig {
  name: string;
  enabled?: boolean;
  timeoutMs?: number;
  onError?: PreSendGuardErrorPolicy;
  options?: Record<string, unknown>;
}

export interface PreSendGuardConfig {
  enabled?: boolean;
  providers?: PreSendGuardProviderConfig[];
}

export interface PreSendGuardContext {
  message: string;
  agentId: string;
  sessionId?: string | null;
  projectPath?: string;
  channel?: 'web' | 'slack';
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface PreSendGuardProviderResult {
  decision: PreSendGuardDecision;
  reason?: string;
  code?: string;
  rewrittenMessage?: string;
  extra?: Record<string, unknown>;
}

export interface PreSendGuardProvider {
  readonly name: string;
  evaluate(
    context: PreSendGuardContext,
    providerConfig: PreSendGuardProviderConfig
  ): Promise<PreSendGuardProviderResult>;
}

export interface PreSendGuardStepResult {
  provider: string;
  decision: PreSendGuardDecision;
  reason?: string;
  code?: string;
  elapsedMs: number;
  error?: string;
}

export interface PreSendGuardEvaluationResult {
  enabled: boolean;
  decision: PreSendGuardDecision;
  blocked: boolean;
  message: string;
  reason?: string;
  code?: string;
  steps: PreSendGuardStepResult[];
}
