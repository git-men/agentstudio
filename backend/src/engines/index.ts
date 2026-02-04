/**
 * Engines Module
 * 
 * Central module for all agent engines. Provides a unified interface
 * for the routes layer to interact with different AI backends.
 */

// Export types
export * from './types.js';

// Export engine manager
export { engineManager, EngineManager } from './engineManager.js';

// Export Claude engine
export { claudeEngine, ClaudeEngine, ClaudeAguiAdapter } from './claude/index.js';

// Export Cursor engine
export { cursorEngine, CursorEngine, CursorAguiAdapter } from './cursor/index.js';

// =============================================================================
// Engine Initialization
// =============================================================================

import { engineManager } from './engineManager.js';
import { claudeEngine } from './claude/index.js';
import { cursorEngine } from './cursor/index.js';
import { getEngineType } from '../config/engineConfig.js';
import type { EngineType } from './types.js';

/**
 * Map service engine type to AGUI engine type
 */
function mapServiceEngineToAguiEngine(serviceEngine: string): EngineType {
  if (serviceEngine === 'cursor-cli') {
    return 'cursor';
  }
  return 'claude';
}

/**
 * Initialize all engines
 * Call this at application startup
 */
export function initializeEngines(): void {
  console.log('🚀 [Engines] Initializing engine layer...');
  
  // Register Claude engine
  engineManager.registerEngine(claudeEngine);
  
  // Register Cursor engine
  engineManager.registerEngine(cursorEngine);
  
  // Set default engine based on ENGINE environment variable
  const serviceEngineType = getEngineType();
  const defaultEngine = mapServiceEngineToAguiEngine(serviceEngineType);
  engineManager.setDefaultEngineType(defaultEngine);
  
  console.log(`✅ [Engines] Initialized ${engineManager.getRegisteredEngines().length} engines`);
  console.log(`   Default engine: ${engineManager.getDefaultEngineType()}`);
}

/**
 * Get engine status for debugging/monitoring
 */
export function getEngineStatus() {
  return engineManager.getStatus();
}
