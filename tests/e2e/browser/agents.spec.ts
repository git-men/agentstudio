import { test, expect } from '@playwright/test';

const TEST_AGENT_NAME = `E2E Test Agent ${Date.now()}`;
const EDITED_AGENT_NAME = `${TEST_AGENT_NAME} Edited`;

test.describe('Agent management', () => {
  test('agent list page loads with table', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await expect(
      page.getByRole('heading', { name: /Agent Management/i }),
    ).toBeVisible({ timeout: 10_000 });

    // Search input should be present.
    await expect(
      page.getByPlaceholder(/Search assistants|搜索/i),
    ).toBeVisible();

    // Create button should be present.
    await expect(
      page.getByRole('button', { name: /Create Assistant|创建助手/i }),
    ).toBeVisible();

    // There should be at least one agent (built-in claude-code).
    const agentRows = page.locator('table tbody tr, [class*="rounded-lg"][class*="border"][class*="p-4"]');
    await expect(agentRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('create a new agent', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /Create Assistant|创建助手/i }).click();

    // Wait for the dialog to appear — title is hardcoded "创建助手".
    const dialogTitle = page.getByRole('heading', { name: '创建助手' });
    await expect(dialogTitle).toBeVisible({ timeout: 5_000 });

    const dialog = page.locator('.fixed.inset-0').first();

    // ID field: <label>ID</label> followed by <input> inside a wrapper div.
    const idInput = dialog.locator('label').filter({ hasText: /^ID$/ }).locator('..').locator('input').first();
    await idInput.clear();
    await idInput.fill(`e2e-agent-${Date.now()}`);

    // Name field: <label>名称</label> followed by <input>.
    const nameInput = dialog.locator('label').filter({ hasText: '名称' }).locator('..').locator('input').first();
    await nameInput.clear();
    await nameInput.fill(TEST_AGENT_NAME);

    // Description field: <label>描述</label> followed by <textarea>.
    const descInput = dialog.locator('label').filter({ hasText: '描述' }).locator('..').locator('textarea').first();
    await descInput.clear();
    await descInput.fill('Agent created by E2E test suite');

    // Click Save — button with icon + text "保存" in the dialog header.
    await dialog.getByRole('button', { name: /保存|Save/i }).click();

    // Dialog should close.
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify the new agent appears in the list.
    await expect(page.getByText(TEST_AGENT_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('edit an existing agent', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    // Find the row/card for the agent we just created.
    const agentRow = page.locator('tr, [class*="rounded-lg"][class*="border"][class*="p-4"]', {
      hasText: TEST_AGENT_NAME,
    }).first();
    await expect(agentRow).toBeVisible({ timeout: 10_000 });

    // Click the edit button (title="编辑助手").
    const editButton = agentRow.locator('button[title="编辑助手"], button[title="查看配置"]').first();
    await editButton.click();

    // Wait for edit dialog.
    const dialog = page.locator('.fixed.inset-0').first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Change the name.
    const nameInput = dialog.locator('label').filter({ hasText: '名称' }).locator('..').locator('input').first();
    await nameInput.clear();
    await nameInput.fill(EDITED_AGENT_NAME);

    await dialog.getByRole('button', { name: /保存|Save/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify updated name appears.
    await expect(page.getByText(EDITED_AGENT_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('delete an agent', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    const agentRow = page.locator('tr, [class*="rounded-lg"][class*="border"][class*="p-4"]', {
      hasText: EDITED_AGENT_NAME,
    }).first();

    if (!(await agentRow.isVisible())) {
      test.skip();
      return;
    }

    // Click delete button (title="删除助手").
    const deleteButton = agentRow.locator('button[title="删除助手"]').first();
    await deleteButton.click();

    // Confirm deletion dialog.
    const confirmButton = page.getByRole('button', { name: /删除|Delete|Confirm|确认/i }).last();
    await expect(confirmButton).toBeVisible({ timeout: 5_000 });
    await confirmButton.click();

    // Wait for the agent to disappear from the list.
    await expect(page.getByText(EDITED_AGENT_NAME)).toBeHidden({ timeout: 10_000 });
  });

  test('search filters agent list', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder(/Search assistants|搜索/i);

    // Search for nonexistent agent — should show empty/no-results state.
    await searchInput.fill('nonexistent-agent-xyz-12345');
    await page.waitForTimeout(500);

    const noResults = page.getByText(/No matching assistants|没有找到/i);
    await expect(noResults).toBeVisible({ timeout: 5_000 });

    // Clear search — agents should reappear.
    await searchInput.clear();
    await page.waitForTimeout(500);

    await expect(noResults).toBeHidden({ timeout: 5_000 });
  });
});
