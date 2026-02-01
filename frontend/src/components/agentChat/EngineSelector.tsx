/**
 * Engine Selector Component
 * 
 * Dropdown to switch between AI engines (Claude, Cursor)
 * Fetches engine info when switching and updates the store with models and capabilities.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';
import { useAgentStore, type EngineType } from '../../stores/useAgentStore';
import { fetchEngineInfo, getDefaultUICapabilities } from '../../hooks/useAGUIChat';

interface EngineSelectorProps {
  disabled?: boolean;
}

const ENGINE_OPTIONS: { id: EngineType; name: string; description: string }[] = [
  { id: 'claude', name: 'Claude', description: 'Claude Agent SDK' },
  { id: 'cursor', name: 'Cursor', description: 'Cursor Agent CLI' },
];

export const EngineSelector: React.FC<EngineSelectorProps> = ({ disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { 
    selectedEngine, 
    setSelectedEngine, 
    setEngineUICapabilities,
    setEngineModels,
  } = useAgentStore();
  
  const currentEngine = ENGINE_OPTIONS.find(e => e.id === selectedEngine) || ENGINE_OPTIONS[0];
  
  // Fetch engine info and update store
  const loadEngineInfo = useCallback(async (engineType: EngineType) => {
    setIsLoading(true);
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
          console.log(`[EngineSelector] Loaded ${info.models.length} models for ${engineType}`);
        }
      } else {
        // Fallback to defaults
        setEngineUICapabilities(getDefaultUICapabilities(engineType));
      }
    } catch (error) {
      console.warn('[EngineSelector] Failed to load engine info:', error);
      setEngineUICapabilities(getDefaultUICapabilities(engineType));
    } finally {
      setIsLoading(false);
    }
  }, [setEngineUICapabilities, setEngineModels]);
  
  // Load engine info when component mounts or engine changes
  useEffect(() => {
    loadEngineInfo(selectedEngine);
  }, [selectedEngine, loadEngineInfo]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (engineId: EngineType) => {
    if (engineId === selectedEngine) {
      setIsOpen(false);
      return;
    }
    
    setSelectedEngine(engineId);
    setIsOpen(false);
    // Engine info will be loaded by the useEffect
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`
          flex items-center space-x-1 px-2 py-1.5 text-xs font-medium rounded-md
          transition-colors border
          ${disabled || isLoading
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed border-gray-200 dark:border-gray-700' 
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600'
          }
        `}
        title={`Engine: ${currentEngine.name}`}
      >
        <Cpu className={`w-3.5 h-3.5 ${isLoading ? 'animate-pulse' : ''}`} />
        <span>{currentEngine.name}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
          <div className="py-1">
            {ENGINE_OPTIONS.map((engine) => (
              <button
                key={engine.id}
                onClick={() => handleSelect(engine.id)}
                className={`
                  w-full px-3 py-2 text-left text-sm transition-colors
                  ${engine.id === selectedEngine
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                `}
              >
                <div className="font-medium">{engine.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{engine.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EngineSelector;
