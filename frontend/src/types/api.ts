// API types matching v6f OpenAPI spec

export interface ErrorResponse {
  code: string;
  message: string;
  details?: unknown;
}

export interface Target {
  id: string;
}

export interface Database {
  name: string;
}

export interface Branch {
  name: string;
  hash: string;
}

export interface Head {
  hash: string;
}

export interface CreateBranchRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
}

export interface Table {
  name: string;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface SchemaResponse {
  table: string;
  columns: ColumnSchema[];
}

export interface RowsResponse {
  rows: Record<string, unknown>[];
  page: number;
  page_size: number;
  total_count: number;
}

export interface CommitOp {
  type: "insert" | "update";
  table: string;
  values: Record<string, unknown>;
  pk?: Record<string, unknown>;
}

export interface CommitRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  expected_head: string;
  commit_message: string;
  ops: CommitOp[];
}

export interface CommitResponse {
  hash: string;
}

export interface SyncRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  expected_head: string;
}

export interface SyncResponse {
  hash: string;
}

export interface DiffRow {
  diff_type: "added" | "modified" | "removed";
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
}

export interface HistoryCommit {
  hash: string;
  author: string;
  message: string;
  timestamp: string;
}

export interface ConflictSummary {
  table: string;
  conflict_count: number;
}

export interface ConflictRow {
  base: Record<string, unknown>;
  ours: Record<string, unknown>;
  theirs: Record<string, unknown>;
}

export interface RequestSummary {
  request_id: string;
  branch_name: string;
  submitted_main_hash: string;
  submitted_work_hash: string;
}
