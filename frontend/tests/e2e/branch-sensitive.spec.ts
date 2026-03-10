import { test, expect, type Page } from '@playwright/test';
import {
  MOCK_DIFF_SUMMARY,
  MOCK_DIFF_TABLE_USERS,
  setupBaseMocks,
  selectContextInUI,
} from './setup';

const MULTI_DB_DATABASES = [
  { name: 'test_db' },
  { name: 'dest_db' },
];

const SOURCE_BRANCHES = [
  { name: 'main', hash: 'hash-main', latest_commit_message: 'init', latest_committer: 'system', latest_commit_date: '2025-01-01T00:00:00Z' },
  { name: 'wi/feat-a', hash: 'hash-feat-a', latest_commit_message: 'add user', latest_committer: 'alice', latest_commit_date: '2025-01-02T00:00:00Z' },
];

const DEST_BRANCHES = [
  { name: 'main', hash: 'hash-dest-main', latest_commit_message: 'init', latest_committer: 'system', latest_commit_date: '2025-01-01T00:00:00Z' },
  { name: 'wi/dest-users', hash: 'hash-dest-users', latest_commit_message: 'work', latest_committer: 'bob', latest_commit_date: '2025-01-04T00:00:00Z' },
  { name: 'wi/import-test_db-users', hash: 'hash-users-copy', latest_commit_message: 'copied', latest_committer: 'bob', latest_commit_date: '2025-01-05T00:00:00Z' },
];

async function setupCrossDbMocks(page: Page) {
  await page.unroute('**/api/v1/databases*');
  await page.route('**/api/v1/databases*', async (route) => {
    await route.fulfill({ json: MULTI_DB_DATABASES });
  });

  await page.unroute('**/api/v1/branches*');
  await page.route('**/api/v1/branches*', async (route) => {
    const url = new URL(route.request().url());
    const dbName = url.searchParams.get('db_name');
    await route.fulfill({ json: dbName === 'dest_db' ? DEST_BRANCHES : SOURCE_BRANCHES });
  });
}

test.describe('Branch-sensitive Features', () => {
  test('should search using the current branch and switch table from the result', async ({ page }) => {
    await setupBaseMocks(page);

    let capturedSearchBranch = '';
    let capturedKeyword = '';

    await page.route('**/api/v1/search*', async (route) => {
      const url = new URL(route.request().url());
      capturedSearchBranch = url.searchParams.get('branch_name') ?? '';
      capturedKeyword = url.searchParams.get('keyword') ?? '';
      await route.fulfill({
        json: {
          results: [
            { table: 'users', pk: '2', column: 'name', value: 'Bob', match_type: 'value' },
          ],
          total: 1,
        },
      });
    });

    await page.goto('/');
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    const tableSelect = page.locator('.header-table-select');
    await expect(tableSelect).toHaveValue('users');
    await tableSelect.selectOption('settings');
    await expect(tableSelect).toHaveValue('settings');

    await page.locator('.overflow-btn').click();
    await page.locator('button', { hasText: '🔍 全テーブル検索' }).click();

    const modal = page.locator('.modal');
    await expect(modal.locator('h2')).toHaveText('🔍 全テーブル検索');
    await modal.locator('input[type="text"]').fill('Bob');
    await modal.locator('button.primary', { hasText: '検索' }).click();

    await expect(modal).toContainText('users');
    await expect(modal).toContainText('PK: 2');
    await modal.locator('span', { hasText: 'PK: 2' }).first().locator('..').click();

    await expect(modal).not.toBeVisible();
    await expect(tableSelect).toHaveValue('users');
    expect(capturedSearchBranch).toBe('wi/feat-a');
    expect(capturedKeyword).toBe('Bob');
  });

  test('should compare versions using explicit from/to branches', async ({ page }) => {
    await setupBaseMocks(page);

    let capturedSummaryQuery = '';
    let capturedDiffTableQuery = '';

    await page.unroute('**/api/v1/diff/summary*');
    await page.route('**/api/v1/diff/summary*', async (route) => {
      const url = new URL(route.request().url());
      capturedSummaryQuery = url.search;
      await route.fulfill({ json: MOCK_DIFF_SUMMARY });
    });

    await page.unroute('**/api/v1/diff/table*');
    await page.route('**/api/v1/diff/table*', async (route) => {
      const url = new URL(route.request().url());
      capturedDiffTableQuery = url.search;
      await route.fulfill({ json: MOCK_DIFF_TABLE_USERS });
    });

    await page.goto('/');
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await page.locator('.overflow-btn').click();
    await page.locator('button', { hasText: '📊 バージョン比較...' }).click();

    const modal = page.locator('.modal');
    await expect(modal.locator('h2')).toHaveText('バージョン比較');

    const selects = modal.locator('select');
    await selects.first().selectOption('main');
    await selects.nth(1).selectOption('wi/feat-a');
    await modal.locator('button', { hasText: '比較する' }).click();

    await expect(modal).toContainText('差分: main → wi/feat-a');
    const summaryRow = modal.locator('td', { hasText: 'users' }).first().locator('..');
    await expect(summaryRow).toBeVisible();
    await summaryRow.click();

    const fullscreen = page.locator('text=users の変更').locator('..').first();
    await expect(fullscreen).toContainText('main → wi/feat-a');
    await expect(page.getByText('Dave', { exact: true }).first()).toBeVisible();

    expect(capturedSummaryQuery).toContain('branch_name=wi%2Ffeat-a');
    expect(capturedSummaryQuery).toContain('from_ref=main');
    expect(capturedSummaryQuery).toContain('to_ref=wi%2Ffeat-a');
    expect(capturedDiffTableQuery).toContain('branch_name=wi%2Ffeat-a');
    expect(capturedDiffTableQuery).toContain('from_ref=main');
    expect(capturedDiffTableQuery).toContain('to_ref=wi%2Ffeat-a');
  });

  test('should copy a whole table to another DB and switch to the returned branch', async ({ page }) => {
    await setupBaseMocks(page);
    await setupCrossDbMocks(page);

    let copyBody: Record<string, unknown> | null = null;

    await page.route('**/api/v1/cross-copy/table', async (route) => {
      copyBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        json: {
          hash: 'hash-users-copy',
          branch_name: 'wi/import-test_db-users',
          row_count: 3,
          shared_columns: ['id', 'name', 'role'],
          source_only_columns: [],
          dest_only_columns: [],
        },
      });
    });

    await page.goto('/');
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await page.locator('.overflow-btn').click();
    await page.locator('button', { hasText: '他DBへテーブルコピー' }).click();

    const modal = page.locator('.modal');
    await expect(modal.locator('h2')).toHaveText('他DBへテーブルコピー');
    await modal.locator('select').first().selectOption('wi/feat-a');
    await modal.locator('select').nth(1).selectOption('dest_db');
    await modal.locator('button.primary', { hasText: 'コピー実行' }).click();

    await expect(modal).toContainText('コピー完了');
    await expect(modal).toContainText('ブランチ: wi/import-test_db-users');

    const switchedTablesRequest = page.waitForRequest((req) =>
      req.url().includes('/api/v1/tables') &&
      req.url().includes('db_name=dest_db') &&
      req.url().includes('branch_name=wi%2Fimport-test_db-users')
    );
    await modal.locator('button.primary', { hasText: '宛先に切り替え' }).click();
    await switchedTablesRequest;

    await expect(page.locator('.context-bar select')).toHaveValue('wi/import-test_db-users');
    expect(copyBody).not.toBeNull();
    expect(copyBody?.source_branch).toBe('wi/feat-a');
    expect(copyBody?.dest_db).toBe('dest_db');
  });

  test('should offer opening an existing import branch when cross-copy returns BRANCH_EXISTS', async ({ page }) => {
    await setupBaseMocks(page);
    await setupCrossDbMocks(page);

    await page.route('**/api/v1/cross-copy/table', async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'BRANCH_EXISTS',
            message: 'ブランチ wi/import-test_db-users は既に存在します。既存の作業ブランチを開いて続行してください。',
            details: {
              branch_name: 'wi/import-test_db-users',
              open_existing: true,
            },
          },
        },
      });
    });

    await page.goto('/');
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await page.locator('.overflow-btn').click();
    await page.locator('button', { hasText: '他DBへテーブルコピー' }).click();

    const modal = page.locator('.modal');
    await modal.locator('select').first().selectOption('wi/feat-a');
    await modal.locator('select').nth(1).selectOption('dest_db');
    await modal.locator('button.primary', { hasText: 'コピー実行' }).click();

    await expect(modal).toContainText('既存のインポートブランチがあります');
    await expect(modal).toContainText('ブランチ: wi/import-test_db-users');

    const switchedTablesRequest = page.waitForRequest((req) =>
      req.url().includes('/api/v1/tables') &&
      req.url().includes('db_name=dest_db') &&
      req.url().includes('branch_name=wi%2Fimport-test_db-users')
    );
    await modal.locator('button.primary', { hasText: '既存ブランチを開く' }).click();
    await switchedTablesRequest;

    await expect(page.locator('.context-bar select')).toHaveValue('wi/import-test_db-users');
  });

  test('should preview and copy selected rows across DBs with explicit source and destination branches', async ({ page }) => {
    await setupBaseMocks(page);
    await setupCrossDbMocks(page);

    let previewBody: Record<string, unknown> | null = null;
    let executeBody: Record<string, unknown> | null = null;

    await page.route('**/api/v1/cross-copy/preview', async (route) => {
      previewBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        json: {
          shared_columns: ['id', 'name', 'role'],
          source_only_columns: [],
          dest_only_columns: [],
          warnings: ['role カラムは上書きされます'],
          rows: [
            {
              action: 'insert',
              source_row: { id: 1, name: 'Alice', role: 'admin' },
            },
            {
              action: 'update',
              source_row: { id: 2, name: 'Bob', role: 'user' },
              dest_row: { id: 2, name: 'Bob', role: 'guest' },
            },
          ],
        },
      });
    });

    await page.route('**/api/v1/cross-copy/rows', async (route) => {
      executeBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        json: {
          hash: 'hash-row-copy',
          inserted: 1,
          updated: 1,
          total: 2,
        },
      });
    });

    await page.goto('/');
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
    await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
    await aliceRow.locator('.ag-selection-checkbox').click();

    await page.locator('button', { hasText: '他DBへ' }).click();

    const modal = page.locator('.modal');
    await expect(modal.locator('h2')).toHaveText('他DBへコピー');
    await modal.locator('select').first().selectOption('wi/feat-a');
    await modal.locator('select').nth(1).selectOption('dest_db');
    await modal.locator('select').nth(2).selectOption('wi/dest-users');
    await modal.locator('button.primary', { hasText: 'プレビュー' }).click();

    await expect(modal).toContainText('共有カラム: id, name, role');
    await expect(modal).toContainText('INSERT');
    await expect(modal).toContainText('UPDATE');
    await expect(modal).toContainText('Alice');
    await expect(modal).toContainText('guest');
    await expect(modal).toContainText('role カラムは上書きされます');

    await modal.locator('button.primary', { hasText: 'コピー実行 (2件)' }).click();

    await expect(modal).toContainText('2件コピーしました（挿入: 1, 更新: 1）');

    const switchedTablesRequest = page.waitForRequest((req) =>
      req.url().includes('/api/v1/tables') &&
      req.url().includes('db_name=dest_db') &&
      req.url().includes('branch_name=wi%2Fdest-users')
    );
    await modal.locator('button.primary', { hasText: '宛先に切り替え' }).click();
    await switchedTablesRequest;

    await expect(page.locator('.context-bar select')).toHaveValue('wi/dest-users');
    expect(previewBody).not.toBeNull();
    expect(previewBody?.source_branch).toBe('wi/feat-a');
    expect(previewBody?.dest_branch).toBe('wi/dest-users');
    expect(executeBody).not.toBeNull();
    expect(executeBody?.source_branch).toBe('wi/feat-a');
    expect(executeBody?.dest_branch).toBe('wi/dest-users');
  });
});
