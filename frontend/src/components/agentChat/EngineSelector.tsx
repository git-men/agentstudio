/**
 * Engine Sync Component
 * 
 * This component syncs the service-level engine configuration to the agent store.
 * It doesn't render any UI - just handles the side effects of engine synchronization.
 * 
 * The engine is determined at service startup and cannot be changed at runtime.
 * This component ensures the store's selectedEngine matches the service configuration.
 */

import { useEffect, useCallback } from 'react';
import { useAgentStore, type EngineType } from '../../stores/useAgentStore';
import { fetchEngineInfo, getDefaultUICapabilities } from '../../hooks/useAGUIChat';
import useEngine from '../../hooks/useEngine';

interface EngineSelectorProps {
  disabled?: boolean;
}

// Map service engine type to store engine type
const SERVICE_TO_STORE_ENGINE: Record<string, EngineType> = {
  'cursor-cli': 'cursor',
  'claude-sdk': 'claude',
};

/**
 * EngineSelector - Now a headless component that only syncs engine state
 * 
 * This component:
 * 1. Syncs service engine type to store's selectedEngine
 * 2. Loads engine info (UI capabilities and models) when engine changes
 * 
 * It renders nothing (null) but must be included in the component tree
 * to ensure proper engine synchronization.
 */
export const EngineSelector: React.FC<EngineSelectorProps> = ({ disabled: _disabled = false }) => {
  const { engineType: serviceEngineType } = useEngine();
  
  const { 
    selectedEngine,
    setSelectedEngine, 
    setEngineUICapabilities,
    setEngineModels,
  } = useAgentStore();
  
  // Sync store engine with service engine
  // This runs IMMEDIATELY when serviceEngineType is available
  // The service engine type is the source of truth for which engine to use
  useEffect(() => {
    if (serviceEngineType) {
      const storeEngineType = SERVICE_TO_STORE_ENGINE[serviceEngineType] || 'claude';
      // Always sync to service engine type - this is the source of truth
      // Sessions with different engine types (e.g., Claude session on Cursor service)
      // will be handled by session loading logic, not by overriding the default engine
      if (selectedEngine !== storeEngineType) {
        console.log(`[EngineSync] Syncing engine from ${selectedEngine} to ${storeEngineType}`);
        setSelectedEngine(storeEngineType);
      }
    }
  }, [serviceEngineType, selectedEngine, setSelectedEngine]);
  
  // Fetch engine info and update store
  const loadEngineInfo = useCallback(async (engineType: EngineType) => {
    try {
      const info = await fetchEngineInfo(engineType);
      if (info) {
        // Update UI capabilities if available from API
        if (info.capabilities?.ui) {
          setEngineUICapabilities(info.capabilities.ui);
        } else {
          // Use default capabilities
          setEngineUICapabilities(getDefaultUICapabilities(engineType));
        }
        
        // Update models
        if (info.models && info.models.length > 0) {
          setEngineModels(info.models);
          console.log(`[EngineSync] Loaded ${info.models.length} models for ${engineType}`);
        }
      } else {
        // Fallback to defaults
        setEngineUICapabilities(getDefaultUICapabilities(engineType));
      }
    } catch (error) {
      console.warn('[EngineSync] Failed to load engine info:', error);
      setEngineUICapabilities(getDefaultUICapabilities(engineType));
    }
  }, [setEngineUICapabilities, setEngineModels]);
  
  // Load engine info when selected engine changes
  useEffect(() => {
    loadEngineInfo(selectedEngine);
  }, [selectedEngine, loadEngineInfo]);

  // Render nothing - this is a headless component
  return null;
};

export default EngineSelector;
