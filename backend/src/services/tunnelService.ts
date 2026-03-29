/**
 * Tunnel Service — Multi-Tunnel Manager
 *
 * Manages multiple WebSocket tunnel connections to allow external access
 * to local Agent Studio via different tunnel servers.
 *
 * Features:
 * - Multiple simultaneous tunnel connections
 * - Per-tunnel configuration with unique IDs
 * - Auto-connect enabled tunnels on startup
 * - Automatic reconnection on disconnect
 * - Backward-compatible migration from single-tunnel config
 */

import { TunnelClient, TunnelClientConfig } from 'tunely';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { TUNNEL_CONFIG_FILE, getTunnelConfigFile } from '../config/paths.js';

const getPortConfigFile = (port: number) => getTunnelConfigFile(port);
const DEFAULT_CONFIG_FILE = TUNNEL_CONFIG_FILE;

/**
 * Per-tunnel configuration stored on disk
 */
export interface TunnelConfig {
  /** Unique tunnel identifier */
  id: string;
  /** Human-readable label (e.g., "生产隧道", "测试隧道") */
  label: string;
  /** Whether tunnel should auto-connect on startup */
  enabled: boolean;
  /** Tunnel server base URL (e.g., https://agentstudio.woa.com) */
  serverUrl: string;
  /** WebSocket URL for tunnel connection (from server /api/info) */
  websocketUrl?: string;
  /** Tunnel authentication token */
  token: string;
  /** as-enterprise JWT token for creating/managing tunnels via API */
  enterpriseToken?: string;
  /** as-enterprise server URL (for token verification/refresh, may differ from tunnel serverUrl) */
  enterpriseUrl?: string;
  /** Tunnel name (subdomain part, e.g., "my-dev" for my-dev.tunnel) */
  tunnelName?: string;
  /** Domain suffix (e.g., ".agentstudio.woa.com") */
  domainSuffix?: string;
  /** Protocol for tunnel domain (https or http) */
  protocol?: 'https' | 'http';
  /** Reconnect interval in milliseconds */
  reconnectInterval?: number;
  /** Maximum reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;
  /** Request timeout in milliseconds (default: 300000 = 5 minutes) */
  requestTimeout?: number;
}

export interface TunnelCheckResult {
  available: boolean;
  reason?: string;
}

export interface TunnelCreateResult {
  success: boolean;
  tunnelId?: string;
  token?: string;
  domain?: string;
  error?: string;
}

/**
 * Per-tunnel connection status
 */
export interface TunnelStatus {
  /** Tunnel ID */
  id: string;
  /** Display label */
  label: string;
  /** Whether tunnel is enabled in config */
  enabled: boolean;
  /** Whether currently connected */
  connected: boolean;
  /** Assigned tunnel domain (e.g., "my-dev.tunnel") */
  domain: string | null;
  /** Last error message if any */
  lastError: string | null;
  /** Connection timestamp */
  connectedAt: string | null;
  /** Number of reconnect attempts */
  reconnectCount: number;
  /** Tunnel server URL */
  serverUrl: string;
  /** Local port this tunnel forwards to */
  localPort: number;
}

/**
 * Legacy single-tunnel config (for migration)
 */
interface LegacyTunnelConfig {
  enabled: boolean;
  serverUrl: string;
  websocketUrl?: string;
  token: string;
  enterpriseToken?: string;
  enterpriseUrl?: string;
  tunnelName?: string;
  domainSuffix?: string;
  protocol?: 'https' | 'http';
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  requestTimeout?: number;
}

const DEFAULT_TUNNEL_VALUES: Omit<TunnelConfig, 'id' | 'label'> = {
  enabled: false,
  serverUrl: 'https://agentstudio.woa.com',
  token: '',
  tunnelName: '',
  protocol: 'https',
  reconnectInterval: 5000,
  maxReconnectAttempts: 0,
};

function generateTunnelId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function getWebSocketUrl(serverUrl: string): string {
  const apiBaseUrl = getApiBaseUrl(serverUrl);
  const url = new URL(apiBaseUrl);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${url.host}/ws/tunnel`;
}

function getApiBaseUrl(serverUrl: string): string {
  if (serverUrl.startsWith('wss://') || serverUrl.startsWith('ws://')) {
    const url = new URL(serverUrl);
    const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${url.host}`;
  }
  return serverUrl.replace(/\/+$/, '');
}

/**
 * Check if a raw config object is legacy (single-tunnel) format
 */
function isLegacyConfig(data: unknown): data is LegacyTunnelConfig {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    'serverUrl' in data
  );
}

/**
 * Migrate a legacy single-tunnel config to multi-tunnel array
 */
function migrateLegacyConfig(legacy: LegacyTunnelConfig): TunnelConfig[] {
  const config: TunnelConfig = {
    id: generateTunnelId(),
    label: legacy.tunnelName || '默认隧道',
    ...DEFAULT_TUNNEL_VALUES,
    ...legacy,
  };
  return [config];
}

/**
 * Multi-Tunnel Service
 */
class TunnelService {
  private clients = new Map<string, TunnelClient>();
  private configs = new Map<string, TunnelConfig>();
  private statuses = new Map<string, TunnelStatus>();
  private localPort: number = 4936;
  private initialized = false;
  private configSource: 'port-specific' | 'default' | 'none' = 'none';

  async initialize(localPort?: number): Promise<void> {
    if (this.initialized) return;

    if (localPort) this.localPort = localPort;

    await this.loadConfigs();
    this.initialized = true;

    // Auto-connect all enabled tunnels
    const enabledTunnels = Array.from(this.configs.values()).filter(
      (c) => c.enabled && c.token,
    );

    if (enabledTunnels.length > 0) {
      console.log(`[Tunnel] Auto-connecting ${enabledTunnels.length} tunnel(s)...`);
      await Promise.allSettled(
        enabledTunnels.map((c) => this.connect(c.id, true)),
      );
    } else {
      console.log('[Tunnel] No tunnels to auto-connect');
    }
  }

  // ---------------------------------------------------------------------------
  // Config persistence
  // ---------------------------------------------------------------------------

  async loadConfigs(): Promise<TunnelConfig[]> {
    const portConfigFile = getPortConfigFile(this.localPort);

    let rawData: unknown = null;
    let source: 'port-specific' | 'default' | 'none' = 'none';

    // Try port-specific config first
    try {
      const text = await fs.readFile(portConfigFile, 'utf-8');
      rawData = JSON.parse(text);
      source = 'port-specific';
      console.log(`[Tunnel] Loaded config from: ${portConfigFile}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          const text = await fs.readFile(DEFAULT_CONFIG_FILE, 'utf-8');
          rawData = JSON.parse(text);
          source = 'default';
          console.log(`[Tunnel] Loaded default config from: ${DEFAULT_CONFIG_FILE}`);
        } catch (defaultError) {
          if ((defaultError as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[Tunnel] Error loading default config:', defaultError);
          }
        }
      } else {
        console.error('[Tunnel] Error loading port-specific config:', error);
      }
    }

    this.configSource = source;
    this.configs.clear();
    this.statuses.clear();

    let tunnelConfigs: TunnelConfig[] = [];

    if (rawData !== null) {
      if (isLegacyConfig(rawData)) {
        console.log('[Tunnel] Migrating legacy single-tunnel config to multi-tunnel format');
        tunnelConfigs = migrateLegacyConfig(rawData);
        if (source === 'default') {
          // Loaded from global fallback: disable all tunnels to prevent
          // multiple port instances from racing for the same token.
          console.warn(
            `[Tunnel] Global fallback config detected for port ${this.localPort}. ` +
            `Disabling all tunnels to avoid token conflicts across instances. ` +
            `Re-enable tunnels manually in Settings if needed.`,
          );
          tunnelConfigs = tunnelConfigs.map((c) => ({ ...c, enabled: false }));
        }
        // Persist to port-specific file (migration)
        await this.persistConfigs(tunnelConfigs);
      } else if (Array.isArray(rawData)) {
        tunnelConfigs = rawData as TunnelConfig[];
        if (source === 'default') {
          // Loaded from global fallback: disable and persist to port-specific
          // file so future startups use the isolated copy, not the shared one.
          console.warn(
            `[Tunnel] Global fallback config detected for port ${this.localPort}. ` +
            `Disabling all tunnels to avoid token conflicts across instances. ` +
            `Re-enable tunnels manually in Settings if needed.`,
          );
          tunnelConfigs = tunnelConfigs.map((c) => ({ ...c, enabled: false }));
          await this.persistConfigs(tunnelConfigs);
        }
      }
    }

    for (const cfg of tunnelConfigs) {
      this.configs.set(cfg.id, { ...DEFAULT_TUNNEL_VALUES, ...cfg });
      this.statuses.set(cfg.id, this.createDefaultStatus(cfg));
    }

    return tunnelConfigs;
  }

  private createDefaultStatus(cfg: TunnelConfig): TunnelStatus {
    return {
      id: cfg.id,
      label: cfg.label,
      enabled: cfg.enabled,
      connected: false,
      domain: null,
      lastError: null,
      connectedAt: null,
      reconnectCount: 0,
      serverUrl: cfg.serverUrl,
      localPort: this.localPort,
    };
  }

  private async persistConfigs(configs?: TunnelConfig[]): Promise<void> {
    const data = configs || Array.from(this.configs.values());
    const portConfigFile = getPortConfigFile(this.localPort);
    await fs.mkdir(path.dirname(portConfigFile), { recursive: true });
    await fs.writeFile(portConfigFile, JSON.stringify(data, null, 2), 'utf-8');
    this.configSource = 'port-specific';
  }

  // ---------------------------------------------------------------------------
  // Config CRUD
  // ---------------------------------------------------------------------------

  getConfig(tunnelId: string): TunnelConfig | undefined {
    const cfg = this.configs.get(tunnelId);
    if (!cfg) return undefined;
    return {
      ...cfg,
      token: cfg.token ? `${cfg.token.slice(0, 8)}...` : '',
    };
  }

  getAllConfigs(): TunnelConfig[] {
    return Array.from(this.configs.values()).map((cfg) => ({
      ...cfg,
      token: cfg.token ? `${cfg.token.slice(0, 8)}...` : '',
    }));
  }

  async saveConfig(tunnelId: string, partial: Partial<TunnelConfig>): Promise<TunnelConfig> {
    const existing = this.configs.get(tunnelId);
    if (!existing) throw new Error(`Tunnel not found: ${tunnelId}`);

    const updated = { ...existing, ...partial, id: tunnelId };
    this.configs.set(tunnelId, updated);

    // Sync status label / enabled / serverUrl
    const st = this.statuses.get(tunnelId);
    if (st) {
      st.label = updated.label;
      st.enabled = updated.enabled;
      st.serverUrl = updated.serverUrl;
    }

    await this.persistConfigs();
    return updated;
  }

  async addTunnel(partial: Partial<TunnelConfig>): Promise<TunnelConfig> {
    const id = partial.id || generateTunnelId();
    const cfg: TunnelConfig = {
      ...DEFAULT_TUNNEL_VALUES,
      ...partial,
      id,
      label: partial.label || partial.tunnelName || '新隧道',
    };
    this.configs.set(id, cfg);
    this.statuses.set(id, this.createDefaultStatus(cfg));
    await this.persistConfigs();
    console.log(`[Tunnel] Added tunnel: ${id} (${cfg.label})`);
    return cfg;
  }

  async removeTunnel(tunnelId: string): Promise<void> {
    this.disconnect(tunnelId);
    this.configs.delete(tunnelId);
    this.statuses.delete(tunnelId);
    await this.persistConfigs();
    console.log(`[Tunnel] Removed tunnel: ${tunnelId}`);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  getStatus(tunnelId: string): TunnelStatus | undefined {
    return this.statuses.get(tunnelId);
  }

  getAllStatuses(): TunnelStatus[] {
    return Array.from(this.statuses.values());
  }

  // ---------------------------------------------------------------------------
  // Connect / Disconnect
  // ---------------------------------------------------------------------------

  async connect(tunnelId: string, force = false): Promise<void> {
    const cfg = this.configs.get(tunnelId);
    if (!cfg) throw new Error(`Tunnel not found: ${tunnelId}`);
    if (!cfg.token) throw new Error('Tunnel token is not configured');

    // Disconnect existing connection
    if (this.clients.has(tunnelId)) {
      this.disconnect(tunnelId);
    }

    const targetUrl = `http://localhost:${this.localPort}`;
    const wsUrl = cfg.websocketUrl || getWebSocketUrl(cfg.serverUrl);

    console.log(`[Tunnel:${tunnelId}] Connecting to ${wsUrl}...`);
    console.log(`[Tunnel:${tunnelId}] Token: ${cfg.token.slice(0, 10)}...`);
    console.log(`[Tunnel:${tunnelId}] Target: ${targetUrl}`);
    if (force) console.log(`[Tunnel:${tunnelId}] Force mode enabled`);

    const requestTimeout = cfg.requestTimeout || 300000;

    const clientConfig: TunnelClientConfig = {
      serverUrl: wsUrl,
      token: cfg.token,
      targetUrl,
      reconnectInterval: cfg.reconnectInterval || 5000,
      maxReconnectAttempts: cfg.maxReconnectAttempts || 0,
      requestTimeout,
      force,
    };

    const client = new TunnelClient(clientConfig);
    this.clients.set(tunnelId, client);

    const status = this.statuses.get(tunnelId)!;

    client.on('onConnect', (domain: string) => {
      console.log(`[Tunnel:${tunnelId}] Connected! Domain: ${domain}`);
      status.connected = true;
      status.domain = domain;
      status.lastError = null;
      status.connectedAt = new Date().toISOString();
      status.reconnectCount = 0;
    });

    client.on('onDisconnect', () => {
      console.log(`[Tunnel:${tunnelId}] Disconnected`);
      status.connected = false;
      status.reconnectCount++;
    });

    client.on('onError', (error: Error) => {
      console.error(`[Tunnel:${tunnelId}] Error:`, error.message);
      status.lastError = error.message;
    });

    client.on('onRequest', (request: any) => {
      const queryStr =
        request.query && Object.keys(request.query).length > 0
          ? '?' + new URLSearchParams(request.query).toString()
          : '';
      console.log(`[Tunnel:${tunnelId}] ${request.method} ${request.path}${queryStr}`);
    });

    client.run().catch((error) => {
      console.error(`[Tunnel:${tunnelId}] Client run error:`, error);
      status.lastError = error.message;
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!status.connected) {
      console.log(`[Tunnel:${tunnelId}] Initial connection pending...`);
    }
  }

  disconnect(tunnelId: string): void {
    const client = this.clients.get(tunnelId);
    if (client) {
      console.log(`[Tunnel:${tunnelId}] Disconnecting...`);
      client.stop();
      this.clients.delete(tunnelId);
    }
    const status = this.statuses.get(tunnelId);
    if (status) {
      status.connected = false;
      status.domain = null;
      status.connectedAt = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Batch operations
  // ---------------------------------------------------------------------------

  async connectAll(): Promise<{ tunnelId: string; success: boolean; error?: string }[]> {
    const results: { tunnelId: string; success: boolean; error?: string }[] = [];
    const configs = Array.from(this.configs.values()).filter((c) => c.token);

    await Promise.allSettled(
      configs.map(async (cfg) => {
        try {
          await this.connect(cfg.id);
          results.push({ tunnelId: cfg.id, success: true });
        } catch (err) {
          results.push({
            tunnelId: cfg.id,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    return results;
  }

  disconnectAll(): void {
    for (const id of this.clients.keys()) {
      this.disconnect(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Tunnel provisioning (create on remote server)
  // ---------------------------------------------------------------------------

  async checkTunnelName(
    name: string,
    serverUrl: string,
  ): Promise<TunnelCheckResult> {
    if (!name || name.trim() === '') {
      return { available: false, reason: '隧道名称不能为空' };
    }

    const apiBaseUrl = getApiBaseUrl(serverUrl);

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/tunnels/check-availability?name=${encodeURIComponent(name)}`,
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          available: false,
          reason:
            errorData.reason ||
            errorData.message ||
            errorData.error ||
            `检查失败: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        available: data.available !== false,
        reason: data.reason || data.message,
      };
    } catch (error) {
      console.error('[Tunnel] Error checking name availability:', error);
      return {
        available: false,
        reason: error instanceof Error ? error.message : '网络请求失败',
      };
    }
  }

  async createTunnelOnServer(
    name: string,
    serverUrl: string,
    accessToken?: string,
  ): Promise<TunnelCreateResult> {
    if (!name || name.trim() === '') {
      return { success: false, error: '隧道名称不能为空' };
    }

    const apiBaseUrl = getApiBaseUrl(serverUrl);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/tunnels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ domain: name.trim(), name: name.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error:
            errorData.reason ||
            errorData.message ||
            errorData.error ||
            `创建失败: HTTP ${response.status}`,
        };
      }

      const data = await response.json();
      if (data.token) {
        return {
          success: true,
          token: data.token,
          domain: data.domain || `${name}.tunnel`,
        };
      }
      return { success: false, error: data.error || data.message || '未返回 Token' };
    } catch (error) {
      console.error('[Tunnel] Error creating tunnel:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '网络请求失败',
      };
    }
  }

  /**
   * Create tunnel on remote server, persist config, and optionally connect.
   * Returns the new tunnel's config ID.
   */
  async createAndSave(opts: {
    name: string;
    serverUrl: string;
    label?: string;
    autoConnect?: boolean;
    protocol?: 'https' | 'http';
    websocketUrl?: string;
    domainSuffix?: string;
    accessToken?: string;
  }): Promise<TunnelCreateResult> {
    const result = await this.createTunnelOnServer(
      opts.name,
      opts.serverUrl,
      opts.accessToken,
    );

    if (!result.success || !result.token) return result;

    const cfg = await this.addTunnel({
      label: opts.label || opts.name,
      enabled: opts.autoConnect ?? false,
      serverUrl: opts.serverUrl,
      token: result.token,
      tunnelName: opts.name,
      protocol: opts.protocol || 'https',
      websocketUrl: opts.websocketUrl,
      domainSuffix: opts.domainSuffix,
    });

    result.tunnelId = cfg.id;

    if (opts.autoConnect) {
      try {
        await this.connect(cfg.id);
      } catch (err) {
        console.error(`[Tunnel:${cfg.id}] Auto-connect after create failed:`, err);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Health check (per-tunnel)
  // ---------------------------------------------------------------------------

  async performHealthCheck(tunnelId: string): Promise<boolean> {
    const status = this.statuses.get(tunnelId);
    const cfg = this.configs.get(tunnelId);
    if (!status?.connected || !status.domain || !cfg) return false;

    try {
      const protocol = cfg.protocol || 'https';
      const fullDomain = cfg.domainSuffix
        ? `${status.domain}${cfg.domainSuffix}`
        : status.domain;
      const testUrl = `${protocol}://${fullDomain}/api/version`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(testUrl, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok || response.status === 401;
    } catch (error) {
      console.warn(
        `[Tunnel:${tunnelId}] Health check failed:`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
}

export const tunnelService = new TunnelService();
