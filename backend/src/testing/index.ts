/**
 * SDK Mock Testing Framework
 * 
 * Provides a drop-in replacement for Claude Agent SDK's query() function,
 * enabling full-stack testing without a real Claude Code CLI or API key.
 * 
 * Modes:
 *   MOCK_SDK=true    - Use mock scenarios (JSONL replay)
 *   MOCK_SDK=record  - Use real SDK + record to JSONL (future)
 *   (not set)        - Normal operation
 * 
 * Scenarios are .jsonl files in testing/scenarios/.
 * See README or individual scenario files for format documentation.
 */

export { createMockQuery, isMockEnabled, isRecordEnabled } from './mockSdkQuery.js';
export { ScenarioLoader, getScenarioLoader } from './scenarioLoader.js';
export type { ScenarioConfig, ScenarioMeta, ScenarioStep } from './scenarioLoader.js';
