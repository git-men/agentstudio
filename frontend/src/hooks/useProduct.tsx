/**
 * useProduct Hook
 *
 * Provides access to the current product edition configuration.
 * Derives product info from the engine config query (no separate API call).
 */

import { useMemo } from 'react';
import useEngine from './useEngine';
import type { ProductEdition, ModuleAccess, FeatureModuleInfo } from '../types/product';

export function useProduct() {
  const { config, isLoading, error } = useEngine();

  const product = config?.product;

  const isFullEdition = product?.edition === 'full';

  const isModuleEnabled = useMemo(() => {
    return (moduleId: string): boolean => {
      if (!product || isFullEdition) return true;
      const access = product.modules[moduleId];
      return access === 'full' || access === 'readonly';
    };
  }, [product, isFullEdition]);

  const isModuleWritable = useMemo(() => {
    return (moduleId: string): boolean => {
      if (!product || isFullEdition) return true;
      return product.modules[moduleId] === 'full';
    };
  }, [product, isFullEdition]);

  const getModuleAccess = useMemo(() => {
    return (moduleId: string): ModuleAccess => {
      if (!product || isFullEdition) return 'full';
      return product.modules[moduleId] || 'disabled';
    };
  }, [product, isFullEdition]);

  /**
   * Check if a frontend path is accessible.
   * Uses the module's frontendPaths to determine access.
   */
  const isPageEnabled = useMemo(() => {
    return (pagePath: string): boolean => {
      if (!product || isFullEdition) return true;

      for (const mod of product.availableModules) {
        for (const fp of mod.frontendPaths) {
          if (pagePath === fp || pagePath.startsWith(fp + '/')) {
            return mod.access === 'full' || mod.access === 'readonly';
          }
        }
      }
      return true; // Unknown pages are allowed
    };
  }, [product, isFullEdition]);

  /**
   * Find which module a frontend path belongs to.
   */
  const getPageModule = useMemo(() => {
    return (pagePath: string): FeatureModuleInfo | null => {
      if (!product) return null;

      for (const mod of product.availableModules) {
        for (const fp of mod.frontendPaths) {
          if (pagePath === fp || pagePath.startsWith(fp + '/')) {
            return mod;
          }
        }
      }
      return null;
    };
  }, [product]);

  return {
    product,
    isLoading,
    error,

    edition: product?.edition as ProductEdition | undefined,
    editionName: product?.name,
    isFullEdition,

    isModuleEnabled,
    isModuleWritable,
    getModuleAccess,
    isPageEnabled,
    getPageModule,

    modules: product?.availableModules || [],
    enabledModules: product?.availableModules?.filter(
      m => m.access === 'full' || m.access === 'readonly'
    ) || [],
  };
}

export default useProduct;
