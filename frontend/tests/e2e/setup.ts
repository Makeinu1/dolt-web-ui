import { expect, type Page } from '@playwright/test';

// -----------------------------------------------------
// 共通のモックデータセット
// -----------------------------------------------------

export const MOCK_TARGETS = [{ id: 'local' }];
export const MOCK_DATABASES = [{ name: 'test_db' }];
export const MOCK_BRANCHES = [
    { name: 'main', hash: 'hash-main', latest_commit_message: 'init', latest_committer: 'system', latest_commit_date: '2025-01-01T00:00:00Z' },
    { name: 'wi/feat-a', hash: 'hash-feat-a', latest_commit_message: 'add user', latest_committer: 'alice', latest_commit_date: '2025-01-02T00:00:00Z' },
];
export const MOCK_HEAD_MAIN = { hash: 'hash-main' };
export const MOCK_HEAD_FEAT = { hash: 'hash-feat-a' };
export const MOCK_TABLES = [{ name: 'users' }, { name: 'settings' }];

export const MOCK_SCHEMA_USERS = {
    columns: [
        { name: 'id', primary_key: true, type: 'int' },
        { name: 'name', primary_key: false, type: 'varchar' },
        { name: 'role', primary_key: false, type: 'varchar' },
    ]
};

export const MOCK_ROWS_USERS = {
    rows: [
        { id: 1, name: 'Alice', role: 'admin' },
        { id: 2, name: 'Bob', role: 'user' },
        { id: 3, name: 'Charlie', role: 'user' },
    ],
    total_count: 3
};

export const MOCK_REQUESTS = [
    { request_id: 'req/feat-b', work_branch: 'wi/feat-b', submitted_main_hash: 'hash-m', submitted_work_hash: 'hash-w', summary_ja: 'テストリクエスト', submitted_at: '2025-01-03T00:00:00Z' }
];

export const MOCK_DIFF_SUMMARY = {
    entries: [
        { table: 'users', added: 1, modified: 1, removed: 0 }
    ]
};

export const MOCK_DIFF_TABLE_USERS = {
    rows: [
        { diff_type: 'added', from: null, to: { id: 4, name: 'Dave', role: 'user' } },
        { diff_type: 'modified', from: { id: 1, name: 'Alice', role: 'admin' }, to: { id: 1, name: 'Alice', role: 'superadmin' } },
    ]
};

// -----------------------------------------------------
// モックヘルパー関数
// -----------------------------------------------------

export async function setupBaseMocks(page: Page) {
    // Metadata
    await page.route('**/api/v1/targets', async route => {
        await route.fulfill({ json: MOCK_TARGETS });
    });
    await page.route('**/api/v1/databases*', async route => {
        await route.fulfill({ json: MOCK_DATABASES });
    });
    await page.route('**/api/v1/branches*', async route => {
        await route.fulfill({ json: MOCK_BRANCHES });
    });
    await page.route('**/api/v1/head*', async route => {
        const url = new URL(route.request().url());
        const branch = url.searchParams.get('branch_name');
        if (branch === 'main') {
            await route.fulfill({ json: MOCK_HEAD_MAIN });
        } else {
            await route.fulfill({ json: MOCK_HEAD_FEAT });
        }
    });

    // Tables & Data
    await page.route('**/api/v1/tables*', async route => {
        await route.fulfill({ json: MOCK_TABLES });
    });
    await page.route('**/api/v1/table/schema*', async route => {
        await route.fulfill({ json: MOCK_SCHEMA_USERS });
    });
    await page.route('**/api/v1/table/rows*', async route => {
        await route.fulfill({ json: MOCK_ROWS_USERS });
    });

    // Conflicts
    await page.route('**/api/v1/conflicts*', async route => {
        await route.fulfill({ json: [] });
    });

    // Requests list
    await page.route('**/api/v1/requests*', async route => {
        await route.fulfill({ json: MOCK_REQUESTS });
    });

    // Memo map (Phase 2: _memo_ table migration)
    await page.route('**/api/v1/memo/map*', async route => {
        await route.fulfill({ json: { cells: [] } });
    });

    // Diff
    await page.route('**/api/v1/diff/summary*', async route => {
        await route.fulfill({ json: MOCK_DIFF_SUMMARY });
    });
    await page.route('**/api/v1/diff/table*', async route => {
        await route.fulfill({ json: MOCK_DIFF_TABLE_USERS });
    });
}

export async function selectContextInUI(page: Page, targetId: string, dbName: string, branchName: string) {
    // ページのロード完了を待機
    await page.goto('/');

    // Target/DB の選択状態を確認
    const contextBar = page.locator('.context-bar');
    await contextBar.waitFor({ state: 'visible', timeout: 5000 });

    const setupBtn = page.getByTitle('設定 (ターゲット / データベース)');
    await setupBtn.waitFor({ state: 'visible', timeout: 5000 });
    await setupBtn.click({ force: true });

    const modal = page.locator('.modal');
    await modal.waitFor({ state: 'visible', timeout: 5000 });

    const targetSelect = modal.locator('select').first();
    await targetSelect.selectOption(targetId);

    const dbSelect = modal.locator('select').nth(1);
    await dbSelect.selectOption(dbName);

    await modal.locator('button', { hasText: '閉じる' }).click();
    await modal.waitFor({ state: 'hidden' });

    // Branch の選択
    if (branchName) {
        const branchSelect = contextBar.locator('select');
        await expect(branchSelect).toBeVisible({ timeout: 5000 });
        await branchSelect.selectOption(branchName);
        await expect(branchSelect).toHaveValue(branchName, { timeout: 5000 });
    }

    // Wait for the table grid to appear rather than using a fixed timeout.
    // This prevents flaky tests in slow CI environments.
    await page.waitForSelector('.ag-root-wrapper', { state: 'visible', timeout: 10000 })
        .catch(() => { /* grid may not load if no table is selected yet; continue */ });
}
