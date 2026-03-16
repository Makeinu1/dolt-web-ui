/**
 * compare-mode.spec.ts
 *
 * Tests for CompareResultModal UX improvements (横並びグリッド表示).
 * All tests use observability fixture which auto-fails on unexpected
 * console errors / page errors / 5xx responses.
 */
import { test, expect, type Page } from '../observability';
import { setupBaseMocks, selectContextInUI } from './setup';

// ── Mock data ─────────────────────────────────────────────────────────────

const MOCK_SCHEMA_COMPARE = {
  columns: [
    { name: 'id',   primary_key: true,  type: 'int' },
    { name: 'name', primary_key: false, type: 'varchar' },
    { name: 'role', primary_key: false, type: 'varchar' },
  ],
};

/**
 * 2-row dataset: Alice (admin) vs Bob (user).
 * All 3 columns differ: id (1≠2), name (Alice≠Bob), role (admin≠user).
 */
const MOCK_ROWS_2 = {
  rows: [
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Bob',   role: 'user'  },
  ],
  total_count: 2,
};

/**
 * 2-row dataset where only id and role differ — name is the SAME.
 * Used to verify that "差分列のみ表示" hides the non-diff "name" column.
 *
 * id:   1 ≠ 2  → diff
 * name: Alice = Alice → NO diff (should be hidden with diff-cols-only ON)
 * role: admin ≠ user  → diff
 */
const MOCK_ROWS_PARTIAL_DIFF = {
  rows: [
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Alice', role: 'user'  },
  ],
  total_count: 2,
};

/**
 * 4-row dataset for multi-pair tests.
 *
 * A group: id=1 (Alice/admin), id=3 (Carol/admin)
 * B group: id=2 (Bob/user),   id=4 (Dave/guest)
 *
 * compareRows.ts sorts both groups by PK before pairing:
 *   Pair 0: id=1 (Alice/admin) ↔ id=2 (Bob/user)   → diffs: id, name, role
 *   Pair 1: id=3 (Carol/admin) ↔ id=4 (Dave/guest)  → diffs: id, name, role
 */
const MOCK_ROWS_4 = {
  rows: [
    { id: 1, name: 'Alice', role: 'admin' },
    { id: 2, name: 'Bob',   role: 'user'  },
    { id: 3, name: 'Carol', role: 'admin' },
    { id: 4, name: 'Dave',  role: 'guest' },
  ],
  total_count: 4,
};

/**
 * Schema using a _-prefixed PK column.
 * compareRows.ts excludes columns starting with "_" from comparison:
 *   dataColumns = allColumns.filter(c => !c.name.startsWith("_"))
 * So _key is excluded from the comparison, and only "value" is compared.
 * When two rows have the same "value", pair.diffs = [] → "差分なし" badge.
 */
const MOCK_SCHEMA_UNDERSCORE_PK = {
  columns: [
    { name: '_key',  primary_key: true,  type: 'varchar' },
    { name: 'value', primary_key: false, type: 'varchar' },
  ],
};

const MOCK_ROWS_NODIFF = {
  rows: [
    { _key: 'K1', value: 'hello' },
    { _key: 'K2', value: 'hello' },  // same value → no diff in dataColumns
  ],
  total_count: 2,
};

// ── Helpers ───────────────────────────────────────────────────────────────

/** Select the first row containing `partialText`, enter compare mode. */
async function enterCompareModeWith1Row(page: Page, partialText: string) {
  const row = page.locator('.ag-center-cols-container .ag-row')
    .filter({ hasText: partialText }).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await row.locator('.ag-selection-checkbox').click();
  await page.locator('button', { hasText: /^比較 \(/ }).click();
}

/** In compare mode: select the first B-group row by text and execute compare. */
async function selectBGroupAndExecute(page: Page, partialText: string) {
  const row = page.locator('.ag-center-cols-container .ag-row')
    .filter({ hasText: partialText }).first();
  await row.waitFor({ state: 'visible', timeout: 5000 });
  await row.locator('.ag-selection-checkbox').click();
  await page.locator('button', { hasText: '比較実行' }).click();
}

/** Select 2 rows at given 0-based indices as A group, enter compare mode. */
async function enterCompareModeWith2RowsByIndex(
  page: Page,
  idx1: number,
  idx2: number,
) {
  const rows = page.locator('.ag-center-cols-container .ag-row');
  const row1 = rows.nth(idx1);
  const row2 = rows.nth(idx2);
  await row1.waitFor({ state: 'visible', timeout: 5000 });
  await row1.locator('.ag-selection-checkbox').click();
  await row2.locator('.ag-selection-checkbox').click();
  await page.locator('button', { hasText: /^比較 \(2\)/ }).click();
}

/** After compare mode entered, select 2 B-group rows and execute. */
async function select2BGroupAndExecuteByIndex(
  page: Page,
  idx1: number,
  idx2: number,
) {
  const rows = page.locator('.ag-center-cols-container .ag-row');
  const row1 = rows.nth(idx1);
  const row2 = rows.nth(idx2);
  await row1.waitFor({ state: 'visible', timeout: 5000 });
  await row1.locator('.ag-selection-checkbox').click();
  await row2.locator('.ag-selection-checkbox').click();
  await page.locator('button', { hasText: '比較実行' }).click();
}

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe('行比較モード (CompareResultModal)', () => {
  test.beforeEach(async ({ page }) => {
    await setupBaseMocks(page);
    // Override schema and rows with compare-specific mocks
    await page.route('**/api/v1/table/schema*', async (route) => {
      await route.fulfill({ json: MOCK_SCHEMA_COMPARE });
    });
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_2 });
    });
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
  });

  // ── 1. Entry ──────────────────────────────────────────────────────────

  test('should show 比較 button when non-draft rows are selected with PK', async ({ page }) => {
    await expect(page.locator('button', { hasText: /^比較 \(/ })).toHaveCount(0);

    const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' }).first();
    await aliceRow.locator('.ag-selection-checkbox').click();

    await expect(page.locator('button', { hasText: '比較 (1)' })).toBeVisible();
  });

  test('should enter compare mode and show A群 count label', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');

    // Toolbar span shows "比較モード: A群 1行 | B群 0行選択中"
    await expect(page.getByText(/A群 1行/)).toBeVisible();
  });

  test('should show 比較実行 button only when B-group count matches A-group count', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');

    // No B group selected yet → 比較実行 absent
    await expect(page.locator('button', { hasText: '比較実行' })).toHaveCount(0);

    // Select Bob as B group
    const bobRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Bob' }).first();
    await bobRow.locator('.ag-selection-checkbox').click();

    await expect(page.locator('button', { hasText: '比較実行' })).toBeVisible();
  });

  test('should exit compare mode and hide A群 label on キャンセル', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await expect(page.getByText(/A群 1行/)).toBeVisible();

    await page.locator('button', { hasText: 'キャンセル' }).click();

    await expect(page.getByText(/A群 1行/)).toHaveCount(0);
    // 比較ボタンも消える（行非選択状態）
    await expect(page.locator('button', { hasText: /^比較 \(/ })).toHaveCount(0);
  });

  // ── 2. Modal heading & summary ────────────────────────────────────────

  test('should open CompareResultModal with 行比較結果 heading', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    await expect(page.locator('.modal h3', { hasText: '行比較結果' })).toBeVisible();
  });

  test('should show summary: 1ペア中 1ペアに差分あり', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toContainText('1ペア中');
    await expect(modal).toContainText('1ペアに差分あり');
  });

  test('should display A群 and B群 row labels in the pair table', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal.locator('td', { hasText: 'A群' }).first()).toBeVisible();
    await expect(modal.locator('td', { hasText: 'B群' }).first()).toBeVisible();
  });

  test('should display correct values side-by-side (Alice vs Bob, admin vs user)', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    // Alice and Bob appear in the A群 / B群 rows
    await expect(modal.locator('td', { hasText: 'Alice' }).first()).toBeVisible();
    await expect(modal.locator('td', { hasText: 'Bob' }).first()).toBeVisible();
    await expect(modal.locator('td', { hasText: 'admin' }).first()).toBeVisible();
    await expect(modal.locator('td', { hasText: 'user' }).first()).toBeVisible();
  });

  test('should list diff column names in summary', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toContainText('差分カラム:');
    // Alice(id=1,name=Alice,role=admin) vs Bob(id=2,name=Bob,role=user) → all 3 cols differ
    await expect(modal).toContainText('name');
    await expect(modal).toContainText('role');
  });

  test('pair label shows pk values: ペアN: pkA ↔ pkB', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    // Pair label text: "ペア1: id=1 ↔ id=2"
    await expect(modal).toContainText('ペア1:');
    await expect(modal).toContainText('↔');
  });

  // ── 3. 🔴 diff column highlighting ───────────────────────────────────

  test('should show 🔴 icon on diff column headers (at least name and role)', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    // Alice(id=1) vs Bob(id=2): id, name, role all differ → at least 1 🔴 header
    await expect(modal.locator('th', { hasText: '🔴' })).not.toHaveCount(0);

    // name and role columns specifically should have 🔴
    const nameHeader = modal.locator('th').filter({ hasText: 'name' }).filter({ hasText: '🔴' });
    const roleHeader = modal.locator('th').filter({ hasText: 'role' }).filter({ hasText: '🔴' });
    await expect(nameHeader.first()).toBeVisible();
    await expect(roleHeader.first()).toBeVisible();
  });

  test('should NOT show 🔴 on non-diff column headers (name is same)', async ({ page }) => {
    // Use partial-diff mock: Alice(admin) vs Alice(user) — name is same
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_PARTIAL_DIFF });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await enterCompareModeWith1Row(page, 'admin'); // Alice/admin row
    await selectBGroupAndExecute(page, 'user');   // Alice/user row

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // name column: same (Alice=Alice) → no 🔴
    const nameHeaderNoDiff = modal.locator('th').filter({ hasText: 'name' }).filter({ hasText: '🔴' });
    await expect(nameHeaderNoDiff).toHaveCount(0);

    // role column: differs → 🔴
    const roleHeaderDiff = modal.locator('th').filter({ hasText: 'role' }).filter({ hasText: '🔴' });
    await expect(roleHeaderDiff.first()).toBeVisible();
  });

  // ── 4. 差分列のみ表示 toggle ──────────────────────────────────────────

  test('差分列のみ表示 is ON by default and hides non-diff columns', async ({ page }) => {
    // Alice(id=1, name='Alice', role='admin') vs Alice(id=2, name='Alice', role='user')
    // name is NOT a diff column → should be hidden with diff-cols-only ON
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_PARTIAL_DIFF });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await enterCompareModeWith1Row(page, 'admin');
    await selectBGroupAndExecute(page, 'user');

    const modal = page.locator('.modal');

    // Checkbox should be checked by default
    const checkbox = modal.locator('label', { hasText: '差分列のみ表示' }).locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    // name is NOT in diffColumnNames → its header should NOT be in the table
    // (Only id and role headers should appear)
    await expect(modal.locator('th', { hasText: 'name' })).toHaveCount(0);

    // id and role should appear (both are diff cols)
    await expect(modal.locator('th').filter({ hasText: 'role' }).first()).toBeVisible();
  });

  test('差分列のみ表示 OFF — shows all data columns including non-diff ones', async ({ page }) => {
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_PARTIAL_DIFF });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    await enterCompareModeWith1Row(page, 'admin');
    await selectBGroupAndExecute(page, 'user');

    const modal = page.locator('.modal');
    const checkbox = modal.locator('label', { hasText: '差分列のみ表示' }).locator('input[type="checkbox"]');
    await checkbox.uncheck();

    // All 3 columns should now appear
    await expect(modal.locator('th').filter({ hasText: 'id' }).first()).toBeVisible();
    await expect(modal.locator('th').filter({ hasText: 'name' }).first()).toBeVisible();
    await expect(modal.locator('th').filter({ hasText: 'role' }).first()).toBeVisible();
  });

  // ── 5. 差分ペアのみ表示 ───────────────────────────────────────────────

  test('差分ペアのみ表示 is OFF by default', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    const pairCheckbox = modal.locator('label', { hasText: '差分ペアのみ表示' }).locator('input[type="checkbox"]');
    await expect(pairCheckbox).not.toBeChecked();
  });

  test('差分ペアのみ表示 ON keeps pairs that have diffs visible', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    const pairCheckbox = modal.locator('label', { hasText: '差分ペアのみ表示' }).locator('input[type="checkbox"]');
    await pairCheckbox.check();

    // Pair 1 has diffs → still visible
    await expect(modal).toContainText('ペア1:');
    await expect(modal.locator('td', { hasText: 'A群' }).first()).toBeVisible();
  });

  // ── 6. 差分なし badge (using _-prefixed PK to exclude from comparison) ─

  test('差分なしペアに「差分なし」緑バッジが表示される', async ({ page }) => {
    // _key is PK but starts with "_" → excluded from dataColumns comparison.
    // value is the only compared column. Both rows have value='hello' → no diff.
    await page.route('**/api/v1/table/schema*', async (route) => {
      await route.fulfill({ json: MOCK_SCHEMA_UNDERSCORE_PK });
    });
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_NODIFF });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    // Select row with K1 as A group
    const row1 = page.locator('.ag-center-cols-container .ag-row').first();
    await row1.waitFor({ state: 'visible', timeout: 5000 });
    await row1.locator('.ag-selection-checkbox').click();
    await page.locator('button', { hasText: /^比較 \(1\)/ }).click();

    // Select row with K2 as B group
    const row2 = page.locator('.ag-center-cols-container .ag-row').last();
    await row2.locator('.ag-selection-checkbox').click();
    await page.locator('button', { hasText: '比較実行' }).click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Summary: 1ペア中 0ペアに差分あり
    await expect(modal).toContainText('0ペアに差分あり');

    // 差分なし badge should appear
    await expect(modal.locator('span', { hasText: '差分なし' })).toBeVisible();

    // No 🔴 icons
    await expect(modal.locator('th', { hasText: '🔴' })).toHaveCount(0);

    // 差分列のみ表示 ON → no visible diff columns → "差分カラムなし" message
    await expect(modal).toContainText('差分カラムなし');
  });

  test('差分ペアのみ表示 ON hides no-diff pairs', async ({ page }) => {
    await page.route('**/api/v1/table/schema*', async (route) => {
      await route.fulfill({ json: MOCK_SCHEMA_UNDERSCORE_PK });
    });
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_NODIFF });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    const row1 = page.locator('.ag-center-cols-container .ag-row').first();
    await row1.waitFor({ state: 'visible', timeout: 5000 });
    await row1.locator('.ag-selection-checkbox').click();
    await page.locator('button', { hasText: /^比較 \(1\)/ }).click();

    const row2 = page.locator('.ag-center-cols-container .ag-row').last();
    await row2.locator('.ag-selection-checkbox').click();
    await page.locator('button', { hasText: '比較実行' }).click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('span', { hasText: '差分なし' })).toBeVisible();

    // Turn ON 差分ペアのみ表示
    const pairCheckbox = modal.locator('label', { hasText: '差分ペアのみ表示' }).locator('input[type="checkbox"]');
    await pairCheckbox.check();

    // No-diff pair is hidden → 差分なし badge gone, "表示するペアがありません"
    await expect(modal.locator('span', { hasText: '差分なし' })).toHaveCount(0);
    await expect(modal).toContainText('表示するペアがありません');
  });

  // ── 7. Multi-pair (2 pairs, both with diffs) ──────────────────────────

  test('multi-pair: shows both pairs when 2 pairs selected', async ({ page }) => {
    await page.route('**/api/v1/table/rows*', async (route) => {
      await route.fulfill({ json: MOCK_ROWS_4 });
    });
    await page.reload();
    await page.evaluate(() => sessionStorage.clear());
    await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');

    // A group: row index 0 (id=1) and index 2 (id=3)
    await enterCompareModeWith2RowsByIndex(page, 0, 2);
    // B group: row index 1 (id=2) and index 3 (id=4)
    await select2BGroupAndExecuteByIndex(page, 1, 3);

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // 2 pairs: ペア1 and ペア2
    await expect(modal).toContainText('2ペア中');
    await expect(modal).toContainText('ペア1:');
    await expect(modal).toContainText('ペア2:');
  });

  // ── 8. CSV download ───────────────────────────────────────────────────

  test('should initiate CSV download with filename starting with 比較_', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await modal.locator('button', { hasText: 'CSVダウンロード' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^比較_/);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  // ── 9. Close / dismiss ────────────────────────────────────────────────

  test('should close modal on 閉じる button click', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    await modal.locator('button', { hasText: '閉じる' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('should close modal on overlay click', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Click outside the modal (on the overlay)
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
    await expect(modal).toHaveCount(0);
  });

  // ── 10. Layout ────────────────────────────────────────────────────────

  test('modal width is wider than 700px (expanded to ~960px)', async ({ page }) => {
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // min(90vw, 960px) with default Playwright viewport (1280px) → ~960px
    const width = await modal.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(700);
  });

  // ── 11. Observability — no errors ──────────────────────────────────────

  test('full compare flow produces no console errors or page errors', async ({ page }) => {
    // The observability fixture auto-fails on any unexpected errors.
    await enterCompareModeWith1Row(page, 'Alice');
    await selectBGroupAndExecute(page, 'Bob');

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Exercise all checkbox states
    const diffColsCheckbox = modal.locator('label', { hasText: '差分列のみ表示' }).locator('input[type="checkbox"]');
    const diffPairsCheckbox = modal.locator('label', { hasText: '差分ペアのみ表示' }).locator('input[type="checkbox"]');

    await diffColsCheckbox.uncheck();
    await diffColsCheckbox.check();
    await diffPairsCheckbox.check();
    await diffPairsCheckbox.uncheck();

    await modal.locator('button', { hasText: '閉じる' }).click();
    await expect(modal).toHaveCount(0);
  });
});
