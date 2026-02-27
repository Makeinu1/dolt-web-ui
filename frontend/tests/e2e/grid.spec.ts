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

    test('should mark row as deleted (strikethrough) on toolbar Delete', async ({ page }) => {
        // Wait for grid
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Select Alice row via checkbox (Phase 4: row selection via checkbox only)
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();

        // Click "削除" from toolbar
        const deleteBtn = page.locator('button', { hasText: '削除' });
        await expect(deleteBtn).toBeVisible();
        await deleteBtn.click();

        // Check row style (line-through)
        const draftCell = aliceRow.locator('.ag-cell').first();
        await expect(draftCell).toHaveCSS('text-decoration-line', 'line-through');

        // Action button should now say Commit (1)
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');
    });
});
