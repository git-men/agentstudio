import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 30_000,

  reporter: process.env.CI ? 'json' : 'list',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:14936',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
