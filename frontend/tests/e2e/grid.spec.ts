import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('Grid and Draft Editing Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');

        // UIを通してコンテキストをセットしてTableGridを読み込ませる
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
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

    test('should apply bulk set only to blank cells when emptyOnly is enabled', async ({ page }) => {
        await page.unroute('**/api/v1/table/rows*');
        await page.route('**/api/v1/table/rows*', async route => {
            await route.fulfill({
                json: {
                    rows: [
                        { id: 1, name: '', role: 'admin' },
                        { id: 2, name: 'Bob', role: 'user' },
                    ],
                    total_count: 2,
                },
            });
        });

        await page.reload();
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        const rows = page.locator('.ag-center-cols-container .ag-row');
        await expect(rows).toHaveCount(2);
        await rows.nth(0).locator('.ag-selection-checkbox').click();
        await rows.nth(1).locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (2)' }).click();

        const modal = page.locator('.modal');
        await expect(modal.locator('h2')).toHaveText('一括置換');
        await modal.locator('select').first().selectOption('name');
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('filled');
        await modal.getByLabel('空欄だけに適用').check();

        await expect(modal).toContainText('プレビュー (1/2 件が変更されます)');
        await expect(modal).toContainText('スキップ（空欄以外）');

        await modal.locator('button.primary', { hasText: '適用 (1 件)' }).click();
        await expect(page.locator('.action-commit')).toHaveText('Commit (1)');
    });

    test('should not create a draft when bulk set keeps the same value', async ({ page }) => {
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (1)' }).click();

        const modal = page.locator('.modal');
        await modal.locator('select').first().selectOption('name');
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('Alice');

        await expect(modal).toContainText('プレビュー (0/1 件が変更されます)');
        await expect(modal.locator('button.primary', { hasText: '適用 (0 件)' })).toBeDisabled();

        await modal.locator('button', { hasText: 'キャンセル' }).click();
        await expect(page.locator('.action-commit')).toHaveCount(0);
    });

    test('should bulk find-replace only rows that actually match', async ({ page }) => {
        const rows = page.locator('.ag-center-cols-container .ag-row');
        await expect(rows).toHaveCount(3);
        await rows.nth(0).locator('.ag-selection-checkbox').click();
        await rows.nth(1).locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (2)' }).click();

        const modal = page.locator('.modal');
        await modal.locator('select').first().selectOption('role');
        await modal.getByLabel('文字を置換').check();
        await modal.locator('input[type="text"][placeholder="置換対象の文字列"]').fill('user');
        await modal.locator('input[type="text"][placeholder="置換後の文字列"]').fill('member');

        await expect(modal).toContainText('プレビュー (1/2 件が変更されます)');
        await modal.locator('button.primary', { hasText: '適用 (1 件)' }).click();

        await expect(page.locator('.action-commit')).toHaveText('Commit (1)');
        await expect(page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' })).toContainText('member');
    });

    test('should hide row cross-copy actions on work branches', async ({ page }) => {
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();

        await expect(page.locator('button', { hasText: '他DBへ' })).toHaveCount(0);
    });
});
