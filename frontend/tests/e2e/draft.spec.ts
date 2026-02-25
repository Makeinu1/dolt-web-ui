import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('Draft Undo and Discard Logic', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');
    });

    test('should allow discarding all drafts', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Delete a row
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-cell').first().click();
        await page.locator('button', { hasText: '削除' }).click();

        // Verify Commit button appears
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Automatically accept the window.confirm dialog
        page.on('dialog', dialog => dialog.accept());

        // Click Discard Draft
        const discardBtn = page.locator('button', { hasText: '変更をクリア' });
        await expect(discardBtn).toBeVisible();
        await discardBtn.click();

        // Commit button should disappear, indicating draft is cleared
        await expect(commitBtn).not.toBeVisible();
        await expect(discardBtn).not.toBeVisible();
    });

    test('should allow undoing a row action', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Edit a row (we mock cell edit by double clicking)
        const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' });
        await bobRow.waitFor({ state: 'visible', timeout: 5000 });
        const nameCell = bobRow.locator('.ag-cell[col-id="name"]');
        await nameCell.click();

        // Let's delete it instead as that's easier to verify via toolbar
        await page.locator('button', { hasText: '削除' }).click();

        // Verify Commit button appears
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Now select the row again and click "元に戻す(Undo)"
        await bobRow.locator('.ag-cell').first().click();
        const undoBtn = page.locator('button', { hasText: '元に戻す' });
        await expect(undoBtn).toBeVisible();
        await undoBtn.click();

        // The commit button should vanish since the only op was undone
        await expect(commitBtn).not.toBeVisible();
    });
});
