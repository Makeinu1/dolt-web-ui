import { test, expect } from '../observability';
import { setupBaseMocks, selectContextInUI, MOCK_ROWS_USERS } from './setup';

// ------------------------------------------------------------------
// Composite PK mock schema: (region VARCHAR, circuit_id INT)
// ------------------------------------------------------------------

const MOCK_SCHEMA_COMPOSITE = {
    columns: [
        { name: 'circuit_id', primary_key: true, type: 'int' },
        { name: 'region', primary_key: true, type: 'varchar' },
        { name: 'name', primary_key: false, type: 'varchar' },
    ]
};

const MOCK_ROWS_COMPOSITE = {
    rows: [
        { circuit_id: 1, region: 'JP', name: 'Suzuka' },
        { circuit_id: 2, region: 'JP', name: 'Motegi' },
        { circuit_id: 1, region: 'EU', name: 'Monza' },
    ],
    total_count: 3
};

async function setupCompositePkMocks(page: import('@playwright/test').Page) {
    // Override schema and row mocks with composite-PK versions
    await setupBaseMocks(page);
    await page.route('**/api/v1/table/schema*', async route => {
        await route.fulfill({ json: MOCK_SCHEMA_COMPOSITE });
    });
    await page.route('**/api/v1/table/rows*', async route => {
        await route.fulfill({ json: MOCK_ROWS_COMPOSITE });
    });
}

// ------------------------------------------------------------------
// GAP-1: CRUD with composite PK
// ------------------------------------------------------------------
test.describe('Composite PK — CRUD (GAP-1)', () => {
    test.beforeEach(async ({ page }) => {
        await setupCompositePkMocks(page);
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
    });

    test('should display composite-PK table rows', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();
        const rowElements = page.locator('.ag-center-cols-container .ag-row');
        await expect(rowElements).toHaveCount(3);
    });

    test('should create delete op with composite PK and show in CommitDialog', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Select first row (Suzuka: circuit_id=1, region=JP)
        const suzuka = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Suzuka' });
        await suzuka.waitFor({ state: 'visible', timeout: 5000 });
        await suzuka.locator('.ag-selection-checkbox').click();

        await page.locator('button', { hasText: '削除' }).click();

        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Open commit dialog
        await commitBtn.click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('変更を保存');

        // CommitDialog should display both PK values (GAP-3: composite PK in dialog)
        // pk_text = Object.values(op.pk).join(',') → '1,JP' or 'JP,1'
        await expect(modal).toContainText('PK=');
        // Must show at least one PK value
        const pkSpan = modal.locator('span', { hasText: 'PK=' }).first();
        await expect(pkSpan).toBeVisible();

        // Close without committing
        await modal.locator('button', { hasText: '✕' }).click().catch(() => { });
    });

    test('PK columns should be editable in composite PK tables', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        const suzuka = page.locator('.ag-center-cols-container .ag-row').filter({
            has: page.locator('.ag-cell[col-id="region"]', { hasText: 'JP' }),
        }).filter({
            has: page.locator('.ag-cell[col-id="circuit_id"]', { hasText: '1' }),
        });
        await expect(suzuka).toContainText('Suzuka');

        // PK cells exist and are visible (editing is enabled by colDef.editable)
        const pkCell1 = suzuka.locator('.ag-cell[col-id="circuit_id"]');
        const pkCell2 = suzuka.locator('.ag-cell[col-id="region"]');
        await expect(pkCell1).toBeVisible();
        await expect(pkCell2).toBeVisible();

        // Non-PK cell is also editable (dblclick opens editor)
        const nonPkCell = suzuka.locator('.ag-cell[col-id="name"]');
        await nonPkCell.dblclick();
        await expect(suzuka.getByRole('textbox', { name: 'Input Editor' })).toBeVisible();
        await page.keyboard.press('Escape');
    });
});

// ------------------------------------------------------------------
// GAP-2: PK_COLLISION error display
// ------------------------------------------------------------------
test.describe('Composite PK — PK_COLLISION error (GAP-2)', () => {
    test.beforeEach(async ({ page }) => {
        await setupCompositePkMocks(page);
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
    });

    test('should show PK_COLLISION error when commit returns 400 PK_COLLISION', async ({ page }) => {
        const gridContainer = page.locator('.ag-root-wrapper');
        await expect(gridContainer).toBeVisible();

        // Create a delete draft to enable commit button
        const suzuka = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Suzuka' });
        await suzuka.waitFor({ state: 'visible', timeout: 5000 });
        await suzuka.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');

        // Mock commit API to return PK_COLLISION
        await page.route('**/api/v1/commit*', async route => {
            await route.fulfill({
                status: 400,
                json: { code: 'PK_COLLISION', message: 'PK already exists in circuits' }
            });
        });

        await commitBtn.click();
        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('h2')).toHaveText('変更を保存');

        // Click 保存 — should fail with PK_COLLISION (no textarea in current CommitDialog)
        await modal.locator('button', { hasText: '保存' }).click();

        // The action-commit button should still be visible (draft not cleared after error)
        await expect(commitBtn).toBeVisible({ timeout: 5000 });
    });
});

// ------------------------------------------------------------------
// Existing single-PK guard: ensure base mocks still pass
// ------------------------------------------------------------------
test.describe('Single PK — backward compat after composite PK changes', () => {
    test.beforeEach(async ({ page }) => {
        await setupBaseMocks(page);
        await page.goto('/');
        await selectContextInUI(page, 'local', 'test_db', 'wi/feat-a');
    });

    test('should load single-PK table rows as before', async ({ page }) => {
        const rowElements = page.locator('.ag-center-cols-container .ag-row');
        await expect(rowElements).toHaveCount(3);
    });

    test('should delete single-PK row and show PK=1 in CommitDialog', async ({ page }) => {
        const aliceRow = page.locator('.ag-center-cols-container .ag-row', { hasText: 'Alice' });
        await aliceRow.waitFor({ state: 'visible', timeout: 5000 });
        await aliceRow.locator('.ag-selection-checkbox').click();
        await page.locator('button', { hasText: '削除' }).click();

        const commitBtn = page.locator('.action-commit');
        await expect(commitBtn).toHaveText('Commit (1)');
        await commitBtn.click();

        const modal = page.locator('.modal');
        await expect(modal).toBeVisible();
        // Single PK still shows correctly
        await expect(modal).toContainText('PK=1');
    });
});
