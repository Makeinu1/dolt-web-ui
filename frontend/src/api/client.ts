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
