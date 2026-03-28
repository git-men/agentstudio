/**
 * E2E: Desktop Launch Config + Engine Setup Wizard
 *
 * Tests the desktop startup flow by mocking Tauri IPC via window.__TAURI_INTERNALS__.
 * The mock is injected by intercepting the HTML response from the dev server,
 * ensuring it runs BEFORE any Vite module code.
 *
 * Requirements:
 * - Dev server running with VITE_TAURI=true: VITE_TAURI=true pnpm run dev --port 3002
 * - Run: PLAYWRIGHT_BASE_URL=http://localhost:3002 pnpm exec playwright test tests/e2e/desktop/ --project=desktop
 */
import { test, expect, type Page } from '@playwright/test';

interface MockIpcConfig {
  launchConfig?: { engine: string };
  domainAccessible?: boolean;
  cliInstalled?: Record<string, string | null>;
  startBackendShouldFail?: boolean;
}

function buildInlineScript(config: MockIpcConfig = {}): string {
  const {
    launchConfig = { engine: 'claude-sdk' },
    domainAccessible = true,
    cliInstalled = { claude: '/usr/local/bin/claude' },
    startBackendShouldFail = false,
  } = config;

  return `<script>
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  invoke: function(cmd, payload) {
    var args = payload || {};
    switch (cmd) {
      case 'load_launch_config':
        return Promise.resolve(${JSON.stringify(launchConfig)});
      case 'check_domain_accessible':
        return Promise.resolve(${domainAccessible});
      case 'check_cli_installed':
        var cliName = args.cliName;
        var map = ${JSON.stringify(cliInstalled)};
        return Promise.resolve(map[cliName] || null);
      case 'install_npm_package':
        return Promise.resolve('Installed successfully');
      case 'run_shell_command':
        return Promise.resolve('OK');
      case 'start_backend':
        if (${startBackendShouldFail}) {
          return Promise.reject(new Error('Backend start failed'));
        }
        return Promise.resolve(null);
      case 'get_backend_port':
        return Promise.resolve(4936);
      case 'close_splashscreen':
      case 'show_main_window':
      case 'send_notification':
        return Promise.resolve(null);
      case 'plugin:event|listen':
        return Promise.resolve(0);
      case 'plugin:event|unlisten':
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  },
  convertFileSrc: function(p) { return p; },
  transformCallback: function(cb, once) {
    var id = window.__TAURI_CB_ID__ || 0;
    window.__TAURI_CB_ID__ = id + 1;
    window['_' + id] = cb;
    return id;
  }
};
</script>`;
}

async function setupTauriRoute(page: Page, config: MockIpcConfig = {}) {
  const script = buildInlineScript(config);
  const baseUrl = 'http://localhost:3002';

  await page.route(`${baseUrl}/**`, async (route) => {
    const response = await route.fetch();
    const contentType = response.headers()['content-type'] || '';

    if (contentType.includes('text/html')) {
      let body = await response.text();
      body = body.replace('<head>', `<head>${script}`);
      await route.fulfill({ response, body });
    } else {
      await route.fulfill({ response });
    }
  });
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test.describe('Desktop Launch Config', () => {
  test('shows launch config screen with all engines when domain is accessible', async ({ page }) => {
    await setupTauriRoute(page, { domainAccessible: true });
    await page.goto('/');

    await expect(page.getByText('Execution Engine')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible();

    const engineLabels = ['Claude Agent SDK', 'Claude Internal', 'CodeBuddy', 'Codex CLI', 'Cursor CLI'];
    for (const label of engineLabels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('hides Claude Internal when domain is not accessible', async ({ page }) => {
    await setupTauriRoute(page, { domainAccessible: false });
    await page.goto('/');

    await expect(page.getByText('Execution Engine')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Claude Agent SDK', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Claude Internal', { exact: true })).not.toBeVisible({ timeout: 5000 });
  });

  test('loads saved engine selection', async ({ page }) => {
    await setupTauriRoute(page, {
      launchConfig: { engine: 'codex-cli' },
      cliInstalled: { codex: '/usr/local/bin/codex' },
    });
    await page.goto('/');

    await expect(page.getByText('Execution Engine')).toBeVisible({ timeout: 15000 });
    const codexOption = page.locator('button', { hasText: 'Codex CLI' });
    await expect(codexOption).toBeVisible();
  });
});

test.describe('Engine Setup Wizard', () => {
  test('shows wizard with ready state when CLI is installed', async ({ page }) => {
    await setupTauriRoute(page, {
      cliInstalled: { claude: '/usr/local/bin/claude' },
    });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Launch' }).click();

    await expect(page.getByText('Claude Agent SDK Setup')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('/usr/local/bin/claude')).toBeVisible();
    await expect(page.getByText('is ready')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  });

  test('shows not-installed state when CLI is missing', async ({ page }) => {
    await setupTauriRoute(page, { cliInstalled: {} });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Launch' }).click();

    await expect(page.getByText('Claude Agent SDK Setup')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('is not installed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install Now' })).toBeVisible();
  });

  test('Cancel button closes wizard and returns to launch config', async ({ page }) => {
    await setupTauriRoute(page, {
      cliInstalled: { claude: '/usr/local/bin/claude' },
    });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Launch' }).click();
    await expect(page.getByText('Claude Agent SDK Setup')).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Claude Agent SDK Setup')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible();
  });

  test('selecting Claude Internal engine shows its wizard', async ({ page }) => {
    await setupTauriRoute(page, {
      domainAccessible: true,
      cliInstalled: { 'claude-internal': '/usr/local/bin/claude-internal' },
    });
    await page.goto('/');

    await expect(page.getByText('Claude Internal', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByText('Claude Internal', { exact: true }).click();
    await page.getByRole('button', { name: 'Launch' }).click();

    await expect(page.getByText('Claude Internal Setup')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('/usr/local/bin/claude-internal')).toBeVisible();
  });

  test('Continue button proceeds past launch config', async ({ page }) => {
    await setupTauriRoute(page, {
      cliInstalled: { claude: '/usr/local/bin/claude' },
    });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Launch' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Launch' }).click();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Execution Engine')).not.toBeVisible({ timeout: 15000 });
  });
});
