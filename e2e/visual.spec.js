/**
 * Visual regression tests using Playwright screenshots.
 * Run with: npm run test:e2e -- e2e/visual.spec.js
 * 
 * To update snapshots:
 *   npm run test:e2e -- e2e/visual.spec.js --update-snapshots
 */

import { test, expect } from '@playwright/test';

test.describe('Visual Regression', () => {
  test('library view matches snapshot', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#libraryView');

    // Wait for any async rendering to complete
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('library-view.png', {
      maxDiffPixelRatio: 0.01
    });
  });

  test('settings modal matches snapshot', async ({ page }) => {
    await page.goto('/');
    await page.click('#btnSettings');

    // Wait for modal animation
    await page.waitForSelector('#settingsModal.show');
    await page.waitForTimeout(300);

    await expect(page.locator('#settingsModal')).toHaveScreenshot('settings-modal.png', {
      maxDiffPixelRatio: 0.01
    });
  });

  test('dark theme matches snapshot', async ({ page }) => {
    await page.goto('/');

    // Ensure dark theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme-mode', 'dark');
    });
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('dark-theme.png', {
      maxDiffPixelRatio: 0.01
    });
  });

  test('light theme matches snapshot', async ({ page }) => {
    await page.goto('/');

    // Switch to light theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme-mode', 'light');
    });
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('light-theme.png', {
      maxDiffPixelRatio: 0.01
    });
  });
});
