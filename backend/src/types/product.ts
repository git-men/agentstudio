/**
 * Product Edition & Feature Module Types
 *
 * Defines the product edition system that controls which features are
 * available in a given deployment. This layers on top of the engine
 * capabilities system (engine.ts) to provide business-level feature gating.
 *
 * Architecture:
 *   Engine (how it runs)  : claude-sdk | cursor-cli | codebuddy-sdk | codex-cli
 *   Product (what it offers): full | chat-only | lite | custom
 */

// =============================================================================
// Product Editions
// =============================================================================

export type ProductEdition = 'full' | 'chat-only' | 'lite' | 'custom';

// =============================================================================
// Module Access Levels
// =============================================================================

/**
 * Access level for a feature module.
 * - full: all operations (read + write)
 * - readonly: only GET/HEAD/OPTIONS requests allowed
 * - disabled: all requests blocked
 */
export type ModuleAccess = 'full' | 'readonly' | 'disabled';

// =============================================================================
// Feature Module Categories
// =============================================================================

export type ModuleCategory = 'core' | 'manage' | 'extend' | 'system';

// =============================================================================
// Feature Module Definition
// =============================================================================

export interface FeatureModule {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  /** Backend route patterns this module controls (sorted by specificity) */
  routePatterns: string[];
  /** Frontend page paths this module controls */
  frontendPaths: string[];
}

// =============================================================================
// Product Profile
// =============================================================================

export interface ProductProfile {
  edition: ProductEdition;
  name: string;
  description: string;
  /** Module access map: module ID -> access level */
  modules: Record<string, ModuleAccess>;
}

// =============================================================================
// Product Config (runtime resolved)
// =============================================================================

export interface ProductConfig {
  edition: ProductEdition;
  profile: ProductProfile;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ProductInfoResponse {
  edition: ProductEdition;
  name: string;
  description: string;
  modules: Record<string, ModuleAccess>;
  availableModules: FeatureModuleInfo[];
}

export interface FeatureModuleInfo {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  access: ModuleAccess;
  frontendPaths: string[];
}
