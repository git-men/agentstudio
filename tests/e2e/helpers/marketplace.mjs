/**
 * E2E Helper: Marketplace Lifecycle
 *
 * Provides utilities to register a local fixture marketplace, install plugins,
 * and teardown everything — without coupling tests to the business VAG marketplace.
 *
 * Usage pattern:
 *
 *   const mp = new MarketplaceFixture(backend, {
 *     name: 'e2e-test',
 *     fixturePath: FIXTURE_MARKETPLACE_PATH,
 *   });
 *   const hookIds = await mp.install('content-safety');
 *   // ... run tests ...
 *   await mp.uninstall('content-safety');
 *   await mp.remove();
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the self-contained E2E fixture marketplace */
export const FIXTURE_MARKETPLACE_PATH = resolve(__dirname, '../fixtures/marketplace');

export class MarketplaceFixture {
  /**
   * @param {object} backend  - BackendServer instance
   * @param {object} opts
   * @param {string} opts.name         - Marketplace name slug (e.g. 'e2e-test')
   * @param {string} [opts.fixturePath] - Absolute path to local marketplace directory.
   *                                     Defaults to the built-in fixture.
   */
  constructor(backend, { name = 'e2e-test', fixturePath = FIXTURE_MARKETPLACE_PATH } = {}) {
    this.backend     = backend;
    this.name        = name;
    this.fixturePath = fixturePath;
    this._registered = false;
    this._installedPlugins = new Set();
  }

  // ── Marketplace lifecycle ────────────────────────────────────────────────

  /**
   * Register the local fixture directory as a marketplace on the backend.
   * Idempotent if already registered.
   */
  async register() {
    if (this._registered) return;

    const { status, body } = await this.backend.post('/api/plugins/marketplaces', {
      name: this.name,
      type: 'local',
      source: this.fixturePath,
    });

    if (status !== 200 && status !== 201) {
      throw new Error(
        `Failed to register marketplace '${this.name}': HTTP ${status} — ${body?.error ?? JSON.stringify(body)}`
      );
    }

    this._registered = true;
    console.log(`    [marketplace] Registered '${this.name}' from ${this.fixturePath}`);
  }

  /**
   * Remove the marketplace from the backend.
   * Silently ignores 404 (already removed).
   */
  async remove() {
    const res = await fetch(`${this.backend.url}/api/plugins/marketplaces/${this.name}`, {
      method: 'DELETE',
    });
    if (res.status !== 200 && res.status !== 404) {
      const body = await res.json().catch(() => null);
      console.warn(`    [marketplace] Warning: remove returned HTTP ${res.status}: ${body?.error}`);
    }
    this._registered = false;
    console.log(`    [marketplace] Removed '${this.name}'`);
  }

  // ── Plugin lifecycle ─────────────────────────────────────────────────────

  /**
   * Install a plugin from this marketplace.
   * Returns the list of hook IDs that were auto-registered.
   *
   * @param {string} pluginName
   * @returns {Promise<string[]>} array of registered hook IDs
   */
  async install(pluginName) {
    if (!this._registered) await this.register();

    const { status, body } = await this.backend.post('/api/plugins/install', {
      pluginName,
      marketplaceName: this.name,
    });

    if (status !== 200 && status !== 201) {
      throw new Error(
        `Failed to install plugin '${pluginName}': HTTP ${status} — ${body?.error ?? JSON.stringify(body)}`
      );
    }

    this._installedPlugins.add(pluginName);
    const hookIds = (body?.plugin?.hooks ?? []).map(h => h.id);
    console.log(
      `    [marketplace] Installed '${pluginName}' — ${hookIds.length} hook(s) registered: ${hookIds.join(', ') || '(none)'}`
    );
    return hookIds;
  }

  /**
   * Uninstall a plugin.
   * Silently ignores 404.
   *
   * @param {string} pluginName
   */
  async uninstall(pluginName) {
    const res = await fetch(
      `${this.backend.url}/api/plugins/${this.name}/${pluginName}`,
      { method: 'DELETE' }
    );
    if (res.status !== 200 && res.status !== 404) {
      const body = await res.json().catch(() => null);
      console.warn(`    [marketplace] Warning: uninstall '${pluginName}' returned HTTP ${res.status}: ${body?.error}`);
    }
    this._installedPlugins.delete(pluginName);
    console.log(`    [marketplace] Uninstalled '${pluginName}'`);
  }

  /**
   * Full teardown: uninstall all tracked plugins then remove the marketplace.
   */
  async teardown() {
    for (const pluginName of [...this._installedPlugins]) {
      await this.uninstall(pluginName);
    }
    await this.remove();
  }
}
