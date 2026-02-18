/**
 * ProductGate Components
 *
 * Conditional rendering components based on product edition and module access.
 * Use these alongside EngineGate components for complete feature gating.
 */

import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import useProduct from '../hooks/useProduct';
import type { ModuleAccess } from '../types/product';

// =============================================================================
// Module Gate
// =============================================================================

interface ModuleGateProps {
  module: string;
  children: ReactNode;
  fallback?: ReactNode;
  /** Require full (write) access, not just readonly */
  requireWrite?: boolean;
}

/**
 * Show content only if a feature module is enabled in the current product edition.
 *
 * @example
 * ```tsx
 * <ModuleGate module="manage.agents">
 *   <AgentManagement />
 * </ModuleGate>
 *
 * <ModuleGate module="manage.projects" requireWrite fallback={<ReadOnlyBanner />}>
 *   <ProjectEditor />
 * </ModuleGate>
 * ```
 */
export function ModuleGate({ module, children, fallback = null, requireWrite = false }: ModuleGateProps) {
  const { isModuleEnabled, isModuleWritable, isLoading, isFullEdition } = useProduct();

  if (isLoading) return null;
  if (isFullEdition) return <>{children}</>;

  if (requireWrite) {
    return isModuleWritable(module) ? <>{children}</> : <>{fallback}</>;
  }

  return isModuleEnabled(module) ? <>{children}</> : <>{fallback}</>;
}

// =============================================================================
// Page Gate (Route-level)
// =============================================================================

interface PageGateProps {
  module: string;
  children: ReactNode;
  redirectTo?: string;
}

/**
 * Route-level gate that redirects to another path if the module is disabled.
 * Use this to wrap page components in the router configuration.
 *
 * @example
 * ```tsx
 * <Route path="/agents" element={
 *   <ProtectedRoute>
 *     <PageGate module="manage.agents">
 *       <Layout><AgentsPage /></Layout>
 *     </PageGate>
 *   </ProtectedRoute>
 * } />
 * ```
 */
export function PageGate({ module, children, redirectTo = '/' }: PageGateProps) {
  const { isModuleEnabled, isLoading, isFullEdition } = useProduct();

  if (isLoading) return null;
  if (isFullEdition) return <>{children}</>;

  if (!isModuleEnabled(module)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}

// =============================================================================
// Edition Gate
// =============================================================================

interface EditionGateProps {
  editions: string[];
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Show content only for specific product editions.
 *
 * @example
 * ```tsx
 * <EditionGate editions={['full', 'lite']}>
 *   <AdminPanel />
 * </EditionGate>
 * ```
 */
export function EditionGate({ editions, children, fallback = null }: EditionGateProps) {
  const { edition, isLoading } = useProduct();

  if (isLoading) return null;

  if (edition && editions.includes(edition)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

// =============================================================================
// Not Available Page
// =============================================================================

interface ModuleNotAvailableProps {
  moduleName?: string;
}

/**
 * Full-page "not available" message for disabled modules.
 */
export function ModuleNotAvailable({ moduleName }: ModuleNotAvailableProps) {
  const { editionName } = useProduct();

  return (
    <div className="flex flex-col items-center justify-center p-16 text-center">
      <div className="text-gray-400 mb-6">
        <svg className="w-20 h-20 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 15v.01M12 12a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6.007 6.007 0 00-8.038 0l-2.387.477a2 2 0 00-1.022.547M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"
          />
        </svg>
      </div>
      <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-3">
        {moduleName ? `${moduleName} 不可用` : '功能不可用'}
      </h3>
      <p className="text-gray-500 dark:text-gray-400 max-w-md">
        当前产品版本 ({editionName}) 未启用此功能。如需使用，请联系管理员调整产品配置。
      </p>
    </div>
  );
}

// =============================================================================
// Readonly Banner
// =============================================================================

export function ReadonlyBanner() {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 mb-4">
      <p className="text-sm text-amber-700 dark:text-amber-300">
        当前产品版本下此功能为只读模式，无法进行修改操作。
      </p>
    </div>
  );
}

// =============================================================================
// Access Level Helper
// =============================================================================

interface AccessLevelBadgeProps {
  moduleId: string;
}

/**
 * Display a badge showing the access level for a module.
 */
export function AccessLevelBadge({ moduleId }: AccessLevelBadgeProps) {
  const { getModuleAccess, isFullEdition } = useProduct();

  if (isFullEdition) return null;

  const access: ModuleAccess = getModuleAccess(moduleId);

  if (access === 'full') return null;

  if (access === 'readonly') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        只读
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
      未启用
    </span>
  );
}

export default {
  ModuleGate,
  PageGate,
  EditionGate,
  ModuleNotAvailable,
  ReadonlyBanner,
  AccessLevelBadge,
};
