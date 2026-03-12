import { test, expect } from '../observability';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('Draft Undo and Discard Logic', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
    });

    test('should allow discarding all drafts', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Delete a row (select via checkbox — Phase 4: suppressRowClickSelection)
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
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

        // Select row via checkbox and delete (Phase 4: suppressRowClickSelection)
        const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' });
        await bobRow.waitFor({ state: 'visible', timeout: 5000 });
        await bobRow.locator('.ag-selection-checkbox').click();

        // Delete it via toolbar
        await page.locator('button', { hasText: '削除' }).click();

        // Verify Commit button appears
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Row remains selected after delete op — undo button should be visible
        const undoBtn = page.locator('button', { hasText: 'Undo' });
        await expect(undoBtn).toBeVisible();
        await undoBtn.click();

        // The commit button should vanish since the only op was undone
        await expect(commitBtn).not.toBeVisible();
    });
});
