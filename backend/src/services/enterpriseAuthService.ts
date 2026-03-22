/**
 * Enterprise Auth Service
 *
 * Manages enterprise identity independently from tunnel configuration.
 * Stores user profile + JWT token in a dedicated file, decoupled from
 * tunnel config where it was previously embedded.
 *
 * Provides the single source of truth for enterprise authentication state.
 * Both WeChat Work binding and QQ Bot binding depend on this service.
 *
 * Dependency chain: Enterprise Login → Tunnel → IM Binding
 */

import fs from 'fs/promises';
import path from 'path';
import { ENTERPRISE_PROFILE_FILE } from '../config/paths.js';

export interface EnterpriseProfile {
  /** Enterprise user ID (from JWT or /api/v1/auth/me) */
  userId?: string | number;
  /** Display name in the enterprise */
  name?: string;
  /** User email */
  email?: string;
  /** AS Enterprise server URL */
  enterpriseUrl: string;
  /** JWT access token */
  token: string;
  /** When the token was stored (ISO 8601) */
  loginAt: string;
  /** Token expiry time if known (ISO 8601) */
  expiresAt?: string;
}

class EnterpriseAuthService {
  private profile: EnterpriseProfile | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadProfile();
    this.initialized = true;
  }

  // ── Profile persistence ──────────────────────────────────────────────

  private async loadProfile(): Promise<void> {
    try {
      const text = await fs.readFile(ENTERPRISE_PROFILE_FILE, 'utf-8');
      this.profile = JSON.parse(text);
      console.log(
        `[EnterpriseAuth] Loaded profile: ${this.profile?.name || this.profile?.email || 'unknown'}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[EnterpriseAuth] Error loading profile:', error);
      }
      this.profile = null;
    }
  }

  private async persistProfile(): Promise<void> {
    await fs.mkdir(path.dirname(ENTERPRISE_PROFILE_FILE), { recursive: true });
    if (this.profile) {
      await fs.writeFile(
        ENTERPRISE_PROFILE_FILE,
        JSON.stringify(this.profile, null, 2),
        'utf-8',
      );
    } else {
      try {
        await fs.unlink(ENTERPRISE_PROFILE_FILE);
      } catch {
        // file doesn't exist — fine
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  isAuthenticated(): boolean {
    return !!this.profile?.token;
  }

  getProfile(): EnterpriseProfile | null {
    return this.profile;
  }

  getToken(): string | null {
    return this.profile?.token || null;
  }

  getEnterpriseUrl(): string | null {
    return this.profile?.enterpriseUrl || null;
  }

  /**
   * Store enterprise credentials after successful login.
   * Optionally fetches user info from /api/v1/auth/me.
   */
  async login(
    enterpriseUrl: string,
    token: string,
    userInfo?: { userId?: string | number; name?: string; email?: string },
  ): Promise<EnterpriseProfile> {
    const url = enterpriseUrl.replace(/\/+$/, '');

    this.profile = {
      userId: userInfo?.userId,
      name: userInfo?.name,
      email: userInfo?.email,
      enterpriseUrl: url,
      token,
      loginAt: new Date().toISOString(),
    };

    // Try to fetch user info if not provided
    if (!userInfo?.name && !userInfo?.email) {
      try {
        const resp = await fetch(`${url}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const user = data.data || data;
          this.profile.userId = user.id || user.user_id;
          this.profile.name = user.name || user.username;
          this.profile.email = user.email;
        }
      } catch {
        // Non-critical — profile works without user info
      }
    }

    await this.persistProfile();
    console.log(
      `[EnterpriseAuth] Login successful: ${this.profile.name || this.profile.email || 'unknown'} @ ${url}`,
    );
    return this.profile;
  }

  async logout(): Promise<void> {
    this.profile = null;
    await this.persistProfile();
    console.log('[EnterpriseAuth] Logged out');
  }

  /**
   * Refresh the stored token using the AS Enterprise refresh endpoint.
   */
  async refreshToken(): Promise<boolean> {
    if (!this.profile?.token || !this.profile.enterpriseUrl) return false;

    try {
      const resp = await fetch(
        `${this.profile.enterpriseUrl}/api/v1/auth/refresh`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.profile.token}` },
          signal: AbortSignal.timeout(5000),
        },
      );

      if (!resp.ok) return false;

      const data = await resp.json();
      const newToken = data.data?.access_token;
      if (!newToken) return false;

      this.profile.token = newToken;
      this.profile.loginAt = new Date().toISOString();
      await this.persistProfile();
      console.log('[EnterpriseAuth] Token refreshed');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify the stored token is still valid by calling /api/v1/auth/me.
   */
  async verifyToken(): Promise<boolean> {
    if (!this.profile?.token || !this.profile.enterpriseUrl) return false;

    try {
      const resp = await fetch(
        `${this.profile.enterpriseUrl}/api/v1/auth/me`,
        {
          headers: { Authorization: `Bearer ${this.profile.token}` },
          signal: AbortSignal.timeout(5000),
        },
      );
      return resp.ok;
    } catch {
      return false;
    }
  }

  // ── Migration ────────────────────────────────────────────────────────

  /**
   * Migrate enterpriseToken from tunnel config if no profile exists yet.
   * Called once during initialization for backward compatibility.
   */
  async migrateFromTunnelConfig(tunnelConfigs: Array<{
    enterpriseToken?: string;
    enterpriseUrl?: string;
    serverUrl?: string;
  }>): Promise<boolean> {
    if (this.profile?.token) return false; // already have a profile

    for (const cfg of tunnelConfigs) {
      if (cfg.enterpriseToken) {
        await this.login(
          cfg.enterpriseUrl || cfg.serverUrl || '',
          cfg.enterpriseToken,
        );
        console.log(
          '[EnterpriseAuth] Migrated token from tunnel config',
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Build HTTP headers with Bearer token for authenticated requests
   * to as-dispatch or other enterprise services.
   */
  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.profile?.token) {
      headers['Authorization'] = `Bearer ${this.profile.token}`;
    }
    return headers;
  }
}

export const enterpriseAuthService = new EnterpriseAuthService();
