import { expect, test } from "@playwright/test";
import {
  commitUserRoleChange,
  createWorkBranchFromUI,
  ensureBranch,
  getHead,
  listRequests,
  selectContext,
  testTargetId,
} from "./helpers";

test.describe("Real branch lifecycle", () => {
  test("@smoke-real reuses an existing work branch without sending a second create request", async ({ page }) => {
    const workItem = `reuse-${Date.now()}`;
    const branchName = `wi/${workItem}`;
    let createPosts = 0;

    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/v1/branches/create")) {
        createPosts += 1;
      }
    });

    await selectContext(page, "test_db", "main");
    await createWorkBranchFromUI(page, workItem);

    const branchSelect = page.locator(".context-bar select");
    await branchSelect.selectOption("main");
    await expect(branchSelect).toHaveValue("main");

    await createWorkBranchFromUI(page, workItem);
    await expect(branchSelect).toHaveValue(branchName);
    expect(createPosts).toBe(1);
  });

  test("@smoke-real supports submit, delete lock, reject, resubmit, and approve on the same work branch", async ({ page }) => {
    const workItem = `lifecycle-${Date.now()}`;
    const branchName = `wi/${workItem}`;

    await ensureBranch(page.request, "test_db", branchName);
    await commitUserRoleChange(page.request, "test_db", branchName, "reviewer", "real smoke commit 1");

    await selectContext(page, "test_db", branchName);

    await page.locator(".overflow-btn").click();
    await page.locator("button", { hasText: "📤 承認を申請" }).click();

    const submitModal = page.locator(".modal").last();
    await expect(submitModal.locator("h2")).toHaveText("承認を申請");
    await submitModal.locator("textarea").fill("real smoke request");
    await submitModal.locator("button.primary", { hasText: "申請する" }).click();
    await expect(submitModal).not.toBeVisible();

    await expect(page.locator(".approver-badge")).toContainText("📋 1");

    await page.locator(".overflow-btn").click();
    await page.locator("button", { hasText: "🗑 ブランチを削除" }).click();
    const deleteModal = page.locator(".modal").last();
    await expect(deleteModal.locator("h2")).toHaveText("ブランチの削除");
    await deleteModal.locator("button", { hasText: "削除する" }).click();
    await expect(page.locator(".error-banner")).toContainText("ブランチの削除に失敗しました");
    await expect(page.locator(".error-banner")).toContainText("承認申請中");
    await deleteModal.locator("button", { hasText: "キャンセル" }).click();
    const dismissError = page.locator(".error-banner button", { hasText: "✕" });
    if (await dismissError.isVisible()) {
      await dismissError.click();
    }

    await page.locator(".context-bar select").selectOption("main");
    await expect(page.locator(".context-bar select")).toHaveValue("main");

    await page.locator(".approver-badge").click();
    const inboxModal = page.locator(".modal").first();
    await expect(inboxModal.locator("h2")).toHaveText("承認待ちリクエスト");
    await expect(inboxModal).toContainText(branchName);
    await inboxModal.locator("button.danger", { hasText: "却下" }).click();
    const rejectModal = page.locator(".modal").last();
    await expect(rejectModal.locator("h2")).toHaveText("却下");
    await rejectModal.locator("button.danger", { hasText: "却下する" }).click();
    await expect(inboxModal).toContainText("承認待ちのリクエストはありません");
    await inboxModal.locator("button", { hasText: "✕" }).click();
    await expect(page.locator(".approver-badge")).toHaveCount(0);

    await page.locator(".context-bar select").selectOption(branchName);
    await expect(page.locator(".context-bar select")).toHaveValue(branchName);

    await page.locator(".overflow-btn").click();
    await page.locator("button", { hasText: "📤 承認を申請" }).click();
    const resubmitModal = page.locator(".modal").last();
    await resubmitModal.locator("textarea").fill("real smoke request again");
    await resubmitModal.locator("button.primary", { hasText: "申請する" }).click();
    await expect(resubmitModal).not.toBeVisible();

    await page.locator(".context-bar select").selectOption("main");
    await page.locator(".approver-badge").click();
    await expect(inboxModal).toContainText(branchName);
    await inboxModal.locator("button.success", { hasText: "承認" }).click();
    const approveModal = page.locator(".modal").last();
    await expect(approveModal.locator("h2")).toHaveText("承認");
    await approveModal.locator("button.primary", { hasText: "承認してマージ" }).click();
    await expect(inboxModal).toContainText("承認待ちのリクエストはありません");
    await expect(page.locator(".context-bar select")).toHaveValue(branchName);
    await expect(page.locator(".approver-badge")).toHaveCount(0);

    const [mainHead, branchHead] = await Promise.all([
      getHead(page.request, "test_db", "main"),
      getHead(page.request, "test_db", branchName),
    ]);
    expect(branchHead).toBe(mainHead);

    const requests = await listRequests(page.request, "test_db");
    expect(requests).toHaveLength(0);
  });

  test("@smoke-real duplicate branch create returns BRANCH_EXISTS instead of INTERNAL", async ({ page }) => {
    const branchName = `wi/duplicate-${Date.now()}`;
    const targetId = testTargetId();

    const first = await page.request.post("/api/v1/branches/create", {
      data: {
        target_id: targetId,
        db_name: "test_db",
        branch_name: branchName,
      },
    });
    expect([201, 409]).toContain(first.status());
    if (first.status() === 409) {
      const firstBody = await first.json();
      expect(firstBody.error?.code).toBe("BRANCH_NOT_READY");
      expect(firstBody.error?.details?.branch_name).toBe(branchName);
    }

    const second = await page.request.post("/api/v1/branches/create", {
      data: {
        target_id: targetId,
        db_name: "test_db",
        branch_name: branchName,
      },
    });

    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.error?.code).toBe("BRANCH_EXISTS");
    expect(body.error?.details?.branch_name).toBe(branchName);
  });

  test("@smoke-real cross-copy table branches are submittable to the approval flow", async ({ page }) => {
    const targetId = testTargetId();
    const copyResponse = await page.request.post("/api/v1/cross-copy/table", {
      data: {
        target_id: targetId,
        source_db: "test_db",
        source_branch: "main",
        source_table: "users",
        dest_db: "dest_db",
      },
    });
    expect(copyResponse.ok()).toBeTruthy();
    const copyBody = (await copyResponse.json()) as { branch_name: string };
    expect(copyBody.branch_name).toBe("wi/import-test_db-users");

    const expectedHead = await getHead(page.request, "dest_db", copyBody.branch_name);
    const submitResponse = await page.request.post("/api/v1/request/submit", {
      data: {
        target_id: targetId,
        db_name: "dest_db",
        branch_name: copyBody.branch_name,
        expected_head: expectedHead,
        summary_ja: "cross copy should be submittable",
      },
    });

    expect(submitResponse.ok()).toBeTruthy();
    const submitBody = (await submitResponse.json()) as { request_id: string };

    const approveResponse = await page.request.post("/api/v1/request/approve", {
      data: {
        target_id: targetId,
        db_name: "dest_db",
        request_id: submitBody.request_id,
        merge_message_ja: "cross copy approve",
      },
    });
    expect(approveResponse.ok()).toBeTruthy();

    const copyAgainResponse = await page.request.post("/api/v1/cross-copy/table", {
      data: {
        target_id: targetId,
        source_db: "test_db",
        source_branch: "main",
        source_table: "users",
        dest_db: "dest_db",
      },
    });
    expect(copyAgainResponse.status()).toBe(409);
    const copyAgainBody = await copyAgainResponse.json();
    expect(copyAgainBody.error?.code).toBe("BRANCH_EXISTS");
    expect(copyAgainBody.error?.details?.branch_name).toBe(copyBody.branch_name);
  });

  test("@smoke-real exposes cross-copy only on protected branches and supports audit row copy", async ({ page }) => {
    const destBranchName = "wi/dest-users";
    const selectUsersTable = async () => {
      const tableSelect = page.locator(".header-table-select");
      await expect(tableSelect).toBeVisible();
      await tableSelect.selectOption("users");
      await expect(tableSelect).toHaveValue("users");
    };

    await selectContext(page, "test_db", "wi/existing-item");
    await selectUsersTable();
    const workRow = page.locator(".ag-center-cols-container .ag-row", { hasText: "Alice" }).first();
    await expect(workRow).toBeVisible();
    await workRow.locator(".ag-selection-checkbox").click();
    await expect(page.locator("button", { hasText: "他DBへ" })).toHaveCount(0);
    await page.locator(".overflow-btn").click();
    await expect(page.locator("button", { hasText: "他DBへテーブルコピー" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await selectContext(page, "test_db", "main");
    await selectUsersTable();
    const mainRow = page.locator(".ag-center-cols-container .ag-row", { hasText: "Alice" }).first();
    await expect(mainRow).toBeVisible();
    await mainRow.locator(".ag-selection-checkbox").click();
    await expect(page.locator("button", { hasText: "他DBへ" })).toBeVisible();
    await page.locator(".overflow-btn").click();
    await expect(page.locator("button", { hasText: "他DBへテーブルコピー" })).toBeVisible();
    await page.keyboard.press("Escape");

    await selectContext(page, "test_db", "audit");
    await selectUsersTable();
    const auditRow = page.locator(".ag-center-cols-container .ag-row", { hasText: "Alice" }).first();
    await expect(auditRow).toBeVisible();
    await auditRow.locator(".ag-selection-checkbox").click();
    await page.locator("button", { hasText: "他DBへ" }).click();

    const modal = page.locator(".modal").last();
    await expect(modal.locator("h2")).toHaveText("他DBへコピー");
    await expect(modal).toContainText("コピー元: test_db / audit / users");
    await expect(modal.locator("select")).toHaveCount(2);
    await modal.locator("select").first().selectOption("dest_db");
    await modal.locator("select").nth(1).selectOption(destBranchName);
    await modal.locator("button.primary", { hasText: "プレビュー" }).click();

    await expect(modal).toContainText("共有カラム:");
    await modal.locator("button.primary", { hasText: /コピー実行/ }).click();
    await expect(modal).toContainText("件コピーしました");

    const switchedTablesRequest = page.waitForRequest((req) =>
      req.url().includes("/api/v1/tables") &&
      req.url().includes("db_name=dest_db") &&
      req.url().includes(`branch_name=${encodeURIComponent(destBranchName)}`)
    );
    await modal.locator("button.primary", { hasText: "宛先に切り替え" }).click();
    await switchedTablesRequest;

    await expect(page.locator(".context-bar select")).toHaveValue(destBranchName);
  });
});
