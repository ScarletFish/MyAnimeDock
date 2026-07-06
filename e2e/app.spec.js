/**
 * E2E tests for the main application.
 * Run with: npm run test:e2e
 */

import { test, expect } from '@playwright/test';

test.describe('Application Load', () => {
  test('should load the main page', async ({ page }) => {
    await page.goto('/');

    // Check page title
    await expect(page).toHaveTitle(/MyAnimeDocker/);

    // Check main content is visible
    await expect(page.locator('#libraryView')).toBeVisible();
  });

  test('should have sidebar navigation', async ({ page }) => {
    await page.goto('/');

    // Check sidebar buttons exist
    await expect(page.locator('#btnDiscovery')).toBeVisible();
    await expect(page.locator('#btnMyList')).toBeVisible();
    await expect(page.locator('#btnSettings')).toBeVisible();
  });

  test('should show library view by default', async ({ page }) => {
    await page.goto('/');

    // Library view should be visible
    await expect(page.locator('#libraryView')).toBeVisible();

    // Other views should be hidden
    await expect(page.locator('#discoveryView')).toBeHidden();
    await expect(page.locator('#mylistView')).toBeHidden();
  });
});

test.describe('Navigation', () => {
  test('should switch to discovery view', async ({ page }) => {
    await page.goto('/');
    
    // Click discovery button
    await page.click('#btnDiscovery');
    
    // Discovery view should be visible
    await expect(page.locator('#discoveryView')).toBeVisible();
    
    // Library view should be hidden
    await expect(page.locator('#libraryView')).toBeHidden();
  });

  test('should switch to mylist view', async ({ page }) => {
    await page.goto('/');
    
    // Click mylist button
    await page.click('#btnMyList');
    
    // Mylist view should be visible
    await expect(page.locator('#mylistView')).toBeVisible();
    
    // Library view should be hidden
    await expect(page.locator('#libraryView')).toBeHidden();
  });

  test('should open settings modal', async ({ page }) => {
    await page.goto('/');
    
    // Click settings button
    await page.click('#btnSettings');
    
    // Settings modal should be visible
    await expect(page.locator('#settingsModal')).toBeVisible();
  });
});

test.describe('Library View', () => {
  test('should have dashboard container', async ({ page }) => {
    await page.goto('/');

    // Dashboard container should exist
    await expect(page.locator('#libraryDashboard')).toBeVisible();
  });
});

test.describe('Theme Switching', () => {
  test('should have theme dock', async ({ page }) => {
    await page.goto('/');

    // Theme dock should exist
    await expect(page.locator('#themeDock')).toBeVisible();
  });
});
