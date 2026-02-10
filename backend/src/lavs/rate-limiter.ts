/**
 * LAVS Rate Limiter
 *
 * Simple in-memory rate limiter for LAVS endpoint calls.
 * Uses a sliding window counter algorithm.
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

/**
 * LAVS Rate Limiter - prevents excessive endpoint calls
 */
export class LAVSRateLimiter {
  private windows: Map<string, WindowEntry> = new Map();
  private defaultConfig: RateLimitConfig;

  /**
   * Create a rate limiter with default configuration
   * @param config - Default rate limit config (default: 60 requests per minute)
   */
  constructor(config?: Partial<RateLimitConfig>) {
    this.defaultConfig = {
      maxRequests: config?.maxRequests ?? 60,
      windowMs: config?.windowMs ?? 60000,
    };
  }

  /**
   * Check if a request is allowed under the rate limit.
   *
   * @param key - Rate limit key (e.g., `${agentId}:${endpointId}`)
   * @param config - Optional per-key override config
   * @returns Rate limit check result
   */
  check(key: string, config?: Partial<RateLimitConfig>): RateLimitResult {
    const { maxRequests, windowMs } = { ...this.defaultConfig, ...config };
    const now = Date.now();

    let entry = this.windows.get(key);

    // If no entry or window expired, start a new window
    if (!entry || (now - entry.windowStart) >= windowMs) {
      entry = { count: 0, windowStart: now };
      this.windows.set(key, entry);
    }

    // Check if within limit
    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + windowMs,
      };
    }

    // Increment counter
    entry.count++;

    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.windowStart + windowMs,
    };
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /**
   * Clear all rate limit entries
   */
  clearAll(): void {
    this.windows.clear();
  }

  /**
   * Clean up expired windows to prevent memory leaks.
   * Should be called periodically.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows.entries()) {
      if ((now - entry.windowStart) >= this.defaultConfig.windowMs * 2) {
        this.windows.delete(key);
      }
    }
  }
}
