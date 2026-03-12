import { test, expect } from '../observability';
import { setupBaseMocks, selectContextInUI, MOCK_SCHEMA_USERS } from './setup';

test.describe('エラーバナー・ドラフト制御テスト', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
    });

    test('行読み込み失敗 → グリッドエラー表示 → 閉じるで消去', async ({ page, observability }) => {
        observability.allowApiFailures('/api/v1/table/rows');
        // Override rows mock with a 500 error
        let callCount = 0;
        await page.route('**/api/v1/table/rows*', async route => {
            callCount++;
            if (callCount === 1) {
                await route.fulfill({
                    status: 500,
                    json: { error: { code: 'INTERNAL', message: 'DBに接続できません' } },
                });
            } else {
                await route.fulfill({ json: { rows: [], total_count: 0 } });
            }
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Inline grid error banner should appear (TableGrid shows gridError, not global error-banner)
        const gridError = page.getByText(/DBに接続できません|失敗|エラー/).first();
        await expect(gridError).toBeVisible({ timeout: 8000 });

        // Dismiss button (✕) inside the grid error area
        const dismissBtn = page.locator('button').filter({ hasText: '✕' }).first();
        await expect(dismissBtn).toBeVisible();
        await dismissBtn.click();
        await expect(gridError).not.toBeVisible({ timeout: 3000 });
    });

    test('ドラフトあり → 承認申請ボタンが無効化', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Create a draft by deleting a row
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        // Verify draft exists
        await expect(page.locator('.action-commit')).toBeVisible({ timeout: 3000 });

        // Open overflow menu — 承認を申請 should be disabled
        await page.locator('.overflow-btn').click();
        const submitBtn = page.locator('.overflow-item', { hasText: '承認を申請' });
        await expect(submitBtn).toBeVisible();
        await expect(submitBtn).toBeDisabled();
    });

    test('ドラフトあり → CSVインポートが無効化', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Wait for grid to load and create a draft (行削除)
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();
        await expect(page.locator('.action-commit')).toBeVisible({ timeout: 3000 });

        // Open overflow menu — CSVインポート should be disabled (requires selectedTable + hasDraft)
        await page.locator('.overflow-btn').click();
        const csvItem = page.locator('.overflow-item', { hasText: 'CSVインポート' });
        // CSV Import is only shown when a table is selected AND branch is not protected
        // Since users is auto-selected, the item should appear as disabled
        await expect(csvItem).toBeDisabled({ timeout: 5000 });
    });

    test('Commit STALE_HEAD → エラーバナー表示', async ({ page }) => {
        await page.route('**/api/v1/commit', async route => {
            await route.fulfill({
                status: 409,
                json: { error: { code: 'STALE_HEAD', message: 'HEAD が古くなっています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Create a draft by deleting a row
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        // Click Commit button
        const commitBtn = page.locator('.action-commit');
        await commitBtn.waitFor({ state: 'visible', timeout: 3000 });
        await commitBtn.click();

        // CommitDialog appears → click primary button
        const dialog = page.locator('.modal');
        await dialog.waitFor({ state: 'visible', timeout: 3000 });
        await dialog.locator('button.primary').click();

        // STALE_HEAD error should appear
        await expect(page.getByText(/HEAD が古くなっています|要更新/).first()).toBeVisible({ timeout: 5000 });
    });

    test('通常状態: ステートバッジが「待機中」を表示', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        const stateBadge = page.locator('.state-badge');
        await expect(stateBadge).toBeVisible({ timeout: 5000 });
        await expect(stateBadge).toHaveText('待機中');
    });
});
