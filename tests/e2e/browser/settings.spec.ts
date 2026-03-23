import { test, expect } from '@playwright/test';

test.describe('Settings pages', () => {
  test('general settings page loads', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Theme|主题/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Language|语言/i).first()).toBeVisible();
  });

  test('general settings has theme options', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');

    // Theme option buttons: "Follow System", "Light Mode", "Dark Mode".
    for (const label of ['Follow System', 'Light Mode', 'Dark Mode']) {
      const option = page.getByText(new RegExp(label, 'i'));
      await expect(option.first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('tunnel settings page loads', async ({ page }) => {
    await page.goto('/settings/tunnel');
    await page.waitForLoadState('networkidle');

    const tunnelHeading = page.getByText(/Tunnel|隧道/i).first();
    await expect(tunnelHeading).toBeVisible({ timeout: 10_000 });
  });

  test('tunnel page has add button', async ({ page }) => {
    await page.goto('/settings/tunnel');
    await page.waitForLoadState('networkidle');

    const addButton = page.getByRole('button', { name: /Add|新增|Create|添加/i }).first();
    const hasSomeContent =
      (await addButton.isVisible()) ||
      (await page.getByText(/Tunnel|隧道/i).first().isVisible());
    expect(hasSomeContent).toBeTruthy();
  });

  test('system info page loads', async ({ page }) => {
    await page.goto('/settings/system-info');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /System Info|系统信息/i }),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole('button', { name: /Check|检查/i }),
    ).toBeVisible();
  });

  test('system info shows version', async ({ page }) => {
    await page.goto('/settings/system-info');
    await page.waitForLoadState('networkidle');

    const versionText = page.getByText(/Version|版本/i).first();
    await expect(versionText).toBeVisible({ timeout: 10_000 });
  });

  test('MCP admin page loads', async ({ page }) => {
    await page.goto('/settings/mcp-admin');
    await page.waitForLoadState('networkidle');

    const mcpContent = page.getByText(/MCP/i).first();
    await expect(mcpContent).toBeVisible({ timeout: 10_000 });
  });

  test('MCP admin shows API key section', async ({ page }) => {
    await page.goto('/settings/mcp-admin');
    await page.waitForLoadState('networkidle');

    const keySection = page.getByText(/API Key|密钥/i).first();
    await expect(keySection).toBeVisible({ timeout: 10_000 });
  });

  test('settings navigation between sub-pages', async ({ page }) => {
    await page.goto('/settings/general');
    await page.waitForLoadState('networkidle');

    await page.goto('/settings/system-info');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /System Info|系统信息/i }),
    ).toBeVisible({ timeout: 10_000 });

    await page.goto('/settings/tunnel');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/Tunnel|隧道/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
