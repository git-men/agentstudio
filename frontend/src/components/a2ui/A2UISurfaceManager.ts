/**
 * A2UI Surface Manager
 * 
 * Manages the state of A2UI surfaces, handling message parsing,
 * component buffering, data model updates, and render signals.
 */

import type {
  A2UIServerMessage,
  A2UIComponentInstance,
  A2UIDataEntry,
  A2UISurfaceState,
  A2UIBoundValue,
} from '../../types/a2uiTypes';

/**
 * Parse A2UI server messages and manage surface state
 */
export class A2UISurfaceManager {
  private surfaces: Map<string, A2UISurfaceState> = new Map();
  private onUpdate?: () => void;

  constructor(onUpdate?: () => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Process a batch of A2UI server messages
   */
  processMessages(messages: A2UIServerMessage[]): void {
    for (const msg of messages) {
      this.processMessage(msg);
    }
  }

  /**
   * Process a single A2UI server message
   */
  processMessage(msg: A2UIServerMessage): void {
    if ('surfaceUpdate' in msg) {
      this.handleSurfaceUpdate(msg);
    } else if ('dataModelUpdate' in msg) {
      this.handleDataModelUpdate(msg);
    } else if ('beginRendering' in msg) {
      this.handleBeginRendering(msg);
    } else if ('deleteSurface' in msg) {
      this.handleDeleteSurface(msg);
    }
  }

  private getOrCreateSurface(surfaceId: string): A2UISurfaceState {
    let surface = this.surfaces.get(surfaceId);
    if (!surface) {
      surface = {
        surfaceId,
        components: new Map(),
        dataModel: {},
        isReady: false,
      };
      this.surfaces.set(surfaceId, surface);
    }
    return surface;
  }

  private handleSurfaceUpdate(msg: { surfaceUpdate: { surfaceId?: string; components: A2UIComponentInstance[] } }): void {
    const surfaceId = msg.surfaceUpdate.surfaceId || 'default';
    const surface = this.getOrCreateSurface(surfaceId);

    for (const comp of msg.surfaceUpdate.components) {
      surface.components.set(comp.id, comp);
    }

    this.onUpdate?.();
  }

  private handleDataModelUpdate(msg: { dataModelUpdate: { surfaceId?: string; path?: string; contents: A2UIDataEntry[] } }): void {
    const surfaceId = msg.dataModelUpdate.surfaceId || 'default';
    const surface = this.getOrCreateSurface(surfaceId);

    const data = this.dataEntriesToObject(msg.dataModelUpdate.contents);
    if (msg.dataModelUpdate.path) {
      this.setNestedValue(surface.dataModel, msg.dataModelUpdate.path, data);
    } else {
      Object.assign(surface.dataModel, data);
    }

    this.onUpdate?.();
  }

  private handleBeginRendering(msg: { beginRendering: { surfaceId?: string; root: string; catalogId?: string } }): void {
    const surfaceId = msg.beginRendering.surfaceId || 'default';
    const surface = this.getOrCreateSurface(surfaceId);
    surface.rootId = msg.beginRendering.root;
    surface.catalogId = msg.beginRendering.catalogId;
    surface.isReady = true;

    this.onUpdate?.();
  }

  private handleDeleteSurface(msg: { deleteSurface: { surfaceId: string } }): void {
    this.surfaces.delete(msg.deleteSurface.surfaceId);
    this.onUpdate?.();
  }

  /**
   * Convert A2UI data entries to a plain JS object
   */
  private dataEntriesToObject(entries: A2UIDataEntry[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const entry of entries) {
      if (entry.valueString !== undefined) {
        result[entry.key] = entry.valueString;
      } else if (entry.valueNumber !== undefined) {
        result[entry.key] = entry.valueNumber;
      } else if (entry.valueBoolean !== undefined) {
        result[entry.key] = entry.valueBoolean;
      } else if (entry.valueMap !== undefined) {
        result[entry.key] = this.dataEntriesToObject(entry.valueMap);
      } else if (entry.valueArray !== undefined) {
        result[entry.key] = entry.valueArray;
      }
    }
    return result;
  }

  /**
   * Set a nested value in an object using a path like "/user/name"
   */
  private setNestedValue(obj: Record<string, any>, path: string, value: any): void {
    const parts = path.replace(/^\//, '').split('/');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (typeof value === 'object' && !Array.isArray(value)) {
      current[lastKey] = { ...(current[lastKey] || {}), ...value };
    } else {
      current[lastKey] = value;
    }
  }

  /**
   * Get all ready surfaces
   */
  getReadySurfaces(): A2UISurfaceState[] {
    return Array.from(this.surfaces.values()).filter(s => s.isReady);
  }

  /**
   * Get a specific surface by ID
   */
  getSurface(surfaceId: string): A2UISurfaceState | undefined {
    return this.surfaces.get(surfaceId);
  }

  /**
   * Get all surfaces (including not-yet-ready ones)
   */
  getAllSurfaces(): A2UISurfaceState[] {
    return Array.from(this.surfaces.values());
  }

  /**
   * Resolve a BoundValue against the data model
   */
  resolveBoundValue(surface: A2UISurfaceState, boundValue: A2UIBoundValue | undefined): any {
    if (!boundValue) return undefined;

    if (boundValue.path) {
      const resolved = this.getNestedValue(surface.dataModel, boundValue.path);
      if (resolved !== undefined) return resolved;
    }

    if (boundValue.literalString !== undefined) return boundValue.literalString;
    if (boundValue.literalNumber !== undefined) return boundValue.literalNumber;
    if (boundValue.literalBoolean !== undefined) return boundValue.literalBoolean;
    if (boundValue.literalArray !== undefined) return boundValue.literalArray;

    return undefined;
  }

  /**
   * Get a nested value from an object using a path like "/user/name"
   */
  private getNestedValue(obj: Record<string, any>, path: string): any {
    const parts = path.replace(/^\//, '').split('/');
    let current: any = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Clear all surfaces
   */
  clear(): void {
    this.surfaces.clear();
    this.onUpdate?.();
  }
}
