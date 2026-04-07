/**
 * Claude Default Version Environment
 *
 * Resolves the default Claude version's environment variables,
 * including API keys and proxy settings.
 */

import { getDefaultVersionId, getAllVersionsInternal } from '../services/claudeVersionStorage.js';

/**
 * Get default Claude version environment variables
 */
export async function getDefaultClaudeVersionEnv(): Promise<Record<string, string> | null> {
  try {
    const defaultVersionId = await getDefaultVersionId();
    if (defaultVersionId) {
      console.log(`🔍 Found default Claude version: ${defaultVersionId}`);

      const allVersions = await getAllVersionsInternal();
      const defaultVersion = allVersions.find(v => v.id === defaultVersionId);

      if (defaultVersion && defaultVersion.environmentVariables) {
        console.log(`🎯 Using default Claude version: ${defaultVersion.name} (${defaultVersion.alias})`);

        // Log all environment variables
        const envKeys = Object.keys(defaultVersion.environmentVariables);
        console.log(`📝 Environment variables from default version:`, envKeys);

        // Log proxy-related variables
        const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'];
        const configuredProxyVars = proxyVars.filter(key => defaultVersion.environmentVariables![key]);
        if (configuredProxyVars.length > 0) {
          console.log(`🌐 Proxy variables in default version:`, configuredProxyVars.join(', '));
        }

        // Check if this version has API keys configured
        const hasApiKey = defaultVersion.environmentVariables.ANTHROPIC_API_KEY ||
          defaultVersion.environmentVariables.OPENAI_API_KEY ||
          defaultVersion.environmentVariables.ANTHROPIC_AUTH_TOKEN;

        if (hasApiKey) {
          console.log(`✅ Default Claude version has API key configured`);
          return defaultVersion.environmentVariables;
        } else {
          console.log(`⚠️ No API keys found in default version environment variables`);
        }
      }
    }

    console.log(`⚠️ No default Claude version with API keys found`);
    return null;
  } catch (error) {
    console.error('❌ Error getting default Claude version:', error);
    return null;
  }
}
