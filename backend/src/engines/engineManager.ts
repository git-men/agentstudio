/**
 * Engine Manager
 * 
 * Central manager for all agent engines. Handles engine registration,
 * selection, and provides a unified interface for the routes layer.
 */

import type { EngineType, IAgentEngine, EngineConfig, AGUIEvent, ModelInfo, EngineCapabilities } from './types.js';

/**
 * Engine Manager singleton
 */
class EngineManager {
  private engines: Map<EngineType, IAgentEngine> = new Map();
  private defaultEngine: EngineType = 'claude';

  /**
   * Register an engine
   */
  registerEngine(engine: IAgentEngine): void {
    console.log(`🔧 [EngineManager] Registering engine: ${engine.type}`);
    this.engines.set(engine.type, engine);
  }

  /**
   * Get an engine by type
   */
  getEngine(type: EngineType): IAgentEngine {
    const engine = this.engines.get(type);
    if (!engine) {
      throw new Error(`Engine not found: ${type}. Available engines: ${Array.from(this.engines.keys()).join(', ')}`);
    }
    return engine;
  }

  /**
   * Check if an engine is registered
   */
  hasEngine(type: EngineType): boolean {
    return this.engines.has(type);
  }

  /**
   * Get all registered engine types
   */
  getRegisteredEngines(): EngineType[] {
    return Array.from(this.engines.keys());
  }

  /**
   * Get the default engine type
   */
  getDefaultEngineType(): EngineType {
    return this.defaultEngine;
  }

  /**
   * Set the default engine type
   */
  setDefaultEngineType(type: EngineType): void {
    if (!this.engines.has(type)) {
      throw new Error(`Cannot set default engine to unregistered type: ${type}`);
    }
    this.defaultEngine = type;
  }

  /**
   * Get engine capabilities
   */
  getEngineCapabilities(type: EngineType): EngineCapabilities {
    const engine = this.getEngine(type);
    return engine.capabilities;
  }

  /**
   * Get all engines' capabilities
   */
  getAllEngineCapabilities(): Record<EngineType, EngineCapabilities> {
    const result: Partial<Record<EngineType, EngineCapabilities>> = {};
    for (const [type, engine] of this.engines) {
      result[type] = engine.capabilities;
    }
    return result as Record<EngineType, EngineCapabilities>;
  }

  /**
   * Get supported models for an engine
   */
  async getSupportedModels(type: EngineType): Promise<ModelInfo[]> {
    const engine = this.getEngine(type);
    return engine.getSupportedModels();
  }

  /**
   * Validate that a model is supported by the given engine.
   * Returns the model if valid, or undefined (let the engine pick its default) if not.
   */
  async validateModel(engineType: EngineType, model: string | undefined): Promise<string | undefined> {
    if (!model || model === 'auto') return undefined;
    try {
      const models = await this.getSupportedModels(engineType);
      if (models.length === 0) return model; // engine doesn't advertise models, pass through
      const isValid = models.some(m => m.id === model);
      if (!isValid) {
        console.warn(`⚠️ [EngineManager] Model "${model}" not supported by ${engineType} engine, falling back to engine default`);
        return undefined;
      }
      return model;
    } catch {
      return model; // if we can't check, pass through
    }
  }

  /**
   * Send a message using the specified engine
   */
  async sendMessage(
    engineType: EngineType,
    message: string,
    config: EngineConfig,
    onAguiEvent: (event: AGUIEvent) => void
  ): Promise<{ sessionId: string }> {
    const engine = this.getEngine(engineType);

    const validatedModel = await this.validateModel(engineType, config.model);
    const validatedConfig = { ...config, model: validatedModel };
    
    console.log(`📤 [EngineManager] Sending message via ${engineType} engine`);
    console.log(`   Workspace: ${config.workspace}`);
    console.log(`   Model: ${validatedModel || 'default'}${validatedModel !== config.model ? ` (requested: ${config.model})` : ''}`);

    let finalMessage = message;
    if (config.environmentContext) {
      finalMessage = `<environment_context>\n${config.environmentContext}\n</environment_context>\n\n${message}`;
      console.log(`   EnvironmentContext: ${config.environmentContext}`);
    }
    
    return engine.sendMessage(finalMessage, validatedConfig, onAguiEvent);
  }

  /**
   * Interrupt a session on the specified engine
   */
  async interruptSession(engineType: EngineType, sessionId: string): Promise<void> {
    const engine = this.getEngine(engineType);
    console.log(`🛑 [EngineManager] Interrupting session ${sessionId} on ${engineType} engine`);
    return engine.interruptSession(sessionId);
  }

  /**
   * Get total active session count across all engines
   */
  getTotalActiveSessionCount(): number {
    let total = 0;
    for (const engine of this.engines.values()) {
      total += engine.getActiveSessionCount();
    }
    return total;
  }

  /**
   * Get active session count by engine
   */
  getActiveSessionCountByEngine(): Record<EngineType, number> {
    const result: Partial<Record<EngineType, number>> = {};
    for (const [type, engine] of this.engines) {
      result[type] = engine.getActiveSessionCount();
    }
    return result as Record<EngineType, number>;
  }

  /**
   * Get engine status summary
   */
  getStatus(): {
    registeredEngines: EngineType[];
    defaultEngine: EngineType;
    activeSessions: Record<EngineType, number>;
    totalActiveSessions: number;
  } {
    return {
      registeredEngines: this.getRegisteredEngines(),
      defaultEngine: this.defaultEngine,
      activeSessions: this.getActiveSessionCountByEngine(),
      totalActiveSessions: this.getTotalActiveSessionCount(),
    };
  }
}

// Export singleton instance
export const engineManager = new EngineManager();

// Export class for testing
export { EngineManager };
