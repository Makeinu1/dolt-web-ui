import { test, expect } from '@playwright/test';
import { setupBaseMocks, selectContextInUI } from './setup';

test.describe('ContextSelector Tests', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
    });

    test('should load and display context settings modal', async ({ page }) => {
        // Top header should say Setup Context initially or load defaults
        const setupBtn = page.getByTitle('設定 (ターゲット / データベース)');

        // Click to open modal
        await setupBtn.click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('⚙ 接続設定');

        // Select Target and DB
        const targetSelect = modal.locator('select').first();
        await targetSelect.selectOption('local');

        const dbSelect = modal.locator('select').nth(1);
        await dbSelect.selectOption('test_db');

        // Close Modal
        await modal.locator('button', { hasText: '閉じる' }).click();
        await expect(modal).not.toBeVisible();

        // Verify it changed
        await expect(page.locator('.context-bar')).toContainText('test_db@local');
    });

    test('should allow branch creation and selection', async ({ page }) => {
        // Navigate first to set origin, then inject session storage
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'main');

        let branchCreated = false;
        await page.unroute('**/api/v1/branches/ready*');
        await page.route('**/api/v1/branches/ready*', async route => {
            await route.fulfill({ json: { ready: true } });
        });
        await page.unroute('**/api/v1/branches*');
        await page.route('**/api/v1/branches*', async route => {
            await route.fulfill({
                json: [
                    { name: 'main', hash: 'hash-main' },
                    { name: 'wi/feat-a', hash: 'hash-feat-a' },
                    ...(branchCreated ? [{ name: 'wi/test-feature', hash: 'hash-test-feature' }] : []),
                ],
            });
        });

        const contextBar = page.locator('.context-bar');

        // Check branch select has "main" and "wi/feat-a" (from mocks)
        const branchSelect = contextBar.locator('select');
        await expect(branchSelect).toBeVisible();

        // Open create branch input
        await contextBar.locator('button', { hasText: '+' }).click();

        // Type new branch
        const branchInput = contextBar.locator('input[placeholder="ticket-123"]');
        await expect(branchInput).toBeVisible();
        await branchInput.fill('test-feature');

        // Create branch (mock API response)
        await page.route('**/api/v1/branches/create*', async route => {
            if (route.request().method() === 'POST') {
                branchCreated = true;
                await route.fulfill({ status: 201, json: { branch_name: 'wi/test-feature' } });
                return;
            }
            await route.continue();
        });

        const createBtn = contextBar.locator('button', { hasText: '作成' }).first();
        await createBtn.click();

        await expect(branchSelect).toHaveValue('wi/test-feature');
        await expect(branchInput).not.toBeVisible();
    });

    test('should reopen an existing work branch without calling create again', async ({ page }) => {
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'main');

        let createCalls = 0;
        await page.route('**/api/v1/branches/create*', async route => {
            if (route.request().method() === 'POST') {
                createCalls += 1;
                await route.fulfill({ status: 201, json: { branch_name: 'wi/feat-a' } });
                return;
            }
            await route.continue();
        });

        const contextBar = page.locator('.context-bar');
        const branchSelect = contextBar.locator('select');

        await contextBar.locator('button', { hasText: '+' }).click();
        const branchInput = contextBar.locator('input[placeholder="ticket-123"]');
        await branchInput.fill('feat-a');
        await contextBar.locator('button', { hasText: '作成' }).first().click();

        await expect(branchSelect).toHaveValue('wi/feat-a');
        expect(createCalls).toBe(0);
    });

    test('should recover from a stale branch list by opening BRANCH_EXISTS from the server', async ({ page }) => {
        let serverConfirmedExisting = false;
        await page.unroute('**/api/v1/branches/ready*');
        await page.route('**/api/v1/branches/ready*', async route => {
            const url = new URL(route.request().url());
            const branchName = url.searchParams.get('branch_name');
            await route.fulfill({
                status: serverConfirmedExisting && branchName === 'wi/stale-item' ? 200 : 409,
                json: serverConfirmedExisting && branchName === 'wi/stale-item'
                    ? { ready: true }
                    : {
                        error: {
                            code: 'BRANCH_NOT_READY',
                            message: 'まだ準備中です',
                        },
                    },
            });
        });
        await page.unroute('**/api/v1/branches*');
        await page.route('**/api/v1/branches*', async route => {
            if (serverConfirmedExisting) {
                await route.fulfill({
                    json: [
                        { name: 'main', hash: 'hash-main' },
                        { name: 'wi/stale-item', hash: 'hash-stale' },
                    ],
                });
                return;
            }
            await route.fulfill({
                json: [{ name: 'main', hash: 'hash-main' }],
            });
        });

        await page.route('**/api/v1/branches/create*', async route => {
            if (route.request().method() !== 'POST') {
                await route.continue();
                return;
            }
            serverConfirmedExisting = true;
            await route.fulfill({
                status: 409,
                json: {
                    error: {
                        code: 'BRANCH_EXISTS',
                        message: 'ブランチ wi/stale-item は既に存在します。既存の作業ブランチを開いて続行してください。',
                        details: {
                            branch_name: 'wi/stale-item',
                            open_existing: true,
                        },
                    },
                },
            });
        });

        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'main');

        const contextBar = page.locator('.context-bar');
        await contextBar.locator('button', { hasText: '+' }).click();
        const branchInput = contextBar.locator('input[placeholder="ticket-123"]');
        await branchInput.fill('stale-item');
        await contextBar.locator('button', { hasText: '作成' }).first().click();

        await expect(contextBar.locator('select')).toHaveValue('wi/stale-item');
    });

    test('should poll branch readiness before opening a newly created work branch', async ({ page }) => {
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'main');

        let branchCreated = false;
        let readyCalls = 0;

        await page.unroute('**/api/v1/branches/ready*');
        await page.route('**/api/v1/branches/ready*', async route => {
            readyCalls += 1;
            if (readyCalls < 3) {
                await route.fulfill({
                    status: 409,
                    json: {
                        error: {
                            code: 'BRANCH_NOT_READY',
                            message: '準備中です',
                            details: { branch_name: 'wi/slow-branch', retry_after_ms: 1200 },
                        },
                    },
                });
                return;
            }
            await route.fulfill({ json: { ready: true } });
        });
        await page.unroute('**/api/v1/branches*');
        await page.route('**/api/v1/branches*', async route => {
            await route.fulfill({
                json: [
                    { name: 'main', hash: 'hash-main' },
                    { name: 'wi/feat-a', hash: 'hash-feat-a' },
                    ...(branchCreated ? [{ name: 'wi/slow-branch', hash: 'hash-slow-branch' }] : []),
                ],
            });
        });

        await page.route('**/api/v1/branches/create*', async route => {
            branchCreated = true;
            await route.fulfill({
                status: 409,
                json: {
                    error: {
                        code: 'BRANCH_NOT_READY',
                        message: 'ブランチ wi/slow-branch は作成されましたが、まだ接続準備が完了していません。少し待ってから開いてください。',
                        details: { branch_name: 'wi/slow-branch', retry_after_ms: 1200 },
                    },
                },
            });
        });

        const contextBar = page.locator('.context-bar');
        await contextBar.locator('button', { hasText: '+' }).click();
        const branchInput = contextBar.locator('input[placeholder="ticket-123"]');
        await branchInput.fill('slow-branch');
        await contextBar.locator('button', { hasText: '作成' }).first().click();

        await expect(contextBar).toContainText('ブランチの接続反映を確認しています...');
        await expect(contextBar.locator('select')).toHaveValue('wi/slow-branch');
        expect(readyCalls).toBeGreaterThanOrEqual(3);
    });
});
