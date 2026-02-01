/**
 * useEngine Hook
 * 
 * Provides access to the current engine configuration throughout the app.
 * The engine type is determined by the backend service at startup.
 */

import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../lib/config';
import type {
  ServiceEngineConfig,
  EngineInfoResponse,
  EngineFeatureKey,
  ConfigCapabilityKey,
  ConfigScope,
} from '../types/engine';

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch engine configuration from backend
 */
async function fetchEngineConfig(): Promise<ServiceEngineConfig> {
  const response = await fetch(`${API_BASE}/engine`);
  if (!response.ok) {
    throw new Error(`Failed to fetch engine config: ${response.statusText}`);
  }
  const data: EngineInfoResponse = await response.json();
  return {
    engine: data.engine,
    name: data.name,
    version: data.version,
    capabilities: data.capabilities,
    paths: data.paths,
  };
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Engine configuration hook
 * 
 * @returns Engine configuration and helper functions
 * 
 * @example
 * ```tsx
 * const { engine, isLoading, isFeatureSupported, canReadConfig } = useEngine();
 * 
 * if (isFeatureSupported('provider')) {
 *   // Show provider selector
 * }
 * 
 * if (canReadConfig('mcp', 'global')) {
 *   // Show global MCP settings
 * }
 * ```
 */
export function useEngine() {
  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['engine-config'],
    queryFn: fetchEngineConfig,
    staleTime: Infinity, // Engine config doesn't change during session
    gcTime: Infinity,
    retry: 3,
  });

  /**
   * Check if current engine is Cursor CLI
   */
  const isCursorEngine = config?.engine === 'cursor-cli';

  /**
   * Check if current engine is Claude SDK
   */
  const isClaudeEngine = config?.engine === 'claude-sdk';

  /**
   * Check if a feature is supported by current engine
   */
  const isFeatureSupported = (feature: EngineFeatureKey): boolean => {
    if (!config) return false;
    return config.capabilities.features[feature];
  };

  /**
   * Check if a config capability is supported
   */
  const isConfigSupported = (capability: ConfigCapabilityKey): boolean => {
    if (!config) return false;
    return config.capabilities[capability].supported;
  };

  /**
   * Check if reading a config is supported for a scope
   */
  const canReadConfig = (capability: ConfigCapabilityKey, scope: ConfigScope): boolean => {
    if (!config) return false;
    const cap = config.capabilities[capability];
    return cap.supported && cap.canRead && cap.scopes.includes(scope);
  };

  /**
   * Check if writing a config is supported for a scope
   */
  const canWriteConfig = (capability: ConfigCapabilityKey, scope: ConfigScope): boolean => {
    if (!config) return false;
    const cap = config.capabilities[capability];
    return cap.supported && cap.canWrite && cap.scopes.includes(scope);
  };

  /**
   * Get all supported scopes for a config capability
   */
  const getSupportedScopes = (capability: ConfigCapabilityKey): ConfigScope[] => {
    if (!config) return [];
    const cap = config.capabilities[capability];
    return cap.supported ? cap.scopes : [];
  };

  return {
    // Raw config
    config,
    isLoading,
    error,
    refetch,

    // Engine type helpers
    engineType: config?.engine,
    engineName: config?.name,
    isCursorEngine,
    isClaudeEngine,

    // Capability helpers
    capabilities: config?.capabilities,
    paths: config?.paths,

    // Helper functions
    isFeatureSupported,
    isConfigSupported,
    canReadConfig,
    canWriteConfig,
    getSupportedScopes,
  };
}

// =============================================================================
// Context (for cases where hook can't be used)
// =============================================================================

import { createContext, useContext, ReactNode, useState, useEffect } from 'react';

interface EngineContextValue {
  config: ServiceEngineConfig | null;
  isLoading: boolean;
  error: Error | null;
}

const EngineContext = createContext<EngineContextValue | null>(null);

/**
 * Engine provider component
 */
export function EngineProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServiceEngineConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchEngineConfig()
      .then(setConfig)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <EngineContext.Provider value={{ config, isLoading, error }}>
      {children}
    </EngineContext.Provider>
  );
}

/**
 * Use engine context (for non-React Query contexts)
 */
export function useEngineContext() {
  const context = useContext(EngineContext);
  if (!context) {
    throw new Error('useEngineContext must be used within an EngineProvider');
  }
  return context;
}

// =============================================================================
// Default Export
// =============================================================================

export default useEngine;
