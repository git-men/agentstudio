import { test, expect } from '@playwright/test';

test.describe('Project management', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('agentstudio:meta-agent-open', '0');
    });
  });

  test('projects page loads', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    // Page heading: "Project Management".
    await expect(
      page.getByRole('heading', { name: /Project Management|项目管理/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Search input with placeholder "Search projects...".
    await expect(page.getByPlaceholder(/Search projects|搜索项目/i)).toBeVisible();
  });

  test('create project button is present', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    // The "Create New Project" or "导入项目" buttons should be visible.
    const createBtn = page.getByRole('button', { name: /Create New Project|Create|创建/i });
    await expect(createBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test('create project modal opens', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /Create New Project|创建.*项目/i }).first();
    if (!(await createBtn.isVisible())) {
      const altCreateBtn = page.getByRole('button', { name: /Create|创建/i }).first();
      await altCreateBtn.click();
    } else {
      await createBtn.click();
    }

    // A modal should appear with form fields.
    const modal = page.locator('.fixed.inset-0, [role="dialog"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await expect(modal.locator('input').first()).toBeVisible();

    // Close the modal without creating.
    const cancelBtn = modal.getByRole('button', { name: /Cancel|取消|Close|关闭/i });
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('project list API responds', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      // Zustand persist stores auth under 'auth-storage'
      const raw = localStorage.getItem('auth-storage') || '{}';
      const store = JSON.parse(raw);
      const tokenObj = store?.state?.token;
      const jwt = typeof tokenObj === 'string' ? tokenObj : tokenObj?.token || '';
      const res = await fetch('/api/projects', {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      return { status: res.status, ok: res.ok };
    });
    expect(result.ok).toBeTruthy();
  });

  test('project table or empty state renders', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('networkidle');

    // Either a table with project data or the heading is visible.
    const heading = page.getByRole('heading', { name: /Project Management|项目管理/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // The page should have either a table or an empty-state section.
    const projectTable = page.locator('table');
    const hasTable = await projectTable.isVisible();

    if (!hasTable) {
      // No table means empty state — create button should still be present.
      const createBtn = page.getByRole('button', { name: /Create New Project|创建/i });
      await expect(createBtn).toBeVisible({ timeout: 5_000 });
    } else {
      // Table is visible — should have column headers.
      const headerCell = page.locator('th').first();
      await expect(headerCell).toBeVisible();
    }
  });
});
