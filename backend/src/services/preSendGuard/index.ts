import type {
  PreSendGuardConfig,
  PreSendGuardContext,
  PreSendGuardEvaluationResult,
  PreSendGuardProvider,
  PreSendGuardProviderConfig,
  PreSendGuardProviderResult,
  PreSendGuardStepResult
} from '../../types/preSendGuard.js';
import { httpAuditProvider } from './providers/httpAuditProvider.js';
import { noopProvider } from './providers/noopProvider.js';

interface EvaluatePreSendGuardInput {
  globalConfig?: PreSendGuardConfig;
  agentConfig?: PreSendGuardConfig;
  context: PreSendGuardContext;
}

const providerRegistry = new Map<string, PreSendGuardProvider>();

function registerProvider(provider: PreSendGuardProvider): void {
  providerRegistry.set(provider.name, provider);
}

registerProvider(noopProvider);
registerProvider(httpAuditProvider);

function nowMs(): number {
  return Date.now();
}

function resolveEnabled(
  globalConfig?: PreSendGuardConfig,
  agentConfig?: PreSendGuardConfig
): boolean {
  if (typeof agentConfig?.enabled === 'boolean') {
    return agentConfig.enabled;
  }
  if (typeof globalConfig?.enabled === 'boolean') {
    return globalConfig.enabled;
  }
  return false;
}

function resolveProviders(
  globalConfig?: PreSendGuardConfig,
  agentConfig?: PreSendGuardConfig
): PreSendGuardProviderConfig[] {
  const providers =
    (agentConfig?.providers && agentConfig.providers.length > 0
      ? agentConfig.providers
      : globalConfig?.providers) || [];

  return providers.filter(provider => provider.enabled !== false && !!provider.name);
}

function normalizeProviderResult(result: PreSendGuardProviderResult): PreSendGuardProviderResult {
  if (!result || typeof result !== 'object') {
    return { decision: 'allow' };
  }

  if (result.decision === 'rewrite') {
    if (!result.rewrittenMessage || typeof result.rewrittenMessage !== 'string') {
      return {
        decision: 'allow',
        reason: result.reason || 'Rewrite decision ignored due to missing rewrittenMessage'
      };
    }
  }

  return result;
}

function createDisabledResult(message: string): PreSendGuardEvaluationResult {
  return {
    enabled: false,
    decision: 'allow',
    blocked: false,
    message,
    steps: [],
  };
}

function createBlockedResult(
  message: string,
  reason: string,
  code: string,
  steps: PreSendGuardStepResult[],
  decision: PreSendGuardProviderResult['decision'] = 'block'
): PreSendGuardEvaluationResult {
  return {
    enabled: true,
    blocked: true,
    decision,
    message,
    reason,
    code,
    steps,
  };
}

export async function evaluatePreSendGuard(
  input: EvaluatePreSendGuardInput
): Promise<PreSendGuardEvaluationResult> {
  const { globalConfig, agentConfig, context } = input;

  const enabled = resolveEnabled(globalConfig, agentConfig);
  if (!enabled) {
    return createDisabledResult(context.message);
  }

  const providers = resolveProviders(globalConfig, agentConfig);
  const steps: PreSendGuardStepResult[] = [];

  if (providers.length === 0) {
    return {
      enabled: true,
      decision: 'allow',
      blocked: false,
      message: context.message,
      reason: 'Guard enabled but no providers configured',
      steps,
    };
  }

  let currentMessage = context.message;

  for (const providerConfig of providers) {
    const startedAt = nowMs();
    const providerName = providerConfig.name;
    const onError = providerConfig.onError || 'allow';
    const provider = providerRegistry.get(providerName);

    if (!provider) {
      const elapsedMs = nowMs() - startedAt;
      const errorMessage = `Guard provider '${providerName}' is not registered`;

      if (onError === 'block') {
        steps.push({
          provider: providerName,
          decision: 'block',
          reason: errorMessage,
          code: 'guard_provider_not_found',
          elapsedMs,
          error: errorMessage,
        });

        return createBlockedResult(
          currentMessage,
          errorMessage,
          'guard_provider_not_found',
          steps,
          'block'
        );
      }

      steps.push({
        provider: providerName,
        decision: 'allow',
        reason: errorMessage,
        code: 'guard_provider_not_found',
        elapsedMs,
        error: errorMessage,
      });
      continue;
    }

    try {
      const providerResult = normalizeProviderResult(
        await provider.evaluate(
          {
            ...context,
            message: currentMessage,
          },
          providerConfig
        )
      );

      const elapsedMs = nowMs() - startedAt;
      steps.push({
        provider: providerName,
        decision: providerResult.decision,
        reason: providerResult.reason,
        code: providerResult.code,
        elapsedMs,
      });

      if (providerResult.decision === 'rewrite' && providerResult.rewrittenMessage) {
        currentMessage = providerResult.rewrittenMessage;
        continue;
      }

      if (providerResult.decision === 'block' || providerResult.decision === 'require_confirm') {
        return createBlockedResult(
          currentMessage,
          providerResult.reason || 'Message blocked by pre-send guard',
          providerResult.code || (providerResult.decision === 'require_confirm' ? 'guard_require_confirm' : 'guard_blocked'),
          steps,
          providerResult.decision
        );
      }
    } catch (error) {
      const elapsedMs = nowMs() - startedAt;
      const errorMessage = error instanceof Error ? error.message : 'Unknown guard provider error';

      if (onError === 'block') {
        steps.push({
          provider: providerName,
          decision: 'block',
          reason: errorMessage,
          code: 'guard_provider_error',
          elapsedMs,
          error: errorMessage,
        });

        return createBlockedResult(
          currentMessage,
          errorMessage,
          'guard_provider_error',
          steps,
          'block'
        );
      }

      steps.push({
        provider: providerName,
        decision: 'allow',
        reason: errorMessage,
        code: 'guard_provider_error',
        elapsedMs,
        error: errorMessage,
      });
    }
  }

  return {
    enabled: true,
    decision: 'allow',
    blocked: false,
    message: currentMessage,
    steps,
  };
}
