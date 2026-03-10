import { test, expect } from '@playwright/test';
import { MOCK_REQUESTS, setupBaseMocks, selectContextInUI } from './setup';

test.describe('Workflow Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
    });

    test('should allow committing draft changes', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // 削除操作を行なってドラフトを作成
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '削除' }).click();

        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Click commit button
        await commitBtn.click();

        // Dialog should open
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('変更を保存');

        // See table group "users"
        await expect(modal).toContainText('users');
        // Delete only logs PK by default, not previous values
        await expect(modal).toContainText('PK=1');

        // Make mock API for commit succeed
        await page.route('**/api/v1/commit*', async route => {
            await route.fulfill({ status: 200, json: { commit_hash: 'new-hash-001' } });
        });

        // Click save button (no textarea in current CommitDialog)
        await modal.locator('button', { hasText: '保存' }).click();

        // Verify dialog closed and draft cleared
        await expect(modal).not.toBeVisible();
        await expect(commitBtn).not.toBeVisible();
    });

    test('should allow submitting branch and opening diffs', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

        // Open overflow menu
        const overflowBtn = page.locator('.overflow-btn');
        await overflowBtn.click();

        // Click Submit
        const submitBtn = page.locator('button', { hasText: '📤 承認を申請' });
        await expect(submitBtn).toBeVisible();
        await submitBtn.click();

        // Submit dialog opens
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('承認を申請');

        // Diff summary should be fetched and shown
        const summaryRow = modal.locator('td', { hasText: '▶ users' }).locator('..');
        await expect(summaryRow).toBeVisible();
        // Expand row
        await summaryRow.click();

        // Diff table should be rendered (MOCK_DIFF_TABLE_USERS)
        await expect(modal).toContainText('Dave');

        // Mock submit response
        await page.route('**/api/v1/request/submit*', async route => {
            await route.fulfill({ status: 200, json: { request_id: 'req/feat-a', submitted_main_hash: 'hx', submitted_work_hash: 'hy' } });
        });

        // Fill input and submit
        const summaryInput = modal.locator('textarea');
        await summaryInput.fill('Please review');
        await modal.locator('button.primary', { hasText: '申請する' }).click();

        // Dialog closes
        await expect(modal).not.toBeVisible();
    });

    test('should allow opening approver inbox and viewing requests', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'main');

        // Wait specific selector since header may load requests later
        const approverBadge = page.locator('.approver-badge');
        await expect(approverBadge).toBeVisible({ timeout: 10000 });
        await expect(approverBadge).toHaveText('📋 1');

        // Click badge
        await approverBadge.click();

        // Approver Inbox modal
        const inboxModal = page.locator('.modal').first();
        await expect(inboxModal).toBeVisible();
        await expect(inboxModal.locator('h2')).toHaveText('承認待ちリクエスト');

        // See specific request
        await expect(inboxModal).toContainText('テストリクエスト');

        // Accept it
        const approveBtn = inboxModal.locator('button.success', { hasText: '承認' });
        await approveBtn.click();

        // Approve confirmation authModal
        const authModal = page.locator('.modal').last();
        await expect(authModal).toBeVisible();
        await expect(authModal.locator('h2')).toHaveText('承認');

        await page.unroute('**/api/v1/requests*');
        let requestApproved = false;
        await page.route('**/api/v1/requests*', async route => {
            await route.fulfill({ json: requestApproved ? [] : MOCK_REQUESTS });
        });

        // Mock approve response
        await page.route('**/api/v1/request/approve*', async route => {
            requestApproved = true;
            await route.fulfill({ status: 200, json: { hash: 'hash-a', active_branch: 'wi/feat-b', active_branch_advanced: true, archive_tag: 'merged/feat-b/01', warnings: [] } });
        });

        // Click 承認してマージ
        await authModal.locator('button.primary', { hasText: '承認してマージ' }).click();

        // Wait for empty state
        await expect(inboxModal).toContainText('承認待ちのリクエストはありません');
        await inboxModal.locator('button', { hasText: '✕' }).click();
    });

    test('should fall back to main and show warnings when approve cannot advance the work branch', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'main');

        const approverBadge = page.locator('.approver-badge');
        await expect(approverBadge).toBeVisible({ timeout: 10000 });
        await approverBadge.click();

        const inboxModal = page.locator('.modal').first();
        await expect(inboxModal).toContainText('テストリクエスト');

        await page.unroute('**/api/v1/requests*');
        let requestApproved = false;
        await page.route('**/api/v1/requests*', async route => {
            await route.fulfill({ json: requestApproved ? [] : MOCK_REQUESTS });
        });

        await page.route('**/api/v1/request/approve*', async route => {
            requestApproved = true;
            await route.fulfill({
                status: 200,
                json: {
                    hash: 'hash-a',
                    active_branch: 'wi/feat-b',
                    active_branch_advanced: false,
                    archive_tag: 'merged/feat-b/01',
                    warnings: ['mainへの反映は完了しましたが、作業ブランチを進められませんでした。'],
                },
            });
        });

        await inboxModal.locator('button.success', { hasText: '承認' }).click();
        const approveModal = page.locator('.modal').last();
        await approveModal.locator('button.primary', { hasText: '承認してマージ' }).click();

        await expect(page.locator('.context-bar select')).toHaveValue('main');
        await expect(page.locator('.error-banner')).toContainText('作業ブランチを進められませんでした');
    });
});
