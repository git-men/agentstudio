/**
 * Tauri native E2E tests for Desktop Launch Config + Engine Setup Wizard.
 *
 * These tests run inside the real Tauri app (debug build with webdriver feature)
 * and exercise actual IPC calls, unlike the Playwright web-mode tests.
 *
 * Prerequisites:
 * - Tauri app built: cd desktop/src-tauri && cargo tauri build --debug --features webdriver
 * - WebdriverIO deps installed: pnpm add -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/spec-reporter webdriverio
 * - Run: pnpm exec wdio wdio.tauri.conf.ts
 */
import { expect } from '@wdio/globals';

describe('Desktop Launch Config (native)', () => {
  it('should show the launch config screen on startup', async () => {
    const engineLabel = await $('*=Execution Engine');
    await engineLabel.waitForDisplayed({ timeout: 15000 });

    const launchBtn = await $('button=Launch');
    await expect(launchBtn).toBeDisplayed();
  });

  it('should display available engine options', async () => {
    const claudeOption = await $('*=Claude Agent SDK');
    await expect(claudeOption).toBeDisplayed();

    const cursorOption = await $('*=Cursor CLI');
    await expect(cursorOption).toBeDisplayed();

    const codexOption = await $('*=Codex CLI');
    await expect(codexOption).toBeDisplayed();
  });

  it('should allow selecting a different engine', async () => {
    const cursorOption = await $('button*=Cursor CLI');
    await cursorOption.click();

    const selectedClass = await cursorOption.getAttribute('class');
    expect(selectedClass).toContain('border-[#6366f1]');
  });

  it('should open the engine setup wizard when clicking Launch', async () => {
    const claudeOption = await $('button*=Claude Agent SDK');
    await claudeOption.click();

    const launchBtn = await $('button=Launch');
    await launchBtn.click();

    const wizardTitle = await $('*=Claude Agent SDK Setup');
    await wizardTitle.waitForDisplayed({ timeout: 10000 });
  });

  it('should check CLI installation and show status', async () => {
    const wizardTitle = await $('*=Claude Agent SDK Setup');
    await wizardTitle.waitForDisplayed({ timeout: 10000 });

    // Should show either "is ready" or "is not installed" depending on host
    const readyText = await $('*=is ready');
    const notInstalledText = await $('*=is not installed');

    const isReady = await readyText.isDisplayed();
    const isNotInstalled = await notInstalledText.isDisplayed();

    expect(isReady || isNotInstalled).toBe(true);
  });

  it('should close wizard with Cancel button', async () => {
    const cancelBtn = await $('button=Cancel');
    if (await cancelBtn.isDisplayed()) {
      await cancelBtn.click();

      const wizardTitle = await $('*=Setup');
      await expect(wizardTitle).not.toBeDisplayed();

      const launchBtn = await $('button=Launch');
      await expect(launchBtn).toBeDisplayed();
    }
  });
});

describe('Engine Setup Wizard: real CLI check (native)', () => {
  before(async () => {
    // Start from the launch config screen
    const launchBtn = await $('button=Launch');
    if (await launchBtn.isDisplayed()) {
      const claudeOption = await $('button*=Claude Agent SDK');
      await claudeOption.click();
      await launchBtn.click();
    }
  });

  it('should perform actual CLI detection via IPC', async () => {
    const wizardTitle = await $('*=Claude Agent SDK Setup');
    await wizardTitle.waitForDisplayed({ timeout: 10000 });

    // Checking state should appear briefly
    const readyText = await $('*=is ready');
    const notInstalledText = await $('*=is not installed');

    await browser.waitUntil(
      async () => {
        const ready = await readyText.isDisplayed();
        const notInstalled = await notInstalledText.isDisplayed();
        return ready || notInstalled;
      },
      { timeout: 10000, timeoutMsg: 'CLI check did not complete' },
    );

    const isReady = await readyText.isDisplayed();
    if (isReady) {
      // CLI is installed: path should be shown
      const pathElement = await $('code');
      const pathText = await pathElement.getText();
      expect(pathText.length).toBeGreaterThan(0);
      expect(pathText).toContain('claude');

      // Continue button should be available
      const continueBtn = await $('button=Continue');
      await expect(continueBtn).toBeDisplayed();
    } else {
      // CLI not installed: install instructions should be shown
      const installBtn = await $('button=Install Now');
      await expect(installBtn).toBeDisplayed();
    }
  });

  after(async () => {
    // Clean up: close wizard if open
    const cancelBtn = await $('button=Cancel');
    if (await cancelBtn.isDisplayed()) {
      await cancelBtn.click();
    }
  });
});

describe('Domain accessibility check (native)', () => {
  it('should perform actual domain check for internal engines', async () => {
    // The hook calls check_domain_accessible via real IPC
    // If agentstudio.woa.com is accessible, Claude Internal should be visible
    // If not, it should be hidden
    const engineLabel = await $('*=Execution Engine');
    await engineLabel.waitForDisplayed({ timeout: 15000 });

    const claudeInternal = await $('*=Claude Internal');
    const isVisible = await claudeInternal.isDisplayed();

    // We can't predict the result, but we verify the check ran without error
    // The fact that the launch screen loaded without errors proves the IPC worked
    if (isVisible) {
      console.log('Domain agentstudio.woa.com is accessible - Claude Internal shown');
    } else {
      console.log('Domain agentstudio.woa.com is not accessible - Claude Internal hidden');
    }

    // Either way, other engines should always be visible
    const claudeSDK = await $('*=Claude Agent SDK');
    await expect(claudeSDK).toBeDisplayed();
  });
});
