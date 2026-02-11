const API_BASE = "/api/v1";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({
      code: "INTERNAL",
      message: res.statusText,
    }));
    throw error;
  }

  return res.json();
}

function queryString(params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries).toString();
}

// Metadata
export const getTargets = () => request<import("../types/api").Target[]>("/targets");

export const getDatabases = (targetId: string) =>
  request<import("../types/api").Database[]>(`/databases${queryString({ target_id: targetId })}`);

export const getBranches = (targetId: string, dbName: string) =>
  request<import("../types/api").Branch[]>(
    `/branches${queryString({ target_id: targetId, db_name: dbName })}`
  );

export const createBranch = (body: import("../types/api").CreateBranchRequest) =>
  request<{ branch_name: string }>("/branches/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getHead = (targetId: string, dbName: string, branchName: string) =>
  request<import("../types/api").Head>(
    `/head${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName })}`
  );

// Tables
export const getTables = (targetId: string, dbName: string, branchName: string) =>
  request<import("../types/api").Table[]>(
    `/tables${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName })}`
  );

export const getTableSchema = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string
) =>
  request<import("../types/api").SchemaResponse>(
    `/table/schema${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table })}`
  );

export const getTableRows = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  page = 1,
  pageSize = 50,
  filter = "",
  sort = ""
) =>
  request<import("../types/api").RowsResponse>(
    `/table/rows${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      table,
      page: String(page),
      page_size: String(pageSize),
      filter,
      sort,
    })}`
  );

export const getTableRow = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  pk: string
) =>
  request<Record<string, unknown>>(
    `/table/row${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table, pk })}`
  );

// Preview operations
export const previewClone = (body: import("../types/api").PreviewCloneRequest) =>
  request<import("../types/api").PreviewResponse>("/preview/clone", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const previewBatchGenerate = (body: import("../types/api").PreviewBatchGenerateRequest) =>
  request<import("../types/api").PreviewResponse>("/preview/batch_generate", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const previewBulkUpdate = (body: import("../types/api").PreviewBulkUpdateRequest) =>
  request<import("../types/api").PreviewResponse>("/preview/bulk_update", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Write operations
export const commit = (body: import("../types/api").CommitRequest) =>
  request<import("../types/api").CommitResponse>("/commit", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const sync = (body: import("../types/api").SyncRequest) =>
  request<import("../types/api").SyncResponse>("/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Diff & History
export const getDiffTable = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  fromRef: string,
  toRef: string,
  mode = "two_dot",
  skinny = false
) =>
  request<import("../types/api").DiffResponse>(
    `/diff/table${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      table,
      from_ref: fromRef,
      to_ref: toRef,
      mode,
      skinny: skinny ? "true" : "",
    })}`
  );

export const getHistoryCommits = (
  targetId: string,
  dbName: string,
  branchName: string,
  page = 1,
  pageSize = 20
) =>
  request<import("../types/api").HistoryCommit[]>(
    `/history/commits${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      page: String(page),
      page_size: String(pageSize),
    })}`
  );

export const getHistoryRow = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  pk: string,
  limit = 20
) =>
  request<Record<string, unknown>[]>(
    `/history/row${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      table,
      pk,
      limit: String(limit),
    })}`
  );

// Conflicts
export const getConflicts = (targetId: string, dbName: string, branchName: string) =>
  request<import("../types/api").ConflictsSummaryEntry[]>(
    `/conflicts${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName })}`
  );

export const getConflictsTable = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string
) =>
  request<import("../types/api").ConflictRow[]>(
    `/conflicts/table${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table })}`
  );

export const resolveConflicts = (body: import("../types/api").ResolveConflictsRequest) =>
  request<import("../types/api").CommitResponse>("/conflicts/resolve", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Requests
export const submitRequest = (body: import("../types/api").SubmitRequestRequest) =>
  request<import("../types/api").SubmitRequestResponse>("/request/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const listRequests = (targetId: string, dbName: string) =>
  request<import("../types/api").RequestSummary[]>(
    `/requests${queryString({ target_id: targetId, db_name: dbName })}`
  );

export const getRequest = (targetId: string, dbName: string, requestId: string) =>
  request<import("../types/api").RequestSummary>(
    `/request${queryString({ target_id: targetId, db_name: dbName, request_id: requestId })}`
  );

export const approveRequest = (body: import("../types/api").ApproveRequest) =>
  request<import("../types/api").ApproveResponse>("/request/approve", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const rejectRequest = (body: import("../types/api").RejectRequest) =>
  request<{ status: string }>("/request/reject", {
    method: "POST",
    body: JSON.stringify(body),
  });
