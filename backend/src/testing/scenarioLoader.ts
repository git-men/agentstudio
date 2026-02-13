/**
 * ScenarioLoader - Load and replay JSONL-based SDK mock scenarios
 * 
 * Scenarios are stored as .jsonl files where each line is a JSON object
 * representing an SDK message with optional metadata.
 * 
 * File format:
 *   Line 1: {"_meta": {"name": "...", "description": "...", "trigger": "..."}}
 *   Line 2+: {"_delay": 100, "type": "system", "subtype": "init", ...}
 * 
 * Template variables:
 *   {{SESSION_ID}} - Replaced with actual session ID at replay time
 * 
 * Usage:
 *   const loader = new ScenarioLoader();
 *   const scenario = loader.matchScenario('trigger-auto-compact');
 *   for await (const msg of loader.replay(scenario, 'session-123')) {
 *     // msg is an SDKMessage
 *   }
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ScenarioMeta {
  name: string;
  description: string;
  trigger: string;  // keyword to match against user message; "__default__" for fallback
  version?: string;
}

export interface ScenarioStep {
  delay: number;       // ms to wait before yielding this message
  data: Record<string, any>;  // The SDK message (with template variables)
}

export interface ScenarioConfig {
  meta: ScenarioMeta;
  steps: ScenarioStep[];
  filePath: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ScenarioLoader {
  private scenarioDir: string;
  private scenarios: Map<string, ScenarioConfig> = new Map();
  private triggerIndex: Map<string, ScenarioConfig> = new Map();
  private loaded = false;

  constructor(scenarioDir?: string) {
    this.scenarioDir = scenarioDir || path.join(__dirname, 'scenarios');
  }

  /**
   * Load all .jsonl scenario files from the scenarios directory.
   * Called lazily on first use.
   */
  loadAll(): void {
    if (this.loaded) return;

    if (!fs.existsSync(this.scenarioDir)) {
      console.warn(`[ScenarioLoader] Scenario directory not found: ${this.scenarioDir}`);
      this.loaded = true;
      return;
    }

    const files = fs.readdirSync(this.scenarioDir)
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('_'));

    for (const file of files) {
      try {
        const filePath = path.join(this.scenarioDir, file);
        const scenario = this.parseFile(filePath);
        
        // Index by name
        this.scenarios.set(scenario.meta.name, scenario);
        
        // Index by trigger keyword (for message matching)
        if (scenario.meta.trigger && scenario.meta.trigger !== '__default__') {
          this.triggerIndex.set(scenario.meta.trigger, scenario);
        }

        console.log(`[ScenarioLoader] Loaded scenario: ${scenario.meta.name} (trigger: "${scenario.meta.trigger}", ${scenario.steps.length} steps)`);
      } catch (err) {
        console.error(`[ScenarioLoader] Failed to parse ${file}:`, err);
      }
    }

    // Also scan _recorded/ subdirectory
    const recordedDir = path.join(this.scenarioDir, '_recorded');
    if (fs.existsSync(recordedDir)) {
      const recordedFiles = fs.readdirSync(recordedDir)
        .filter(f => f.endsWith('.jsonl'));

      for (const file of recordedFiles) {
        try {
          const filePath = path.join(recordedDir, file);
          const scenario = this.parseFile(filePath);
          const name = `recorded:${scenario.meta.name}`;
          this.scenarios.set(name, scenario);
          
          if (scenario.meta.trigger && scenario.meta.trigger !== '__default__') {
            this.triggerIndex.set(scenario.meta.trigger, scenario);
          }

          console.log(`[ScenarioLoader] Loaded recorded scenario: ${name}`);
        } catch (err) {
          console.error(`[ScenarioLoader] Failed to parse recorded/${file}:`, err);
        }
      }
    }

    this.loaded = true;
    console.log(`[ScenarioLoader] Total scenarios loaded: ${this.scenarios.size}`);
  }

  /**
   * Parse a single .jsonl scenario file.
   */
  private parseFile(filePath: string): ScenarioConfig {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const lines = content.split('\n').filter(line => line.trim());

    let meta: ScenarioMeta = {
      name: path.basename(filePath, '.jsonl'),
      description: '',
      trigger: '__default__',
    };
    const steps: ScenarioStep[] = [];

    for (const line of lines) {
      const parsed = JSON.parse(line);

      if (parsed._meta) {
        // First line: metadata
        meta = { ...meta, ...parsed._meta };
      } else {
        // Subsequent lines: SDK messages
        const delay = parsed._delay || 0;
        const data = { ...parsed };
        delete data._delay;  // Remove meta field from the actual message
        
        steps.push({ delay, data });
      }
    }

    return { meta, steps, filePath };
  }

  /**
   * Match a scenario based on user message content.
   * Returns the matching scenario or the default "normal" scenario.
   */
  matchScenario(message: string): ScenarioConfig | null {
    this.loadAll();

    // 1. Exact trigger match
    for (const [trigger, scenario] of this.triggerIndex) {
      if (message === trigger || message.includes(trigger)) {
        console.log(`[ScenarioLoader] Matched scenario "${scenario.meta.name}" for message "${message}" (trigger: "${trigger}")`);
        return scenario;
      }
    }

    // 2. Fallback to "normal" scenario
    const defaultScenario = this.scenarios.get('normal');
    if (defaultScenario) {
      console.log(`[ScenarioLoader] Using default scenario "normal" for message "${message}"`);
      return defaultScenario;
    }

    console.warn(`[ScenarioLoader] No scenario found for message "${message}"`);
    return null;
  }

  /**
   * Get a scenario by name.
   */
  getScenario(name: string): ScenarioConfig | null {
    this.loadAll();
    return this.scenarios.get(name) || null;
  }

  /**
   * List all available scenarios.
   */
  listScenarios(): ScenarioMeta[] {
    this.loadAll();
    return Array.from(this.scenarios.values()).map(s => s.meta);
  }

  /**
   * Replay a scenario as an async generator, yielding SDK messages.
   * Replaces template variables (e.g., {{SESSION_ID}}) in each message.
   */
  async *replay(
    scenario: ScenarioConfig,
    sessionId: string,
    variables?: Record<string, string>
  ): AsyncGenerator<Record<string, any>> {
    const vars: Record<string, string> = {
      SESSION_ID: sessionId,
      ...variables,
    };

    console.log(`[ScenarioLoader] Replaying scenario "${scenario.meta.name}" with sessionId=${sessionId} (${scenario.steps.length} steps)`);

    for (const step of scenario.steps) {
      // Apply delay
      if (step.delay > 0) {
        await sleep(step.delay);
      }

      // Deep clone and replace template variables
      let jsonStr = JSON.stringify(step.data);
      for (const [key, value] of Object.entries(vars)) {
        jsonStr = jsonStr.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }

      const message = JSON.parse(jsonStr);
      yield message;
    }

    console.log(`[ScenarioLoader] Scenario "${scenario.meta.name}" replay completed`);
  }
}

// Singleton instance
let _instance: ScenarioLoader | null = null;

export function getScenarioLoader(scenarioDir?: string): ScenarioLoader {
  if (!_instance) {
    _instance = new ScenarioLoader(scenarioDir);
  }
  return _instance;
}
