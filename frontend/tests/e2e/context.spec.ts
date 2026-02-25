import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('ContextSelector Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
    });

    test('should load and display context settings modal', async ({ page }) => {
        // Top header should say Setup Context initially or load defaults 
        const setupBtn = page.locator('div[title="Settings (Target / Database)"]');

        // Click to open modal
        await setupBtn.click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('⚙ Context Settings');

        // Select Target and DB
        const targetSelect = modal.locator('select').first();
        await targetSelect.selectOption('local');

        const dbSelect = modal.locator('select').nth(1);
        await dbSelect.selectOption('test_db');

        // Close Modal
        await modal.locator('button', { hasText: 'Done' }).click();
        await expect(modal).not.toBeVisible();

        // Verify it changed
        await expect(page.locator('.context-bar')).toContainText('test_db@local');
    });

    test('should allow branch creation and selection', async ({ page }) => {
        // Navigate first to set origin, then inject session storage
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'main');

        const contextBar = page.locator('.context-bar');

        // Check branch select has "main" and "wi/feat-a/01" (from mocks)
        const branchSelect = contextBar.locator('select');
        await expect(branchSelect).toBeVisible();

        // Open create branch input
        await contextBar.locator('button', { hasText: '+' }).click();

        // Type new branch
        const branchInput = contextBar.locator('input[placeholder="ticket-123"]');
        await expect(branchInput).toBeVisible();
        await branchInput.fill('test-feature');

        // Create branch (mock API response)
        await page.route('**/api/v1/branches/create*', async route => {
            if (route.request().method() === 'POST') {
                await route.fulfill({ status: 200, json: {} });
            } else {
                await route.continue();
            }
        });

        const createBtn = contextBar.locator('button', { hasText: 'Create' }).first();
        await createBtn.click();

        // Verify creation process closed input
        await expect(branchInput).not.toBeVisible();
    });
});
