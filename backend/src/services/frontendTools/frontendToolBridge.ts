/**
 * Frontend Tool Bridge
 *
 * Central coordinator that connects the Agent (via MCP tools) with the
 * frontend (via notification channels). When the agent calls a frontend tool,
 * the bridge:
 *
 * 1. Creates a blocking Promise and stores it keyed by toolCallId
 * 2. Emits an event so the notification system can alert the user
 * 3. Waits until the frontend submits a result via the HTTP API
 * 4. Resolves the Promise, returning the result to the MCP tool → Agent
 *
 * This replaces the previous UserInputRegistry with a generalized mechanism
 * that works for any frontend tool, not just AskUserQuestion.
 */

import { EventEmitter } from 'events';
import type { FrontendToolRequest } from './types.js';

interface PendingToolCall {
  request: FrontendToolRequest;
  resolve: (result: string) => void;
  reject: (error: Error) => void;
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

class FrontendToolBridge extends EventEmitter {
  private pending: Map<string, PendingToolCall> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private maxAgeMs: number = DEFAULT_MAX_AGE_MS;

  /**
   * Register a tool invocation and wait for the frontend result.
   * The returned Promise resolves when the frontend submits the result.
   */
  async waitForResult(
    toolCallId: string,
    toolName: string,
    sessionId: string,
    agentId: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (this.pending.has(toolCallId)) {
      throw new Error(`Duplicate toolCallId: ${toolCallId}`);
    }

    const request: FrontendToolRequest = {
      toolCallId,
      toolName,
      sessionId,
      agentId,
      args,
      createdAt: Date.now(),
    };

    return new Promise<string>((resolve, reject) => {
      const entry: PendingToolCall = {
        request,
        resolve: (result: string) => {
          this.pending.delete(toolCallId);
          resolve(result);
        },
        reject: (error: Error) => {
          this.pending.delete(toolCallId);
          reject(error);
        },
      };

      this.pending.set(toolCallId, entry);
      this.emit('tool_invocation', request);
    });
  }

  /**
   * Submit a result from the frontend.  Validates session/agent ownership.
   */
  submitResult(
    toolCallId: string,
    result: string,
    sessionId: string,
    agentId: string,
  ): { success: boolean; error?: string } {
    const entry = this.pending.get(toolCallId);

    if (!entry) {
      return { success: false, error: 'No pending tool call found for this toolCallId' };
    }

    if (entry.request.sessionId !== sessionId) {
      return { success: false, error: 'Session ID mismatch' };
    }

    if (entry.request.agentId !== agentId) {
      return { success: false, error: 'Agent ID mismatch' };
    }

    entry.resolve(result);
    return { success: true };
  }

  /**
   * Cancel a single pending tool call.
   */
  cancel(toolCallId: string, reason?: string): boolean {
    const entry = this.pending.get(toolCallId);
    if (!entry) return false;
    entry.reject(new Error(reason || 'Frontend tool call cancelled'));
    return true;
  }

  /**
   * Cancel all pending tool calls for a session.
   */
  cancelBySession(sessionId: string, reason?: string): number {
    let count = 0;
    for (const [id, entry] of this.pending.entries()) {
      if (entry.request.sessionId === sessionId) {
        entry.reject(new Error(reason || 'Session terminated'));
        this.pending.delete(id);
        count++;
      }
    }
    return count;
  }

  hasPending(toolCallId: string): boolean {
    return this.pending.has(toolCallId);
  }

  getPending(toolCallId: string): FrontendToolRequest | null {
    return this.pending.get(toolCallId)?.request ?? null;
  }

  getPendingBySession(sessionId: string): FrontendToolRequest[] {
    const results: FrontendToolRequest[] = [];
    for (const entry of this.pending.values()) {
      if (entry.request.sessionId === sessionId) {
        results.push(entry.request);
      }
    }
    return results;
  }

  /**
   * Update sessionId for all pending calls (used when a temporary session ID
   * is replaced by the real one from the Claude SDK).
   */
  updateSessionId(oldSessionId: string, newSessionId: string): number {
    let count = 0;
    for (const entry of this.pending.values()) {
      if (entry.request.sessionId === oldSessionId) {
        entry.request.sessionId = newSessionId;
        count++;
      }
    }
    return count;
  }

  getStats(): { totalPending: number; oldestAge: number | null } {
    const now = Date.now();
    let oldest: number | null = null;
    for (const entry of this.pending.values()) {
      const age = now - entry.request.createdAt;
      if (oldest === null || age > oldest) oldest = age;
    }
    return { totalPending: this.pending.size, oldestAge: oldest };
  }

  // ── Cleanup ────────────────────────────────────────────────

  startCleanupJob(
    intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
  ): void {
    if (this.cleanupInterval) return;
    this.maxAgeMs = maxAgeMs;
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), intervalMs);
  }

  stopCleanupJob(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private cleanupExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, entry] of this.pending.entries()) {
      const age = now - entry.request.createdAt;
      if (age > this.maxAgeMs) {
        entry.reject(new Error(`Request expired after ${Math.round(age / 1000 / 60)} minutes`));
        this.pending.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const frontendToolBridge = new FrontendToolBridge();
