import { test, expect } from '../observability';
import { setupBaseMocks, selectContextInUI, MOCK_TABLES } from './setup';

test.describe('mainと同期テスト', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
        await page.evaluate(() => sessionStorage.clear());
    });

    // 3-A: 作業ブランチのオーバーフローメニューに「mainと同期」が表示される
    test('作業ブランチのオーバーフローメニューに「mainと同期」が表示される', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await expect(page.locator('.overflow-item', { hasText: 'mainと同期' })).toBeVisible();
    });

    // 3-B: mainブランチでは「mainと同期」ボタンが表示されない
    test('mainブランチのオーバーフローメニューに「mainと同期」が表示されない', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'main');

        await page.locator('.overflow-btn').click();
        await expect(page.locator('.overflow-item', { hasText: 'mainと同期' })).not.toBeVisible();
    });

    // 3-C: Sync成功後、テーブル一覧が再取得される
    test('Sync成功後にテーブル一覧が再取得され新テーブルが表示される', async ({ page }) => {
        let tablesCallCount = 0;
        await page.route('**/api/v1/tables*', async route => {
            tablesCallCount++;
            if (tablesCallCount > 1) {
                // 2回目以降は new_table を追加して返す
                await route.fulfill({ json: [...MOCK_TABLES, { name: 'new_table' }] });
            } else {
                await route.fulfill({ json: MOCK_TABLES });
            }
        });

        await page.route('**/api/v1/sync', async route => {
            await route.fulfill({ json: { hash: 'newhash', overwritten_tables: [] } });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // 初期状態: new_table は存在しない
        const tableSelector = page.locator('.header-table-select');
        await expect(tableSelector).not.toContainText('new_table');

        // mainと同期を実行
        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'mainと同期' }).click();

        // テーブル一覧が再取得されて new_table が表示される
        await expect(tableSelector).toContainText('new_table', { timeout: 5000 });
    });

    // 3-D: overwritten_tablesがある場合、ConflictViewが表示される
    test('上書きテーブルがある場合はConflictViewが表示される', async ({ page }) => {
        await page.route('**/api/v1/sync', async route => {
            await route.fulfill({
                json: {
                    hash: 'newhash',
                    overwritten_tables: [{ table: 'users', conflicts: 3 }],
                },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'mainと同期' }).click();

        // ConflictViewオーバーレイが表示される
        await expect(page.locator('.conflict-overlay')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.conflict-overlay')).toContainText('users');
    });

    // 3-E: STALE_HEAD 409 → エラーバナー表示
    test('STALE_HEAD 409 → エラーバナーが表示される', async ({ page }) => {
        await page.route('**/api/v1/sync', async route => {
            await route.fulfill({
                status: 409,
                json: { error: { code: 'STALE_HEAD', message: 'HEAD が古くなっています' } },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'mainと同期' }).click();

        await expect(page.locator('.error-banner')).toBeVisible({ timeout: 5000 });
    });

    // 3-F: スキーマ競合 409 → エラーバナー表示
    test('スキーマ競合 409 → エラーバナーが表示される', async ({ page }) => {
        await page.route('**/api/v1/sync', async route => {
            await route.fulfill({
                status: 409,
                json: {
                    error: {
                        code: 'SCHEMA_CONFLICTS_PRESENT',
                        message: 'schema conflicts detected',
                        details: { tables: ['users'], hint: 'Schema conflicts must be resolved via CLI.' },
                    },
                },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'mainと同期' }).click();

        await expect(page.locator('.error-banner')).toBeVisible({ timeout: 5000 });
    });

    // 3-G: Sync中はボタンが無効化
    test('Sync実行中はボタンが「同期中...」と表示されて無効化される', async ({ page }) => {
        let resolveSync!: () => void;
        const syncLatch = new Promise<void>(resolve => { resolveSync = resolve; });

        await page.route('**/api/v1/sync', async route => {
            await syncLatch; // ラッチが解除されるまで保留
            await route.fulfill({ json: { hash: 'newhash', overwritten_tables: [] } });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Syncを開始（レスポンスは保留中）
        await page.locator('.overflow-btn').click();
        await page.locator('.overflow-item', { hasText: 'mainと同期' }).click();

        // 同期中の表示確認
        await page.locator('.overflow-btn').click();
        const syncItem = page.locator('.overflow-item', { hasText: '同期中' });
        await expect(syncItem).toBeVisible({ timeout: 3000 });
        await expect(syncItem).toBeDisabled();

        // ラッチ解除
        resolveSync();
    });
});
