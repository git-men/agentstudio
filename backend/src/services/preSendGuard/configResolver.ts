import { readFile } from 'fs/promises';
import { PRE_SEND_GUARD_CONFIG_FILE } from '../../config/paths.js';
import type { PreSendGuardConfig, PreSendGuardContext, PreSendGuardProviderConfig } from '../../types/preSendGuard.js';

interface PreSendGuardMatcher {
  agentIds?: string[];
  projectPaths?: string[];
  projectPathPrefixes?: string[];
  channels?: Array<'web' | 'slack'>;
}

interface PreSendGuardRule {
  id: string;
  enabled?: boolean;
  matcher?: PreSendGuardMatcher;
  config: PreSendGuardConfig;
}

interface PreSendGuardFileConfig {
  version?: number;
  default?: PreSendGuardConfig;
  rules?: PreSendGuardRule[];
}

export interface ResolvedPreSendGuardConfig {
  config?: PreSendGuardConfig;
  source: 'none' | 'default' | 'rule';
  matchedRuleId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : undefined;
}

function normalizeProvider(value: unknown): PreSendGuardProviderConfig | null {
  const record = asRecord(value);
  if (!record || typeof record.name !== 'string' || !record.name.trim()) {
    return null;
  }

  const provider: PreSendGuardProviderConfig = {
    name: record.name,
  };

  if (typeof record.enabled === 'boolean') {
    provider.enabled = record.enabled;
  }
  if (typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs) && record.timeoutMs > 0) {
    provider.timeoutMs = Math.floor(record.timeoutMs);
  }
  if (record.onError === 'allow' || record.onError === 'block') {
    provider.onError = record.onError;
  }

  const options = asRecord(record.options);
  if (options) {
    provider.options = options;
  }

  return provider;
}

function normalizeGuardConfig(value: unknown): PreSendGuardConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const config: PreSendGuardConfig = {};
  if (typeof record.enabled === 'boolean') {
    config.enabled = record.enabled;
  }

  if (Array.isArray(record.providers)) {
    const providers = record.providers
      .map(normalizeProvider)
      .filter((item): item is PreSendGuardProviderConfig => item !== null);

    if (providers.length > 0) {
      config.providers = providers;
    }
  }

  if (config.enabled === undefined && !config.providers) {
    return undefined;
  }

  return config;
}

function normalizeMatcher(value: unknown): PreSendGuardMatcher | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const channelsRaw = asStringArray(record.channels);
  const channels = channelsRaw?.filter((channel): channel is 'web' | 'slack' =>
    channel === 'web' || channel === 'slack'
  );

  const matcher: PreSendGuardMatcher = {
    agentIds: asStringArray(record.agentIds),
    projectPaths: asStringArray(record.projectPaths),
    projectPathPrefixes: asStringArray(record.projectPathPrefixes),
    channels: channels && channels.length > 0 ? channels : undefined,
  };

  if (!matcher.agentIds && !matcher.projectPaths && !matcher.projectPathPrefixes && !matcher.channels) {
    return undefined;
  }

  return matcher;
}

function normalizeRule(value: unknown): PreSendGuardRule | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== 'string' || !record.id.trim()) {
    return null;
  }

  const config = normalizeGuardConfig(record.config);
  if (!config) {
    return null;
  }

  return {
    id: record.id,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    matcher: normalizeMatcher(record.matcher),
    config,
  };
}

function normalizeFileConfig(value: unknown): PreSendGuardFileConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const fileConfig: PreSendGuardFileConfig = {
    default: normalizeGuardConfig(record.default),
  };

  if (typeof record.version === 'number' && Number.isFinite(record.version)) {
    fileConfig.version = Math.floor(record.version);
  }

  if (Array.isArray(record.rules)) {
    const rules = record.rules
      .map(normalizeRule)
      .filter((item): item is PreSendGuardRule => item !== null);

    if (rules.length > 0) {
      fileConfig.rules = rules;
    }
  }

  if (!fileConfig.default && (!fileConfig.rules || fileConfig.rules.length === 0)) {
    return undefined;
  }

  return fileConfig;
}

function isRuleMatched(matcher: PreSendGuardMatcher | undefined, context: PreSendGuardContext): boolean {
  if (!matcher) {
    return true;
  }

  if (matcher.agentIds && !matcher.agentIds.includes(context.agentId)) {
    return false;
  }

  if (matcher.channels && context.channel && !matcher.channels.includes(context.channel)) {
    return false;
  }

  if (matcher.projectPaths) {
    if (!context.projectPath || !matcher.projectPaths.includes(context.projectPath)) {
      return false;
    }
  }

  if (matcher.projectPathPrefixes) {
    if (!context.projectPath) {
      return false;
    }

    const matchedPrefix = matcher.projectPathPrefixes.some(prefix =>
      context.projectPath?.startsWith(prefix)
    );

    if (!matchedPrefix) {
      return false;
    }
  }

  return true;
}

export async function resolvePreSendGuardConfig(context: PreSendGuardContext): Promise<ResolvedPreSendGuardConfig> {
  try {
    const content = await readFile(PRE_SEND_GUARD_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    const guardFileConfig = normalizeFileConfig(parsed);

    if (!guardFileConfig) {
      return { source: 'none' };
    }

    const matchedRule = guardFileConfig.rules?.find(rule =>
      rule.enabled !== false && isRuleMatched(rule.matcher, context)
    );

    if (matchedRule) {
      return {
        config: matchedRule.config,
        source: 'rule',
        matchedRuleId: matchedRule.id,
      };
    }

    if (guardFileConfig.default) {
      return {
        config: guardFileConfig.default,
        source: 'default',
      };
    }

    return { source: 'none' };
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException | undefined)?.code;
    if (errorCode !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[PreSendGuard] Failed to load ${PRE_SEND_GUARD_CONFIG_FILE}: ${message}`);
    }
    return { source: 'none' };
  }
}
