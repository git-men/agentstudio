/**
 * EngineGate Component
 * 
 * Conditional rendering components based on engine type and capabilities.
 * Use these to show/hide UI elements based on what the current engine supports.
 */

import { ReactNode } from 'react';
import useEngine from '../hooks/useEngine';
import type { EngineFeatureKey, ConfigCapabilityKey, ConfigScope } from '../types/engine';

// =============================================================================
// Feature Gate
// =============================================================================

interface FeatureGateProps {
  /** Feature to check */
  feature: EngineFeatureKey;
  /** Content to render if feature is supported */
  children: ReactNode;
  /** Fallback content if feature is not supported */
  fallback?: ReactNode;
}

/**
 * Show content only if a feature is supported by current engine
 * 
 * @example
 * ```tsx
 * <FeatureGate feature="provider">
 *   <ProviderSelector />
 * </FeatureGate>
 * 
 * <FeatureGate feature="subagents" fallback={<p>Subagents not supported</p>}>
 *   <SubagentList />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const { isFeatureSupported, isLoading } = useEngine();
  
  if (isLoading) {
    return null;
  }
  
  if (isFeatureSupported(feature)) {
    return <>{children}</>;
  }
  
  return <>{fallback}</>;
}

// =============================================================================
// Config Gate
// =============================================================================

interface ConfigGateProps {
  /** Config capability to check */
  config: ConfigCapabilityKey;
  /** Optional scope to check */
  scope?: ConfigScope;
  /** Whether to check for write access (default: read) */
  requireWrite?: boolean;
  /** Content to render if config is supported */
  children: ReactNode;
  /** Fallback content if config is not supported */
  fallback?: ReactNode;
}

/**
 * Show content only if a config capability is supported
 * 
 * @example
 * ```tsx
 * <ConfigGate config="mcp" scope="global">
 *   <McpSettings />
 * </ConfigGate>
 * 
 * <ConfigGate config="rules" requireWrite fallback={<p>Read-only</p>}>
 *   <RulesEditor />
 * </ConfigGate>
 * ```
 */
export function ConfigGate({ 
  config, 
  scope, 
  requireWrite = false, 
  children, 
  fallback = null 
}: ConfigGateProps) {
  const { canReadConfig, canWriteConfig, isConfigSupported, isLoading } = useEngine();
  
  if (isLoading) {
    return null;
  }
  
  // Check if config is supported at all
  if (!isConfigSupported(config)) {
    return <>{fallback}</>;
  }
  
  // If scope is specified, check scope access
  if (scope) {
    const hasAccess = requireWrite 
      ? canWriteConfig(config, scope)
      : canReadConfig(config, scope);
    
    if (!hasAccess) {
      return <>{fallback}</>;
    }
  }
  
  return <>{children}</>;
}

// =============================================================================
// Engine Type Gate
// =============================================================================

interface EngineTypeGateProps {
  /** Engine type to check for */
  engine: 'cursor-cli' | 'claude-sdk';
  /** Content to render if engine matches */
  children: ReactNode;
  /** Fallback content if engine doesn't match */
  fallback?: ReactNode;
}

/**
 * Show content only for a specific engine type
 * 
 * @example
 * ```tsx
 * <EngineTypeGate engine="cursor-cli">
 *   <CursorSpecificSettings />
 * </EngineTypeGate>
 * 
 * <EngineTypeGate engine="claude-sdk">
 *   <ClaudeSpecificSettings />
 * </EngineTypeGate>
 * ```
 */
export function EngineTypeGate({ engine, children, fallback = null }: EngineTypeGateProps) {
  const { engineType, isLoading } = useEngine();
  
  if (isLoading) {
    return null;
  }
  
  if (engineType === engine) {
    return <>{children}</>;
  }
  
  return <>{fallback}</>;
}

// =============================================================================
// Convenience Components
// =============================================================================

interface ClaudeOnlyProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Show content only for Claude SDK engine
 */
export function ClaudeOnly({ children, fallback = null }: ClaudeOnlyProps) {
  return (
    <EngineTypeGate engine="claude-sdk" fallback={fallback}>
      {children}
    </EngineTypeGate>
  );
}

interface CursorOnlyProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Show content only for Cursor CLI engine
 */
export function CursorOnly({ children, fallback = null }: CursorOnlyProps) {
  return (
    <EngineTypeGate engine="cursor-cli" fallback={fallback}>
      {children}
    </EngineTypeGate>
  );
}

// =============================================================================
// Not Supported Message
// =============================================================================

interface NotSupportedMessageProps {
  /** What feature is not supported */
  feature: string;
  /** Optional description */
  description?: string;
}

/**
 * Standard "not supported" message component
 */
export function NotSupportedMessage({ feature, description }: NotSupportedMessageProps) {
  const { engineName } = useEngine();
  
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="text-gray-400 mb-4">
        <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
            d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
        {feature} 不可用
      </h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md">
        {description || `当前引擎 (${engineName}) 不支持此功能。`}
      </p>
    </div>
  );
}

// =============================================================================
// Loading Placeholder
// =============================================================================

/**
 * Loading placeholder for engine-dependent content
 */
export function EngineLoadingPlaceholder() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="animate-pulse flex space-x-2">
        <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
        <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
        <div className="h-2 w-2 bg-gray-300 rounded-full"></div>
      </div>
    </div>
  );
}

// =============================================================================
// Exports
// =============================================================================

export default {
  FeatureGate,
  ConfigGate,
  EngineTypeGate,
  ClaudeOnly,
  CursorOnly,
  NotSupportedMessage,
  EngineLoadingPlaceholder,
};
