/**
 * LAVS Subscription Manager
 *
 * Manages real-time subscriptions for LAVS endpoints.
 * Uses Server-Sent Events (SSE) as the transport layer.
 *
 * Protocol flow:
 * 1. Client opens SSE connection: GET /api/agents/:agentId/lavs/:endpoint/subscribe
 * 2. Server sends events when data changes
 * 3. Client or server can close the connection
 */

import { Response } from 'express';
import crypto from 'crypto';

/**
 * A single subscription
 */
interface Subscription {
  id: string;
  agentId: string;
  endpointId: string;
  res: Response;
  createdAt: number;
}

/**
 * Event data to push to subscribers
 */
export interface SubscriptionEvent {
  type: string;
  data: unknown;
  timestamp?: string;
}

/**
 * Configuration for the subscription manager
 */
interface SubscriptionManagerOptions {
  /** Maximum number of concurrent subscriptions (default: 100) */
  maxSubscriptions?: number;
  /** Heartbeat interval in ms to keep connections alive (default: 30000) */
  heartbeatIntervalMs?: number;
}

/**
 * LAVS Subscription Manager - manages SSE-based subscriptions
 */
export class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();
  private readonly maxSubscriptions: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SubscriptionManagerOptions = {}) {
    this.maxSubscriptions = options.maxSubscriptions ?? 100;
    const heartbeatMs = options.heartbeatIntervalMs ?? 30_000;

    // Send periodic heartbeats to keep connections alive and detect stale ones
    this.heartbeatTimer = setInterval(() => this.sendHeartbeats(), heartbeatMs);
    // Allow the process to exit even with the timer running
    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Send heartbeat to all subscriptions. Removes stale connections.
   */
  private sendHeartbeats(): void {
    for (const [subId, sub] of this.subscriptions.entries()) {
      try {
        if (sub.res.writableEnded) {
          this.subscriptions.delete(subId);
          continue;
        }
        // SSE comment line as heartbeat (ignored by clients but keeps connection alive)
        sub.res.write(': heartbeat\n\n');
      } catch {
        this.subscriptions.delete(subId);
      }
    }
  }

  /**
   * Stop the heartbeat timer (for graceful shutdown / tests)
   */
  destroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Close all active subscriptions
    for (const subId of [...this.subscriptions.keys()]) {
      this.unsubscribe(subId);
    }
  }

  /**
   * Create a new subscription.
   *
   * @param agentId - Agent identifier
   * @param endpointId - Endpoint identifier (must be a subscription endpoint)
   * @param res - Express response object (will be held open for SSE)
   * @returns Subscription ID
   * @throws Error if max subscriptions limit is reached
   */
  subscribe(agentId: string, endpointId: string, res: Response): string {
    if (this.subscriptions.size >= this.maxSubscriptions) {
      throw new Error(
        `Maximum subscriptions limit reached (${this.maxSubscriptions}). ` +
        'Close existing subscriptions before opening new ones.'
      );
    }
    const subscriptionId = crypto.randomUUID();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Subscription-Id': subscriptionId,
    });

    // Send initial connection event
    this.sendSSE(res, {
      event: 'connected',
      data: JSON.stringify({
        subscriptionId,
        agentId,
        endpointId,
        message: 'Subscription active',
      }),
    });

    // Store subscription
    const subscription: Subscription = {
      id: subscriptionId,
      agentId,
      endpointId,
      res,
      createdAt: Date.now(),
    };
    this.subscriptions.set(subscriptionId, subscription);

    // Clean up on client disconnect
    res.on('close', () => {
      this.unsubscribe(subscriptionId);
    });

    console.log(JSON.stringify({
      level: 'info',
      module: 'lavs',
      event: 'subscription_created',
      subscriptionId,
      agentId,
      endpointId,
      totalActive: this.subscriptions.size,
    }));

    return subscriptionId;
  }

  /**
   * Remove a subscription
   */
  unsubscribe(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    // End the SSE stream
    try {
      if (!sub.res.writableEnded) {
        this.sendSSE(sub.res, {
          event: 'disconnected',
          data: JSON.stringify({ reason: 'unsubscribed' }),
        });
        sub.res.end();
      }
    } catch {
      // Ignore errors on cleanup
    }

    this.subscriptions.delete(subscriptionId);

    console.log(JSON.stringify({
      level: 'info',
      module: 'lavs',
      event: 'subscription_removed',
      subscriptionId,
      agentId: sub.agentId,
      endpointId: sub.endpointId,
      totalActive: this.subscriptions.size,
    }));

    return true;
  }

  /**
   * Push an event to all subscribers of a specific agent+endpoint.
   *
   * @param agentId - Agent identifier
   * @param endpointId - Endpoint identifier
   * @param event - Event data to push
   * @returns Number of subscribers notified
   */
  publish(agentId: string, endpointId: string, event: SubscriptionEvent): number {
    let count = 0;

    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.agentId === agentId && sub.endpointId === endpointId) {
        try {
          if (!sub.res.writableEnded) {
            this.sendSSE(sub.res, {
              event: event.type,
              data: JSON.stringify({
                ...event,
                timestamp: event.timestamp || new Date().toISOString(),
              }),
              id: subId,
            });
            count++;
          }
        } catch {
          // Remove broken connections
          this.subscriptions.delete(subId);
        }
      }
    }

    return count;
  }

  /**
   * Push an event to all subscribers of a specific agent (any endpoint).
   *
   * @param agentId - Agent identifier
   * @param event - Event data to push
   * @returns Number of subscribers notified
   */
  publishToAgent(agentId: string, event: SubscriptionEvent): number {
    let count = 0;

    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.agentId === agentId) {
        try {
          if (!sub.res.writableEnded) {
            this.sendSSE(sub.res, {
              event: event.type,
              data: JSON.stringify({
                ...event,
                timestamp: event.timestamp || new Date().toISOString(),
              }),
              id: subId,
            });
            count++;
          }
        } catch {
          this.subscriptions.delete(subId);
        }
      }
    }

    return count;
  }

  /**
   * Get count of active subscriptions
   */
  getActiveCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get active subscriptions for an agent
   */
  getSubscriptionsForAgent(agentId: string): { id: string; endpointId: string; createdAt: number }[] {
    const result: { id: string; endpointId: string; createdAt: number }[] = [];
    for (const sub of this.subscriptions.values()) {
      if (sub.agentId === agentId) {
        result.push({
          id: sub.id,
          endpointId: sub.endpointId,
          createdAt: sub.createdAt,
        });
      }
    }
    return result;
  }

  /**
   * Send an SSE event to a response stream
   */
  private sendSSE(
    res: Response,
    opts: { event?: string; data: string; id?: string }
  ): void {
    if (opts.id) {
      res.write(`id: ${opts.id}\n`);
    }
    if (opts.event) {
      res.write(`event: ${opts.event}\n`);
    }
    res.write(`data: ${opts.data}\n\n`);
  }
}

// Singleton instance
export const subscriptionManager = new SubscriptionManager();
