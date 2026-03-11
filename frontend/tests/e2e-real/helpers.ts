import { execFileSync } from "node:child_process";
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

async function waitForBranchReady(request: APIRequestContext, dbName: string, branchName: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readyRes = await request.get(`/api/v1/branches/ready?${queryString({
      target_id: TARGET_ID,
      db_name: dbName,
      branch_name: branchName,
    })}`);
    if (readyRes.status() === 200) {
      const body = (await readyRes.json()) as { ready: boolean };
      if (body.ready) {
        return;
      }
    } else if (![404, 409].includes(readyRes.status())) {
      expect(readyRes.ok()).toBeTruthy();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`branch ${branchName} in ${dbName} did not become ready within ${timeoutMs}ms`);
}

export async function ensureBranch(request: APIRequestContext, dbName: string, branchName: string) {
  const branchesRes = await request.get(`/api/v1/branches?${queryString({
    target_id: TARGET_ID,
    db_name: dbName,
  })}`);
  expect(branchesRes.ok()).toBeTruthy();
  const branches = (await branchesRes.json()) as Array<{ name: string }>;
  if (branches.some((branch) => branch.name === branchName)) {
    await waitForBranchReady(request, dbName, branchName);
    return;
  }

  const createRes = await request.post("/api/v1/branches/create", {
    data: {
      target_id: TARGET_ID,
      db_name: dbName,
      branch_name: branchName,
    },
  });
  if (createRes.status() === 201) {
    await waitForBranchReady(request, dbName, branchName);
    return;
  }

  expect(createRes.status()).toBe(409);
  const body = await createRes.json();
  expect(["BRANCH_NOT_READY", "BRANCH_EXISTS"]).toContain(body.error?.code);
  await waitForBranchReady(request, dbName, branchName, body.error?.details?.retry_after_ms ?? 10000);
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

export async function submitApprovalRequest(
  request: APIRequestContext,
  dbName: string,
  branchName: string,
  summaryJa: string,
) {
  const expectedHead = await getHead(request, dbName, branchName);
  const res = await request.post("/api/v1/request/submit", {
    data: {
      target_id: TARGET_ID,
      db_name: dbName,
      branch_name: branchName,
      expected_head: expectedHead,
      summary_ja: summaryJa,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    request_id: string;
    submitted_main_hash: string;
    submitted_work_hash: string;
    outcome: string;
  };
}

export async function approveApprovalRequest(
  request: APIRequestContext,
  dbName: string,
  requestId: string,
  mergeMessageJa: string,
) {
  const res = await request.post("/api/v1/request/approve", {
    data: {
      target_id: TARGET_ID,
      db_name: dbName,
      request_id: requestId,
      merge_message_ja: mergeMessageJa,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as {
    hash: string;
    archive_tag?: string;
    outcome: string;
  };
}

function escapeSQLString(value: string) {
  return value.replace(/'/g, "''");
}

function runDoltSQL(sql: string) {
  execFileSync(
    "dolt",
    [
      "--no-tls",
      "--host",
      "127.0.0.1",
      "--port",
      "13306",
      "sql",
      "-q",
      sql,
    ],
    { stdio: "pipe" },
  );
}

export function deleteTagViaDolt(dbName: string, branchName: string, tagName: string) {
  runDoltSQL(`USE \`${dbName}/${branchName}\`; CALL DOLT_TAG('-d', '${escapeSQLString(tagName)}');`);
}

export function resetCrossCopySchemaWidth(dbName: string, width: number) {
  runDoltSQL(
    `USE \`${dbName}/main\`; ` +
      `ALTER TABLE \`zz_crosscopy_schema\` MODIFY COLUMN \`name\` varchar(${width}) NOT NULL; ` +
      `ALTER TABLE \`zz_crosscopy_schema\` MODIFY COLUMN \`notes\` varchar(${width}) NULL; ` +
      `CALL DOLT_ADD('.'); ` +
      `CALL DOLT_COMMIT('--allow-empty', '-m', '[real e2e] reset zz_crosscopy_schema width to ${width}');`,
  );
}

export async function recreateBranchFromMain(
  request: APIRequestContext,
  dbName: string,
  branchName: string,
  timeoutMs = 10000,
) {
  const branchesRes = await request.get(`/api/v1/branches?${queryString({
    target_id: TARGET_ID,
    db_name: dbName,
  })}`);
  expect(branchesRes.ok()).toBeTruthy();
  const branches = (await branchesRes.json()) as Array<{ name: string }>;
  if (branches.some((branch) => branch.name === branchName)) {
    runDoltSQL(`USE \`${dbName}/main\`; CALL DOLT_BRANCH('-D', '${escapeSQLString(branchName)}');`);
  }
  runDoltSQL(`USE \`${dbName}/main\`; CALL DOLT_BRANCH('${escapeSQLString(branchName)}');`);
  await waitForBranchReady(request, dbName, branchName, timeoutMs);
}

export function testTargetId() {
  return TARGET_ID;
}
