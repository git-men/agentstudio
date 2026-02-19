import { HookStorage } from './hookStorage.js';
import { HookManager } from './hookManager.js';
import { ShellExecutor } from './executors/shellExecutor.js';
import { ScriptExecutor } from './executors/scriptExecutor.js';
import { WebhookExecutor } from './executors/webhookExecutor.js';
import { platformEventBus } from './platformEventBus.js';
import type { ExecutorRegistry } from './executors/types.js';

let hookManager: HookManager | null = null;
let unsubscribe: (() => void) | null = null;

export async function initHookSystem(): Promise<HookManager> {
  if (hookManager) return hookManager;

  try {
    const storage = new HookStorage();

    const executors: ExecutorRegistry = new Map();
    executors.set('shell', new ShellExecutor());
    executors.set('script', new ScriptExecutor());
    executors.set('webhook', new WebhookExecutor());

    hookManager = new HookManager(storage, executors);
    await hookManager.initialize();

    unsubscribe = platformEventBus.subscribe('*', (event) => {
      hookManager!.handleEvent(event);
    });

    console.log('[HookSystem] Platform hook system initialized');
    return hookManager;
  } catch (err) {
    console.error('[HookSystem] Failed to initialize hook system:', err);
    throw err;
  }
}

export function getHookManager(): HookManager | null {
  return hookManager;
}

export function shutdownHookSystem(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  hookManager = null;
  console.log('[HookSystem] Platform hook system shut down');
}

export { platformEventBus } from './platformEventBus.js';
export { HookManager } from './hookManager.js';
export { HookStorage } from './hookStorage.js';
