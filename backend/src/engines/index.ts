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

// Export CodeBuddy engine
export { codebuddyEngine, CodeBuddyEngine } from './codebuddy/index.js';
// Export Codex engine
export { codexEngine, CodexEngine, CodexAguiAdapter } from './codex/index.js';

// Export Codex SDK engine
export { codexSdkEngine, CodexSdkEngine, CodexSdkAguiAdapter } from './codex-sdk/index.js';

// =============================================================================
// Engine Initialization
// =============================================================================

import { engineManager } from './engineManager.js';
import { claudeEngine } from './claude/index.js';
import { cursorEngine } from './cursor/index.js';
import { codebuddyEngine } from './codebuddy/index.js';
import { codexEngine } from './codex/index.js';
import { codexSdkEngine } from './codex-sdk/index.js';
import { getEngineType } from '../config/engineConfig.js';
import type { EngineType } from './types.js';

/**
 * Map service engine type to AGUI engine type
 */
function mapServiceEngineToAguiEngine(serviceEngine: string): EngineType {
  if (serviceEngine === 'cursor-cli') {
    return 'cursor';
  }
  if (serviceEngine === 'codebuddy-sdk') {
    return 'codebuddy';
  }
  if (serviceEngine === 'codex-cli') {
    return 'codex';
  }
  if (serviceEngine === 'codex-sdk') {
    return 'codex-sdk';
  }
  // Both claude-sdk and claude-internal-sdk use the same claude AGUI engine
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
  
  // Register CodeBuddy engine
  engineManager.registerEngine(codebuddyEngine);

  // Register Codex engine
  engineManager.registerEngine(codexEngine);

  // Register Codex SDK engine
  engineManager.registerEngine(codexSdkEngine);
  
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
