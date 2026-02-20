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

export interface DeleteBranchRequest {
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
  type: "insert" | "update" | "delete";
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

export interface ConflictsSummaryEntry {
  table: string;
  schema_conflicts: number;
  data_conflicts: number;
  constraint_violations: number;
}

export interface ConflictRow {
  base: Record<string, unknown>;
  ours: Record<string, unknown>;
  theirs: Record<string, unknown>;
}

export interface ResolveConflictsRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  expected_head: string;
  table: string;
  strategy: "ours" | "theirs";
}

export interface SubmitRequestRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  expected_head: string;
  summary_ja: string;
}

export interface SubmitRequestResponse {
  request_id: string;
  submitted_main_hash: string;
  submitted_work_hash: string;
}

export interface RequestSummary {
  request_id: string;
  work_branch: string;
  submitted_main_hash: string;
  submitted_work_hash: string;
  summary_ja: string;
  submitted_at?: string;
}

export interface ApproveRequest {
  target_id: string;
  db_name: string;
  request_id: string;
  merge_message_ja: string;
}

export interface RejectRequest {
  target_id: string;
  db_name: string;
  request_id: string;
}

export interface ApproveResponse {
  hash: string;
  next_branch: string; // Auto-created next round branch (e.g., "wi/ProjectA/02")
}

export interface PreviewCloneRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  template_pk: Record<string, unknown>;
  new_pks: unknown[];
  change_column?: string;
  change_value?: unknown;
}

export interface PreviewBatchGenerateRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  template_pk: Record<string, unknown>;
  new_pks: unknown[];
  change_column?: string;
  change_values?: unknown[];
}

export interface PreviewBulkUpdateRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  tsv_data: string;
}

export interface PreviewError {
  row_index: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface PreviewResponse {
  ops: CommitOp[];
  warnings: string[];
  errors: PreviewError[];
}

export interface DiffResponse {
  rows: DiffRow[];
}

export interface DiffSummaryEntry {
  table: string;
  added: number;
  modified: number;
  removed: number;
}

export interface DiffSummaryResponse {
  entries: DiffSummaryEntry[];
}
