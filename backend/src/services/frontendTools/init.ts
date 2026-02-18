/**
 * Frontend Tools Module Initialization
 *
 * Wires the FrontendToolBridge events to the NotificationChannelManager
 * and starts the cleanup job.
 */

import { frontendToolBridge } from './frontendToolBridge.js';
import { notificationChannelManager } from './notificationChannelManager.js';
import type { FrontendToolRequest } from './types.js';

let initialized = false;

export function initFrontendToolsModule(): void {
  if (initialized) return;

  frontendToolBridge.on('tool_invocation', async (request: FrontendToolRequest) => {
    const sent = await notificationChannelManager.sendToolInvocation(request);
    if (!sent) {
      console.warn(
        `[FrontendTools] No active channel for session ${request.sessionId}, ` +
        `toolCallId=${request.toolCallId}. The request remains pending.`,
      );
    }
  });

  frontendToolBridge.startCleanupJob();
  initialized = true;
}

export function isFrontendToolsModuleInitialized(): boolean {
  return initialized;
}
