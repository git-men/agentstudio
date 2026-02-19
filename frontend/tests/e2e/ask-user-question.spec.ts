/**
 * E2E: Ask User Question tool
 * Run: pnpm exec playwright test tests/e2e/ask-user-question.spec.ts --project=chromium
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001';
const API_BASE = 'http://127.0.0.1:4936';
const CHAT_URL = `${BASE_URL}/chat/claude-code?project=${encodeURIComponent('/Users/kong/projects/agent-studio')}`;

test('Ask User Question tool appears and submit works', async ({ page, request }) => {
    // Log in via API and inject token so chat page loads
    const loginRes = await request.post(`${API_BASE}/api/auth/login`, { data: {} });
    const body = await loginRes.json().catch(() => ({}));
    const token = body.token;
    if (!token) {
      throw new Error('Login failed: no token. Backend may require password.');
    }

    const serviceId = 'default';
    const serviceUrl = API_BASE;
    const tokenData = { token, serviceId, serviceName: 'Default', serviceUrl, timestamp: Date.now() };
    await page.addInitScript(
      (data: { token: string; serviceId: string; serviceUrl: string; tokenData: object }) => {
        localStorage.setItem(
          'backendServices',
          JSON.stringify({
            services: [{ id: data.serviceId, name: 'Default', url: data.serviceUrl, isDefault: true }],
            currentServiceId: data.serviceId,
          })
        );
        localStorage.setItem(
          'auth-storage',
          JSON.stringify({
            state: {
              token: data.tokenData,
              tokens: { [data.serviceId]: data.tokenData },
              isAuthenticated: true,
            },
            version: 1,
          })
        );
      },
      { token, serviceId, serviceUrl, tokenData }
    );

    // Go to chat with project (init script will run before app loads)
    await page.goto(CHAT_URL, { waitUntil: 'networkidle' });
    await page.waitForURL(/\/chat\//, { timeout: 15000 });

    // Wait for chat UI (session/project init can take time)
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 60000 }).catch(async () => {
      await page.screenshot({ path: 'test-results/chat-page-failed.png' });
      throw new Error('Chat textarea did not appear. See test-results/chat-page-failed.png');
    });
    await textarea.fill('Please ask me one question with 2 or 3 multiple choice options, then wait for my answer.');
    await textarea.press('Enter');

    // Wait for Send button and click if message was not sent by Enter
    const sendBtn = page.getByRole('button', { name: /Send|发送/ });
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
    }

    // Wait for Ask User Question tool UI: "Submit Answer" button (tool is interactive)
    const submitAnswerBtn = page.getByRole('button', { name: /Submit Answer|提交/ });
    await expect(submitAnswerBtn).toBeVisible({ timeout: 90000 });

    // Must select an answer before submit: click "Type something..." then fill custom input
    const typeSomething = page.getByText(/Type something\.\.\.|输入自定义/);
    if (await typeSomething.isVisible().catch(() => false)) {
      await typeSomething.click();
      const customInput = page.locator('input[type="text"]').filter({ has: page.locator('..') }).first();
      await expect(customInput).toBeVisible({ timeout: 5000 });
      await customInput.fill('E2E test answer');
    } else {
      // Fallback: click first option div (option labels come from LLM, e.g. "Yes" / "No")
      const firstOption = page.locator('div.cursor-pointer').filter({ has: page.locator('.text-sm.font-medium') }).first();
      await firstOption.click();
    }

    // Submit the answer
    await submitAnswerBtn.click();

    // Wait for completed state
    await expect(
      page.locator('text=/Response submitted|已提交|completed/')
    ).toBeVisible({ timeout: 15000 });
});
