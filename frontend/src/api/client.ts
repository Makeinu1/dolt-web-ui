const API_BASE = "/api/v1";
import { ApiError } from "./errors";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  const method = options?.method ?? "GET";
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      cache: method === "GET" ? "no-store" : options?.cache,
      ...options,
    });
  } catch {
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "サーバーに接続できません" });
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: "INTERNAL",
      message: res.statusText,
    }));
    // Unwrap error envelope: API returns {"error": {"code","message","details"}}
    const err = body.error ?? body;
    throw new ApiError(res.status, err);
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

export const getBranchReady = (targetId: string, dbName: string, branchName: string) =>
  request<import("../types/api").BranchReady>(
    `/branches/ready${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName })}`
  );

export const createBranch = (body: import("../types/api").CreateBranchRequest) =>
  request<{ branch_name: string }>("/branches/create", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteBranch = (body: import("../types/api").DeleteBranchRequest) =>
  request<{ status: string }>("/branches/delete", {
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

// Schema cache is keyed by ref so past-commit browsing and branch-specific schema changes
// do not reuse stale columns from another revision.
const _schemaCache = new Map<string, import("../types/api").SchemaResponse>();

export const getTableSchema = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string
): Promise<import("../types/api").SchemaResponse> => {
  const key = `${targetId}|${dbName}|${branchName}|${table}`;
  const cached = _schemaCache.get(key);
  if (cached) return Promise.resolve(cached);
  return request<import("../types/api").SchemaResponse>(
    `/table/schema${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table })}`
  ).then((schema) => {
    _schemaCache.set(key, schema);
    return schema;
  });
};

/** Invalidate cached schemas for a DB (call after CREATE/DROP TABLE). */
export const invalidateSchemaCache = (targetId: string, dbName: string) => {
  const prefix = `${targetId}|${dbName}|`;
  for (const key of _schemaCache.keys()) {
    if (key.startsWith(prefix)) _schemaCache.delete(key);
  }
};

export const getTableRows = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  page = 1,
  pageSize = 50,
  filter = "",
  sort = "",
  all = false
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
      ...(all ? { all: "true" } : {}),
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
export const previewClone = (
  body: import("../types/api").PreviewCloneRequest,
  signal?: AbortSignal
) =>
  request<import("../types/api").PreviewResponse>("/preview/clone", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });

// Write operations
export const commit = (body: import("../types/api").CommitRequest) =>
  request<import("../types/api").CommitResponse>("/commit", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const syncBranch = (body: import("../types/api").SyncRequest) =>
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
  skinny = false,
  diffType = "",
  page = 1,
  pageSize = 50,
  filter = "",
) =>
  request<import("../types/api").DiffTableResponse>(
    `/diff/table${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      table,
      from_ref: fromRef,
      to_ref: toRef,
      mode,
      skinny: skinny ? "true" : "",
      diff_type: diffType,
      page: String(page),
      page_size: String(pageSize),
      filter,
    })}`
  );

export const getHistoryRow = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  pk: string,
  limit = 30
) =>
  request<import("../types/api").HistoryRowResponse>(
    `/history/row${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      table,
      pk,
      limit: String(limit),
    })}`
  );

export const getHistoryCommits = (
  targetId: string,
  dbName: string,
  branchName: string,
  page = 1,
  pageSize = 20,
  keyword = "",
  fromDate = "",
  toDate = "",
  searchField = "",
  filterTable = "",
  filterPk = ""
) =>
  request<import("../types/api").HistoryCommitsResponse>(
    `/history/commits${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      page: String(page),
      page_size: String(pageSize),
      ...(keyword ? { keyword } : {}),
      ...(fromDate ? { from_date: fromDate } : {}),
      ...(toDate ? { to_date: toDate } : {}),
      ...(searchField ? { search_field: searchField } : {}),
      ...(filterTable ? { filter_table: filterTable } : {}),
      ...(filterPk ? { filter_pk: filterPk } : {}),
    })}`
  );

export const getDiffSummary = (
  targetId: string,
  dbName: string,
  branchName: string,
  fromRef = "main",
  toRef = branchName,
  mode = "three_dot"
) =>
  request<import("../types/api").DiffSummaryResponse>(
    `/diff/summary${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      from_ref: fromRef,
      to_ref: toRef,
      mode,
    })}`
  );

export const getDiffSummaryLight = (
  targetId: string,
  dbName: string,
  branchName: string,
  fromRef = "main",
  toRef = branchName,
  mode = "three_dot"
) =>
  request<import("../types/api").DiffSummaryLightResponse>(
    `/diff/summary/light${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      from_ref: fromRef,
      to_ref: toRef,
      mode,
    })}`
  );

// Requests
export const submitRequest = (body: import("../types/api").SubmitRequestRequest) =>
  request<import("../types/api").SubmitRequestResult>("/request/submit", {
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
  request<import("../types/api").ApproveResult>("/request/approve", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const rejectRequest = (body: import("../types/api").RejectRequest) =>
  request<import("../types/api").RejectResponse>("/request/reject", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Cell Memos
export const getMemoMap = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string
) =>
  request<{ cells: string[] }>(
    `/memo/map${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table })}`
  );

export const getMemo = (
  targetId: string,
  dbName: string,
  branchName: string,
  table: string,
  pk: string,
  column: string
) =>
  request<import("../types/api").MemoResponse>(
    `/memo${queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, table, pk, column })}`
  );

// Cross-DB Copy
export const crossCopyPreview = (body: import("../types/api").CrossCopyPreviewRequest) =>
  request<import("../types/api").CrossCopyPreviewResponse>("/cross-copy/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const crossCopyRows = (body: import("../types/api").CrossCopyRowsRequest) =>
  request<import("../types/api").CrossCopyRowsResult>("/cross-copy/rows", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const crossCopyAdminPrepareRows = (body: import("../types/api").CrossCopyAdminPrepareRowsRequest) =>
  request<import("../types/api").CrossCopyAdminPrepareRowsResult>("/cross-copy/admin/prepare-rows", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const crossCopyTable = (body: import("../types/api").CrossCopyTableRequest) =>
  request<import("../types/api").CrossCopyTableResult>("/cross-copy/table", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const crossCopyAdminPrepareTable = (body: import("../types/api").CrossCopyAdminPrepareTableRequest) =>
  request<import("../types/api").CrossCopyAdminPrepareTableResult>("/cross-copy/admin/prepare-table", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const crossCopyAdminCleanupImport = (body: import("../types/api").CrossCopyAdminCleanupImportRequest) =>
  request<import("../types/api").CrossCopyAdminCleanupImportResult>("/cross-copy/admin/cleanup-import", {
    method: "POST",
    body: JSON.stringify(body),
  });

// CSV Import
export const csvPreview = (body: import("../types/api").CSVPreviewRequest) =>
  request<import("../types/api").CSVPreviewResponse>("/csv/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const csvApply = (body: import("../types/api").CSVApplyRequest) =>
  request<import("../types/api").CSVApplyResponse>("/csv/apply", {
    method: "POST",
    body: JSON.stringify(body),
  });

// Search
export const search = (
  targetId: string,
  dbName: string,
  branchName: string,
  keyword: string,
  includeMemo = false,
  limit = 100,
  tables: string[] = []
) =>
  request<import("../types/api").SearchResultResponse>(
    `/search${queryString({
      target_id: targetId,
      db_name: dbName,
      branch_name: branchName,
      keyword,
      include_memo: includeMemo ? "true" : "",
      limit: String(limit),
      tables: tables.join(","),
    })}`
  );

// Diff ZIP export — returns a Blob (application/zip)
export const exportDiffZip = async (
  targetId: string,
  dbName: string,
  branchName: string,
  fromRef: string,
  toRef: string,
  mode = "three_dot"
): Promise<{ blob: Blob; filename: string; warning?: string }> => {
  const qs = queryString({ target_id: targetId, db_name: dbName, branch_name: branchName, from_ref: fromRef, to_ref: toRef, mode });
  const res = await fetch(`${API_BASE}/diff/export-zip${qs}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ code: "INTERNAL", message: res.statusText }));
    throw new ApiError(res.status, error);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : "diff-export.zip";
  const warning = res.headers.get("X-Diff-Warning") ?? undefined;
  const blob = await res.blob();
  return { blob, filename, warning };
};

// L3-2: Abort stuck merge state
export const mergeAbort = (body: { target_id: string; db_name: string; branch_name: string }) =>
  request<{ status: string }>("/merge/abort", {
    method: "POST",
    body: JSON.stringify(body),
  });
