/**
 * Run-Finished Hook Executor
 *
 * Executes agent lifecycle hooks that fire after a successful chat run,
 * just before the RUN_FINISHED event is sent to the client.
 *
 * Each hook action produces zero or more AGUI events that are written to the
 * SSE stream *before* RUN_FINISHED, keeping the platform generic while
 * allowing agents to declare post-run behaviour via configuration.
 */

import type { OnRunFinishedHookConfig } from '../types/agents.js';
import type { AGUIEvent } from '../engines/types.js';
import { AGUIEventType } from '../engines/types.js';
import { createVersion } from './gitVersionService.js';

// =============================================================================
// Public API
// =============================================================================

export interface RunFinishedHookContext {
  /** Absolute path to the project / workspace directory. */
  projectPath: string;
  /** Agent ID that produced the run. */
  agentId?: string;
  /** Session ID of the run. */
  sessionId?: string;
}

/**
 * Execute the configured onRunFinished hook and return any AGUI events that
 * should be sent to the client before RUN_FINISHED.
 *
 * If no hook is configured, or the hook fails, an empty array is returned so
 * the caller can proceed normally.
 */
export async function runOnRunFinishedHook(
  config: OnRunFinishedHookConfig,
  ctx: RunFinishedHookContext
): Promise<AGUIEvent[]> {
  const events: AGUIEvent[] = [];

  switch (config.action) {
    case 'create_version': {
      try {
        const commitMessage = config.message ?? 'Auto-save after AI response';
        const versionResult = await createVersion(ctx.projectPath, commitMessage);

        console.log(
          `🎮 [hook:create_version] Auto-committed version ${versionResult.tag} for project: ${ctx.projectPath}`
        );

        // Emit as AGUI CUSTOM event — callers listen for name === 'version_created'
        events.push({
          type: AGUIEventType.CUSTOM,
          name: 'version_created',
          data: {
            tag: versionResult.tag,
            hash: versionResult.hash,
            commitHash: versionResult.commitHash,
            message: versionResult.message,
            agentId: ctx.agentId,
            sessionId: ctx.sessionId,
          },
          timestamp: Date.now(),
        } as AGUIEvent);
      } catch (error: any) {
        // Don't fail the whole request — just skip the version event
        console.warn(`🎮 [hook:create_version] Skipped: ${error.message}`);
      }
      break;
    }

    default:
      console.warn(`[runFinishedHook] Unknown action: ${(config as any).action}`);
  }

  return events;
}
