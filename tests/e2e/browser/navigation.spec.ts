import { test, expect } from '@playwright/test';

// All tests in this file run with the persisted auth state (logged-in user).

test.describe('Dashboard and sidebar navigation', () => {
  test('dashboard page loads', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Sidebar branding
    await expect(page.getByText('Agent Studio')).toBeVisible();

    // Dashboard-specific content: project list, agent cards, or the quick-chat input.
    // The ClassicDashboard renders a project selector and session list.
    const dashboardContent = page.locator('.p-8, .p-6, [class*="dashboard"]').first();
    await expect(dashboardContent).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to /agents via sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // The sidebar uses NavLink components. Click the Agents nav item.
    const agentsLink = page.locator('nav a[href="/agents"]');
    await agentsLink.click();
    await page.waitForURL('**/agents');

    // Verify the agents page loaded — should show "Agent Management" heading.
    await expect(
      page.getByRole('heading', { name: /Agent Management|Agent 管理/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to /projects via sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const projectsLink = page.locator('nav a[href="/projects"]');
    await projectsLink.click();
    await page.waitForURL('**/projects');

    // The projects page has a search input and a create button.
    await expect(page.getByRole('heading', { name: /Project|项目/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('navigate to /mcp via sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const mcpLink = page.locator('nav a[href="/mcp"]');
    // MCP might be hidden depending on product edition; skip gracefully.
    if (!(await mcpLink.isVisible())) {
      test.skip();
      return;
    }

    await mcpLink.click();
    await page.waitForURL('**/mcp');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to /rules via sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Rules is under the Extensions submenu.
    // First expand the Extensions group if collapsed.
    const extensionsGroup = page.locator('nav button', {
      hasText: /Extensions|扩展/i,
    });
    if (await extensionsGroup.isVisible()) {
      await extensionsGroup.click();
    }

    const rulesLink = page.locator('nav a[href="/rules"]');
    if (!(await rulesLink.isVisible())) {
      test.skip();
      return;
    }

    await rulesLink.click();
    await page.waitForURL('**/rules');
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to /settings/general via sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Settings is a submenu group. Expand it first.
    const settingsGroup = page.locator('nav button', {
      hasText: /Settings|设置/i,
    });
    if (await settingsGroup.isVisible()) {
      await settingsGroup.click();
    }

    const generalLink = page.locator('nav a[href="/settings/general"]');
    if (!(await generalLink.isVisible())) {
      test.skip();
      return;
    }

    await generalLink.click();
    await page.waitForURL('**/settings/general');
    await page.waitForLoadState('networkidle');

    // General settings should show theme or language selector.
    await expect(page.getByText(/Theme|主题|Language|语言/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('sidebar highlights active link', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    const agentsLink = page.locator('nav a[href="/agents"]');
    // Active links get a blue background class.
    await expect(agentsLink).toHaveClass(/bg-blue-50|bg-blue-100|text-blue-700/);
  });
});
