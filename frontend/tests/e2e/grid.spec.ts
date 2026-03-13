import { test, expect } from '../observability';
import { setupBaseMocks, selectContextInUI } from './setup';

function rowByExactCellText(page: import('@playwright/test').Page, value: string) {
    return page.locator('.ag-center-cols-container .ag-row').filter({
        has: page.locator('.ag-cell-value', { hasText: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
    });
}

async function applyColumnContainsFilter(
    page: import('@playwright/test').Page,
    columnId: string,
    value: string,
) {
    await page.locator(`.ag-header-cell[col-id="${columnId}"] .ag-header-cell-filter-button`).click();
    const filterInput = page.locator('.ag-menu input[aria-label="Filter Value"]').last();
    await filterInput.fill(value);
    await page.keyboard.press('Escape');
}

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

    test('should enable cell text selection only on protected branches', async ({ page }) => {
        await expect(page.locator('.ag-root-wrapper').first()).toBeVisible();
        await expect(page.locator('.ag-selectable')).toHaveCount(0);

        await selectContextInUI(page, 'local', 'test_db', 'main');

        await expect(page.locator('.ag-root-wrapper').first()).toBeVisible();
        await expect(page.locator('.ag-selectable')).not.toHaveCount(0);
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
        await modal.getByLabel('一括置換').check();
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
        await modal.getByLabel('一括置換').check();
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('Alice');

        await expect(modal).toContainText('プレビュー (0/1 件が変更されます)');
        await expect(modal.locator('button.primary', { hasText: '適用 (0 件)' })).toBeDisabled();

        await modal.locator('button', { hasText: 'キャンセル' }).click();
        await expect(page.locator('.action-commit')).toHaveCount(0);
    });

    test('should bulk find-replace only rows that actually match', async ({ page }) => {
        const rows = page.locator('.ag-center-cols-container .ag-row');
        const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' });
        const charlieRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Charlie' });
        await expect(rows).toHaveCount(3);
        await bobRow.locator('.ag-selection-checkbox').click();
        await charlieRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (2)' }).click();

        const modal = page.locator('.modal');
        await expect(modal.getByLabel('文字を置換')).toBeChecked();
        await modal.locator('select').first().selectOption('role');
        await modal.locator('input[type="text"][placeholder="置換対象の文字列"]').fill('user');
        await modal.locator('input[type="text"][placeholder="置換後の文字列"]').fill('member');

        await expect(modal).toContainText('プレビュー (2/2 件が変更されます)');
        await modal.locator('button.primary', { hasText: '適用 (2 件)' }).click();

        await expect(page.locator('.action-commit')).toHaveText('Commit (2)');
        await expect(page.locator('button', { hasText: '一括置換 (2)' })).toBeVisible();
        await expect(bobRow).toContainText('member');
        await expect(charlieRow).toContainText('member');
    });

    test('should disable copy when the selected base row already has draft changes', async ({ page }) => {
        const bobRow = rowByExactCellText(page, 'Bob');
        await bobRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (1)' }).click();
        const modal = page.locator('.modal');
        await modal.locator('select').first().selectOption('role');
        await modal.getByLabel('一括置換').check();
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('member');
        await modal.locator('button.primary', { hasText: '適用 (1 件)' }).click();

        const copyButton = page.locator('button', { hasText: 'コピー (1)' });
        await expect(copyButton).toBeDisabled();
    });

    test('should keep copied rows selected so bulk replace only updates the copied rows', async ({ page }) => {
        await page.route('**/api/v1/preview/clone', async route => {
            const body = JSON.parse(route.request().postData() ?? '{}');
            const id = Number(body.template_pk?.id);
            const clonedRows: Record<number, Record<string, unknown>> = {
                2: { id: 2, name: 'Bob (copy)', role: 'user' },
                3: { id: 3, name: 'Charlie (copy)', role: 'user' },
            };
            await route.fulfill({
                json: {
                    ops: [{
                        type: 'insert',
                        table: 'users',
                        values: clonedRows[id],
                    }],
                    errors: [],
                },
            });
        });

        const bobRow = rowByExactCellText(page, 'Bob');
        const charlieRow = rowByExactCellText(page, 'Charlie');
        await bobRow.locator('.ag-selection-checkbox').click();
        await charlieRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: 'コピー (2)' }).click();

        const bobCopyRow = rowByExactCellText(page, 'Bob (copy)');
        const charlieCopyRow = rowByExactCellText(page, 'Charlie (copy)');
        await expect(bobCopyRow).toBeVisible();
        await expect(charlieCopyRow).toBeVisible();
        await expect(page.locator('button', { hasText: 'コピー (2)' })).toBeDisabled();
        await expect(page.locator('button', { hasText: '一括置換 (2)' })).toBeVisible();

        await page.locator('button', { hasText: '一括置換 (2)' }).click();
        const modal = page.locator('.modal');
        await modal.locator('select').first().selectOption('role');
        await modal.getByLabel('一括置換').check();
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('member');
        await modal.locator('button.primary', { hasText: '適用 (2 件)' }).click();

        await expect(page.locator('.action-commit')).toHaveText('Commit (2)');
        await expect(bobCopyRow).toContainText('member');
        await expect(charlieCopyRow).toContainText('member');
        await expect(bobRow).toContainText('user');
        await expect(charlieRow).toContainText('user');
    });

    test('should backfill capped filtered actions after a draft edit removes a first-page match', async ({ page }) => {
        const largeRows = Array.from({ length: 1001 }, (_, index) => ({
            id: index + 1,
            name: `User ${index + 1}`,
            role: 'user',
        }));
        let previewPageTwoRequests = 0;

        await page.unroute('**/api/v1/table/rows*');
        await page.route('**/api/v1/table/rows*', async route => {
            const url = new URL(route.request().url());
            const pageNum = Number(url.searchParams.get('page') ?? '1');
            const pageSize = Number(url.searchParams.get('page_size') ?? '50');
            const filterJson = url.searchParams.get('filter') ?? '';

            if (pageNum === 2 && pageSize === 1000) {
                previewPageTwoRequests += 1;
            }

            let filteredRows = largeRows;
            if (filterJson !== '') {
                const conditions = JSON.parse(filterJson) as Array<{ column: string; op: string; value?: unknown }>;
                filteredRows = largeRows.filter((row) =>
                    conditions.every((condition) => {
                        if (condition.column !== 'role' || condition.op !== 'contains') {
                            return true;
                        }
                        return String(row.role).includes(String(condition.value ?? ''));
                    })
                );
            }

            const start = (pageNum - 1) * pageSize;
            await route.fulfill({
                json: {
                    rows: filteredRows.slice(start, start + pageSize),
                    total_count: filteredRows.length,
                    page: pageNum,
                    page_size: pageSize,
                },
            });
        });

        await page.reload();
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await applyColumnContainsFilter(page, 'role', 'user');
        const firstUserRow = rowByExactCellText(page, 'User 1');
        await firstUserRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '一括置換 (1)' }).click();
        const modal = page.locator('.modal');
        await modal.locator('select').first().selectOption('role');
        await modal.getByLabel('一括置換').check();
        await modal.locator('input[type="text"][placeholder="設定する値"]').fill('guest');
        await modal.locator('button.primary', { hasText: '適用 (1 件)' }).click();

        await expect.poll(() => previewPageTwoRequests, { timeout: 5000 }).toBeGreaterThan(0);
        const bulkAllButton = page.locator('button', { hasText: '全件一括置換 (1,000)' });
        await expect(bulkAllButton).toBeVisible({ timeout: 5000 });

        page.once('dialog', (dialog) => dialog.accept());
        await bulkAllButton.click();
        const allModal = page.locator('.modal');
        await allModal.locator('select').first().selectOption('name');
        await allModal.getByLabel('一括置換').check();
        await allModal.locator('input[type="text"][placeholder="設定する値"]').fill('Batch');
        await expect(allModal).toContainText('プレビュー (1000/1000 件が変更されます)');
    });

    test('should hide row cross-copy actions on work branches', async ({ page }) => {
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();

        await expect(page.locator('button', { hasText: '他DBへ' })).toHaveCount(0);
    });
});
