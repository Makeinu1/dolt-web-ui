import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('Grid and Draft Editing Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');

        // UIを通してコンテキストをセットしてTableGridを読み込ませる
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');
    });

    test('should load table rows and display total count', async ({ page }) => {
        // Wait for the table data to be fetched and rendered
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Check row count in grid
        const rowElements = page.locator('.ag-center-cols-container .ag-row');
        await expect(rowElements).toHaveCount(3);
    });

    test('should mark row as deleted (strikethrough) on right click -> Delete Row', async ({ page }) => {
        // Wait for grid
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Click row to select
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        const cell = aliceRow.locator('.ag-cell').first();
        await cell.click();

        // Click "削除" from toolbar
        const deleteBtn = page.locator('button', { hasText: '削除' });
        await expect(deleteBtn).toBeVisible();
        await deleteBtn.click();

        // Check row style (color: #888, line-through)
        const draftRow = aliceRow.locator('.ag-cell').first();
        await expect(draftRow).toHaveCSS('text-decoration-line', 'line-through');

        // Action button should now say Commit (1)
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');
    });

    test('should open batch generate modal on Batch Clone', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Left click on "Bob" to select row
        const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' });
        await bobRow.waitFor({ state: 'visible', timeout: 5000 });
        await bobRow.locator('.ag-cell').first().click();

        // Click "一括" button
        const batchCloneBtn = page.locator('button', { hasText: '一括' });
        await expect(batchCloneBtn).toBeVisible();
        await batchCloneBtn.click();

        // Batch Generate Modal should appear
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('Batch Generate...');

        // Close modal
        await modal.locator('button', { hasText: 'Cancel' }).click();
    });
});
