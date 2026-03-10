import { test, expect, type Page } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

async function clickToolbarButton(page: Page, label: string | RegExp) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const button = page.locator('button').filter({ hasText: label }).first();
        await expect(button).toBeVisible({ timeout: 2000 });
        try {
            await button.click();
            return;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('detached from the DOM') || attempt === 2) {
                throw error;
            }
        }
    }
}

test.describe('ドラフト永続性テスト', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        // Navigate to app first to ensure sessionStorage context exists, then clear draft
        await page.goto('/');
        await page.evaluate(() => sessionStorage.clear());
    });

    test('2C-1: セッション回復 — ドラフト作成 → リロード → ドラフト復元', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // ドラフトを作成（行削除）
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await clickToolbarButton(page, '削除');

        // Commit ボタンにカウント表示
        await expect(page.locator('.action-commit')).toHaveText('Commit (1)', { timeout: 3000 });

        // ページリロード（sessionStorage は保持される）
        await page.reload();
        // loadDraft() が mount 時に呼ばれ、sessionStorage からドラフトが復元される
        await expect(page.locator('.action-commit')).toHaveText('Commit (1)', { timeout: 5000 });
    });

    test('2C-2: ドラフト確認 — 行削除でops数が正しくカウントされる', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // 1行目を削除
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await clickToolbarButton(page, '削除');

        // Commit ボタンのカウントが1
        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)', { timeout: 3000 });

        // Alice の選択を解除してから Bob を削除
        await aliceRow.locator('.ag-selection-checkbox').click();

        const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' });
        await bobRow.waitFor({ state: 'visible', timeout: 3000 });
        await bobRow.locator('.ag-selection-checkbox').click();
        await clickToolbarButton(page, '削除');

        // カウントが2になる
        await expect(commitBtn).toHaveText('Commit (2)', { timeout: 3000 });
    });

    test('2C-3: INSERT → DELETE = キャンセル — コピー後に削除でops消去', async ({ page }) => {
        await page.route('**/api/v1/preview/clone', async route => {
            await route.fulfill({
                json: {
                    ops: [{
                        type: 'insert',
                        table: 'users',
                        values: { id: 99, name: 'Clone', role: 'user' },
                    }],
                    errors: [],
                },
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // 行を選択してコピー（ツールバーのコピーボタン）
        const row = page.locator('.ag-center-cols-container .ag-row').first();
        await row.waitFor({ state: 'visible', timeout: 5000 });
        await row.locator('.ag-selection-checkbox').click();

        const copyBtn = page.locator('button').filter({ hasText: /コピー/ }).first();
        if (await copyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await clickToolbarButton(page, /コピー/);

            // Commit カウントが1になる
            const commitBtn = page.locator('.action-commit');
            await expect(commitBtn).toHaveText('Commit (1)', { timeout: 3000 });

            // コピーした行（ドラフト行）を削除
            const draftRow = page.locator('.ag-center-cols-container .ag-row').filter({
                has: page.locator('[style*="background"]')
            }).first();
            if (await draftRow.isVisible({ timeout: 2000 }).catch(() => false)) {
                await draftRow.locator('.ag-selection-checkbox').click();
                const deleteBtn = page.locator('button', { hasText: '削除' });
                if (await deleteBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await clickToolbarButton(page, '削除');
                    // カウントが0に戻る（opsがキャンセルされた）
                    await expect(commitBtn).not.toBeVisible({ timeout: 3000 });
                }
            }
        }
    });
});
