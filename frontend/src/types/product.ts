/**
 * Product Edition & Feature Module Types (Frontend)
 *
 * Mirrors backend/src/types/product.ts for frontend use.
 */

export type ProductEdition = 'full' | 'chat-only' | 'lite' | 'custom';

export type ModuleAccess = 'full' | 'readonly' | 'disabled';

export type ModuleCategory = 'core' | 'manage' | 'extend' | 'system';

export interface FeatureModuleInfo {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  access: ModuleAccess;
  frontendPaths: string[];
}

export interface ProductInfoResponse {
  edition: ProductEdition;
  name: string;
  description: string;
  modules: Record<string, ModuleAccess>;
  availableModules: FeatureModuleInfo[];
}
