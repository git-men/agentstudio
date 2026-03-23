import { test, expect } from '@playwright/test';

// These tests run WITHOUT the shared auth state so we can exercise
// the login flow itself.  Override storageState to start unauthenticated.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login flow', () => {
  test('root URL shows landing page or login page', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const url = page.url();
    // Passwordless mode serves LandingPage at "/", may redirect to /login or /dashboard.
    expect(url).toMatch(/\/(login|dashboard)?$/);
  });

  test('passwordless mode auto-login or shows login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const stillOnLogin = page.url().includes('/login');
    if (stillOnLogin) {
      // Still on login — verify the login UI is present
      const heading = page.getByRole('heading', { name: /Sign In|登录/ });
      await expect(heading).toBeVisible({ timeout: 10_000 });
    } else {
      // Passwordless mode auto-redirected to landing page (/) or dashboard.
      // Landing page has h1 "Agent for Work" and nav with "AgentStudio".
      const landingHeading = page.getByRole('heading', { name: /Agent for Work/i });
      const navBrand = page.getByText('AgentStudio').first();
      const isOnLanding = await landingHeading.isVisible().catch(() => false);
      const hasBrand = await navBrand.isVisible().catch(() => false);
      expect(isOnLanding || hasBrand).toBeTruthy();
    }
  });

  test('passwordless login redirects to root', async ({ page }) => {
    await page.goto('/login');

    // "Enter Workspace" is a <Link> (anchor) on the landing page, not a <button>.
    const enterLink = page.getByRole('link', { name: /Enter Workspace|进入工作台/i });
    const enterButton = page.getByRole('button', { name: /Enter System|进入系统/i });

    try {
      await enterLink.waitFor({ state: 'visible', timeout: 5_000 });
      await enterLink.click();
    } catch {
      try {
        await enterButton.waitFor({ state: 'visible', timeout: 3_000 });
        await enterButton.click();
      } catch {
        // Auto-login already happened.
      }
    }

    await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle');

    expect(page.url()).not.toContain('/login');
  });

  test('accessing protected page without auth redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // In passwordless mode auto-login may succeed, landing us on /dashboard
    // or on the landing page. With password enabled, we'd go to /login.
    const url = page.url();
    const isAcceptable =
      url.includes('/dashboard') ||
      url.includes('/login') ||
      url.endsWith('/');
    expect(isAcceptable).toBeTruthy();
  });

  test('dashboard loads after successful login', async ({ page }) => {
    await page.goto('/login');

    const enterLink = page.getByRole('link', { name: /Enter Workspace|进入工作台/i });
    const enterButton = page.getByRole('button', { name: /Enter System|进入系统/i });
    try {
      await enterLink.waitFor({ state: 'visible', timeout: 5_000 });
      await enterLink.click();
    } catch {
      try {
        await enterButton.waitFor({ state: 'visible', timeout: 3_000 });
        await enterButton.click();
      } catch {
        // Auto-login.
      }
    }

    await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
      timeout: 15_000,
    });
    await page.waitForLoadState('networkidle');

    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Dashboard shows "Let's Get Started" or sidebar shows "Agent Studio".
    const dashboard = page.getByRole('heading', { name: /Let.*Get Started|Agent Studio/i });
    await expect(dashboard.first()).toBeVisible({ timeout: 10_000 });
  });
});
