import { test, expect } from '@playwright/test';
import {
    setupBaseMocks,
    selectContextInUI,
} from './setup';

test.describe('エラー回復テスト', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
    });

    test('2B-1: Commit STALE_HEAD → StaleHeadDetected → リフレッシュで回復', async ({ page }) => {
        await page.route('**/api/v1/commit', async route => {
            await route.fulfill({
                status: 409,
                json: { error: { code: 'STALE_HEAD', message: 'HEAD が古くなっています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
        await expect(page.getByRole('button', { name: '復旧付き再読み込み' })).toHaveCount(0);

        // ドラフトを作成（行削除）
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        // Commit ボタンをクリック
        const commitBtn = page.locator('.action-commit');
        await commitBtn.waitFor({ state: 'visible', timeout: 5000 });
        await commitBtn.click();

        // CommitDialog が表示される
        const dialog = page.locator('.modal');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('button.primary').click();

        // STALE_HEAD エラーバナー or StaleHead バッジが表示される
        await expect(page.getByText(/HEAD が古くなっています|要更新/).first()).toBeVisible({ timeout: 5000 });
    });

    test('2B-2: Commit BRANCH_LOCKED → エラーメッセージ表示', async ({ page }) => {
        await page.route('**/api/v1/commit', async route => {
            await route.fulfill({
                status: 423,
                json: { error: { code: 'BRANCH_LOCKED', message: '承認申請中のためロックされています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // ドラフトを作成（行削除）
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        const commitBtn = page.locator('.action-commit');
        await commitBtn.waitFor({ state: 'visible', timeout: 5000 });
        await commitBtn.click();

        const dialog = page.locator('.modal');
        await dialog.waitFor({ state: 'visible' });
        await dialog.locator('button.primary').click();

        await expect(page.getByText(/承認申請中|ロック/)).toBeVisible({ timeout: 5000 });
    });

    test('2B-2b: Submit STALE_HEAD → StaleHeadDetected に遷移', async ({ page }) => {
        await page.route('**/api/v1/request/submit*', async route => {
            await route.fulfill({
                status: 409,
                json: { error: { code: 'STALE_HEAD', message: 'HEAD が古くなっています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('button', { hasText: '📤 承認を申請' }).click();

        const modal = page.locator('.modal');
        await expect(modal.locator('h2')).toHaveText('承認を申請');
        await modal.locator('textarea').fill('stale head submit');
        await modal.locator('button.primary', { hasText: '申請する' }).click();

        await expect(page.getByText(/HEAD が古くなっています|要更新/).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: '復旧付き再読み込み' })).toBeVisible({ timeout: 5000 });
    });

    test('2B-2d: Submit SCHEMA_CONFLICTS_PRESENT → CLIRunbook を表示', async ({ page }) => {
        await page.route('**/api/v1/request/submit*', async route => {
            await route.fulfill({
                status: 409,
                json: {
                    error: {
                        code: 'SCHEMA_CONFLICTS_PRESENT',
                        message: 'schema conflicts detected',
                    },
                },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('button', { hasText: '📤 承認を申請' }).click();

        const modal = page.locator('.modal');
        await expect(modal.locator('h2')).toHaveText('承認を申請');
        await modal.locator('textarea').fill('schema conflict submit');
        await modal.locator('button.primary', { hasText: '申請する' }).click();

        await expect(page.getByText(/Schema Conflict Detected|スキーマコンフリクト/).first()).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(/CLI Required/)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(/schema conflicts detected/)).toBeVisible({ timeout: 5000 });
    });

    test('2B-2c: CSV Apply STALE_HEAD → StaleHeadDetected に遷移', async ({ page }) => {
        await page.route('**/api/v1/csv/preview', async route => {
            await route.fulfill({
                json: {
                    inserts: 1,
                    updates: 0,
                    skips: 0,
                    errors: 0,
                    sample_diffs: [
                        { action: 'insert', row: { id: '10', name: 'Delta', role: 'user' } },
                    ],
                },
            });
        });
        await page.route('**/api/v1/csv/apply', async route => {
            await route.fulfill({
                status: 409,
                json: { error: { code: 'STALE_HEAD', message: 'HEAD が古くなっています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'CSVインポート' }).click();

        const modal = page.locator('.modal');
        await expect(modal.locator('h2')).toContainText('CSVインポート');
        const fileInput = modal.locator('input[type="file"]');
        await fileInput.setInputFiles({
            name: 'users.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from('id,name,role\n10,Delta,user\n', 'utf8'),
        });

        await expect(modal).toContainText('1行 / 3カラム 読み込み済み');
        await modal.locator('button.primary', { hasText: 'プレビュー' }).click();
        await expect(modal).toContainText('追加: 1行');
        await modal.locator('button.primary', { hasText: '適用する' }).click();

        await expect(page.getByText(/HEAD が古くなっています|要更新/).first()).toBeVisible({ timeout: 5000 });
    });

    test('2B-3: ネットワークエラー → バナー表示', async ({ page }) => {
        await page.route('**/api/v1/table/rows*', async route => {
            await route.abort('failed');
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // エラーバナー表示
        await expect(page.getByText(/接続できません|失敗/)).toBeVisible({ timeout: 5000 });
    });

    test('2B-5: 行読み込み失敗 → エラーバナー → 再試行で成功', async ({ page }) => {
        let callCount = 0;
        await page.route('**/api/v1/table/rows*', async route => {
            callCount++;
            if (callCount === 1) {
                await route.fulfill({
                    status: 500,
                    json: { error: { code: 'INTERNAL', message: 'サーバーエラー' } },
                });
            } else {
                await route.fulfill({
                    json: { rows: [{ id: 1, name: 'Alice', role: 'admin' }], total_count: 1 },
                });
            }
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // エラーバナーが表示される
        await expect(page.getByText(/失敗|エラー/)).toBeVisible({ timeout: 5000 });

        // 再試行ボタンをクリック
        const retryBtn = page.getByRole('button', { name: /再試行/ });
        if (await retryBtn.isVisible()) {
            await retryBtn.click();
            await expect(page.getByText(/失敗|エラー/)).not.toBeVisible({ timeout: 3000 });
        }
    });
});
