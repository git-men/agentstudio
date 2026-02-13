import type {
  PreSendGuardContext,
  PreSendGuardProvider,
  PreSendGuardProviderResult
} from '../../../types/preSendGuard.js';

interface HttpAuditProviderOptions {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

function isValidDecision(value: unknown): value is PreSendGuardProviderResult['decision'] {
  return value === 'allow' || value === 'block' || value === 'rewrite' || value === 'require_confirm';
}

function parseOptions(rawOptions: Record<string, unknown> | undefined): HttpAuditProviderOptions {
  if (!rawOptions) {
    return {};
  }

  const options = rawOptions as HttpAuditProviderOptions;
  return {
    url: typeof options.url === 'string' ? options.url : undefined,
    method: typeof options.method === 'string' ? options.method.toUpperCase() : undefined,
    headers: options.headers && typeof options.headers === 'object'
      ? Object.entries(options.headers).reduce<Record<string, string>>((acc, [key, value]) => {
          if (typeof value === 'string') {
            acc[key] = value;
          }
          return acc;
        }, {})
      : undefined,
  };
}

function normalizeHttpResponse(payload: unknown): PreSendGuardProviderResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Audit response must be a JSON object');
  }

  const data = payload as Record<string, unknown>;

  if (isValidDecision(data.decision)) {
    return {
      decision: data.decision,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      code: typeof data.code === 'string' ? data.code : undefined,
      rewrittenMessage: typeof data.rewrittenMessage === 'string' ? data.rewrittenMessage : undefined,
      extra: typeof data.extra === 'object' && data.extra !== null ? data.extra as Record<string, unknown> : undefined,
    };
  }

  if (typeof data.allow === 'boolean') {
    return {
      decision: data.allow ? 'allow' : 'block',
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      code: typeof data.code === 'string' ? data.code : undefined,
    };
  }

  throw new Error('Audit response must contain decision or allow field');
}

async function safeReadJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await response.text();
    throw new Error(`Expected JSON response, got: ${body.slice(0, 200)}`);
  }
  return response.json();
}

export const httpAuditProvider: PreSendGuardProvider = {
  name: 'http-audit',

  async evaluate(context: PreSendGuardContext, providerConfig) {
    const options = parseOptions(providerConfig.options);
    const url = options.url;
    if (!url) {
      throw new Error('http-audit provider requires options.url');
    }

    const timeoutMs = providerConfig.timeoutMs ?? 3000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        },
        body: JSON.stringify({
          message: context.message,
          agentId: context.agentId,
          sessionId: context.sessionId || undefined,
          projectPath: context.projectPath,
          channel: context.channel,
          requestId: context.requestId,
          metadata: context.metadata,
          timestamp: Date.now(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Audit service returned ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const payload = await safeReadJson(response);
      return normalizeHttpResponse(payload);
    } finally {
      clearTimeout(timeout);
    }
  }
};
