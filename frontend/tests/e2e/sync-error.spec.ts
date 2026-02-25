import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI, MOCK_SCHEMA_USERS } from './setup';

test.describe('Sync and Error State Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
    });

    test('should show STALE_HEAD error banner and SQL export button on sync conflict', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');

        // Mock sync to return STALE_HEAD error
        await page.route('**/api/v1/sync*', async route => {
            await route.fulfill({
                status: 409,
                json: { code: 'STALE_HEAD', message: 'expected_head mismatch' }
            });
        });

        // Open overflow and click sync
        await page.locator('.overflow-btn').click();
        const syncBtn = page.locator('button', { hasText: '↻ Main と同期' });
        await expect(syncBtn).toBeVisible();
        await syncBtn.click();

        // Error banner should appear
        const errorBanner = page.locator('.error-banner');
        await expect(errorBanner).toBeVisible({ timeout: 5000 });
        await expect(errorBanner).toContainText('expected_head mismatch');

        // State badge should show 要更新
        const stateBadge = page.locator('.state-badge');
        await expect(stateBadge).toHaveText('要更新');
    });

    test('should show error message when trying to sync with active draft (via handleSync)', async ({ page }) => {
        // Register sync mock BEFORE navigation (even though we won't actually hit it with draft)
        await page.route('**/api/v1/sync*', async route => {
            await route.fulfill({
                status: 409,
                json: { code: 'STALE_HEAD', message: 'expected_head mismatch' }
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');

        // Create a draft by deleting a row
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-cell').first().click();
        await page.locator('button', { hasText: '削除' }).click();

        // Confirm draft exists
        await expect(page.locator('.action-commit')).toBeVisible();

        // Open overflow menu — sync should be DISABLED because draft is active
        await page.locator('.overflow-btn').click();
        const syncBtn = page.locator('button', { hasText: '↻ Main と同期' });
        await expect(syncBtn).toBeDisabled();

        // The SQL export button should NOT appear yet (STALE_HEAD not triggered)
        const sqlExportBtn = page.locator('button', { hasText: 'ドラフトをSQLで退避' });
        await expect(sqlExportBtn).not.toBeVisible();
    });

    test('should recover from STALE_HEAD by clicking Refresh & Force Sync', async ({ page }) => {
        // Register sync mock BEFORE navigation to ensure it intercepts
        await page.route('**/api/v1/sync*', async route => {
            await route.fulfill({
                status: 409,
                json: { code: 'STALE_HEAD', message: 'expected_head mismatch' }
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');

        // Trigger STALE_HEAD
        await page.locator('.overflow-btn').click();
        await page.locator('button', { hasText: '↻ Main と同期' }).click();
        await expect(page.locator('.state-badge')).toHaveText('要更新', { timeout: 5000 });

        // Click Refresh & Force Sync to clear the state
        const refreshBtn = page.locator('button', { hasText: 'Refresh & Force Sync' });
        await expect(refreshBtn).toBeVisible();
        await refreshBtn.click();

        // State should go back to Idle
        await expect(page.locator('.state-badge')).toHaveText('待機中', { timeout: 5000 });
    });

    test('should show error banner on API error and allow dismissal', async ({ page }) => {
        // Simulate tables API failure
        await page.route('**/api/v1/tables*', async route => {
            await route.fulfill({
                status: 500,
                json: { code: 'INTERNAL', message: 'DB connection failed' }
            });
        });

        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');

        // Error banner should show
        const errorBanner = page.locator('.error-banner');
        await expect(errorBanner).toBeVisible({ timeout: 5000 });

        // Dismiss it
        await errorBanner.locator('button').click();
        await expect(errorBanner).not.toBeVisible();
    });

    test('should prevent sync when draft is active', async ({ page }) => {
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a/01');

        // Create a draft
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-cell').first().click();
        await page.locator('button', { hasText: '削除' }).click();

        // Open overflow menu — sync should be disabled
        await page.locator('.overflow-btn').click();
        const syncBtn = page.locator('button', { hasText: '↻ Main と同期' });
        await expect(syncBtn).toBeDisabled();
    });
});
