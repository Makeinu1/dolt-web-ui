import { expect, type APIRequestContext, type Page } from "@playwright/test";

const TARGET_ID = "local";

function queryString(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

export async function selectContext(page: Page, dbName: string, branchName: string) {
  await page.goto("/");

  const setupBtn = page.getByTitle("設定 (ターゲット / データベース)");
  await expect(setupBtn).toBeVisible();
  await setupBtn.click();

  const modal = page.locator(".modal");
  await expect(modal).toBeVisible();
  await modal.locator("select").first().selectOption(TARGET_ID);
  await modal.locator("select").nth(1).selectOption(dbName);
  await modal.locator("button", { hasText: "閉じる" }).click();
  await expect(modal).not.toBeVisible();

  const branchSelect = page.locator(".context-bar select");
  await expect(branchSelect).toBeVisible();
  await branchSelect.selectOption(branchName);
  await expect(branchSelect).toHaveValue(branchName);
}

export async function createWorkBranchFromUI(page: Page, workItem: string) {
  const branchName = `wi/${workItem}`;
  const contextBar = page.locator(".context-bar");
  await contextBar.locator("button", { hasText: "+" }).click();

  const input = contextBar.locator('input[placeholder="ticket-123"]');
  await expect(input).toBeVisible();
  await input.fill(workItem);
  await contextBar.locator("button", { hasText: "作成" }).first().click();

  await expect(page.locator(".context-bar select")).toHaveValue(branchName);
  return branchName;
}

export async function ensureBranch(request: APIRequestContext, dbName: string, branchName: string) {
  const branchesRes = await request.get(`/api/v1/branches?${queryString({
    target_id: TARGET_ID,
    db_name: dbName,
  })}`);
  expect(branchesRes.ok()).toBeTruthy();
  const branches = (await branchesRes.json()) as Array<{ name: string }>;
  if (branches.some((branch) => branch.name === branchName)) {
    return;
  }

  const createRes = await request.post("/api/v1/branches/create", {
    data: {
      target_id: TARGET_ID,
      db_name: dbName,
      branch_name: branchName,
    },
  });
  expect(createRes.ok()).toBeTruthy();
}

export async function getHead(request: APIRequestContext, dbName: string, branchName: string) {
  const headRes = await request.get(`/api/v1/head?${queryString({
    target_id: TARGET_ID,
    db_name: dbName,
    branch_name: branchName,
  })}`);
  expect(headRes.ok()).toBeTruthy();
  const head = (await headRes.json()) as { hash: string };
  return head.hash;
}

export async function commitUserRoleChange(
  request: APIRequestContext,
  dbName: string,
  branchName: string,
  role: string,
  commitMessage: string,
) {
  const expectedHead = await getHead(request, dbName, branchName);
  const commitRes = await request.post("/api/v1/commit", {
    data: {
      target_id: TARGET_ID,
      db_name: dbName,
      branch_name: branchName,
      expected_head: expectedHead,
      commit_message: commitMessage,
      ops: [
        {
          type: "update",
          table: "users",
          pk: { id: 1 },
          values: { role },
        },
      ],
    },
  });
  expect(commitRes.ok()).toBeTruthy();
  const body = (await commitRes.json()) as { hash: string };
  return body.hash;
}

export async function listRequests(request: APIRequestContext, dbName: string) {
  const res = await request.get(`/api/v1/requests?${queryString({
    target_id: TARGET_ID,
    db_name: dbName,
  })}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Array<{ request_id: string; work_branch: string }>;
}

export function testTargetId() {
  return TARGET_ID;
}
