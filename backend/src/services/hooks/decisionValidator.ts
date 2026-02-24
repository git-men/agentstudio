import { z } from 'zod';
import type { HookDecision } from '../../types/platformHooks.js';

const hookDecisionSchema = z.object({
  decision: z.enum(['allow', 'block', 'rewrite']),
  reason: z.string().optional(),
  rewrittenMessage: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Validate and normalize a raw value into a HookDecision.
 * - If decision is 'rewrite' but rewrittenMessage is missing, downgrades to 'allow'.
 * - Returns null for completely invalid input.
 */
export function parseHookDecision(raw: unknown): HookDecision | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return null;
  }

  const parsed = hookDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const decision = parsed.data;

  if (decision.decision === 'rewrite' && !decision.rewrittenMessage) {
    return {
      ...decision,
      decision: 'allow',
      reason: decision.reason ?? 'Rewrite downgraded to allow: missing rewrittenMessage',
    };
  }

  return decision;
}
