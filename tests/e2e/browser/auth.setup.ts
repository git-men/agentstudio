import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const authFile = path.join(__dirname, 'playwright', '.auth', 'user.json');

fs.mkdirSync(path.dirname(authFile), { recursive: true });

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  const enterButton = page.getByRole('button', { name: /Enter System|进入系统/ });

  try {
    await enterButton.waitFor({ state: 'visible', timeout: 8_000 });
    await enterButton.click();
  } catch {
    // Auto-login already navigated away.
  }

  await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
    timeout: 15_000,
  });

  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    localStorage.setItem('agentstudio:meta-agent-open', '0');
  });

  await page.context().storageState({ path: authFile });
});
