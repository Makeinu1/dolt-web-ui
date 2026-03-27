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

export interface BranchReady {
  ready: boolean;
}

export type OperationOutcome = "completed" | "failed" | "retry_required";
export type ReadIntegrity = "complete" | "degraded" | "failed";

export interface RetryAction {
  action: string;
  label: string;
}

export interface OperationResultFields {
  outcome: OperationOutcome;
  message: string;
  completion: Record<string, boolean>;
  warnings?: string[];
  retry_reason?: string;
  retry_actions?: RetryAction[];
}

export interface ReadResultFields {
  read_integrity: ReadIntegrity;
  message?: string;
  retry_actions?: RetryAction[];
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
  client_row_id?: string;
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
  overwritten_tables?: OverwrittenTable[];
}

export interface OverwrittenTable {
  table: string;
  conflicts: number;
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
  merge_branch?: string; // 2a: extracted work branch name for merges_only
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
  overwritten_tables?: OverwrittenTable[];
}
export interface SubmitRequestResult extends SubmitRequestResponse, OperationResultFields {}

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
  active_branch: string;
  active_branch_advanced: boolean;
  archive_tag?: string;
  warnings?: string[];
}
export interface ApproveResult extends ApproveResponse, OperationResultFields {}

export interface PreviewCloneRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  template_pk: Record<string, unknown>;
  /** PK column whose value varies across cloned rows (required for composite PK). */
  vary_column?: string;
  /** New values for vary_column in each cloned row. */
  new_values?: unknown[];
  /** @deprecated Use new_values instead (single-PK backward compat). */
  new_pks?: unknown[];
  change_column?: string;
  change_value?: unknown;
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

export interface DiffTableResponse {
  rows: DiffRow[];
  total_count: number;
  page: number;
  page_size: number;
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

export interface DiffSummaryLightEntry {
  table: string;
  has_data_change: boolean;
  has_schema_change: boolean;
}

export interface DiffSummaryLightResponse {
  changed_table_count: number;
  tables: DiffSummaryLightEntry[];
}

// --- Cross-DB Copy ---

export interface ExpandColumn {
  name: string;
  src_type: string;
  dst_type: string;
}

export interface CrossCopyPreviewRequest {
  target_id: string;
  source_db: string;
  source_branch: string;
  source_table: string;
  source_pks: string[];
  dest_db: string;
  dest_branch: string;
}

export interface CrossCopyPreviewRow {
  source_row: Record<string, unknown>;
  dest_row?: Record<string, unknown>;
  action: "insert" | "update";
}

export interface CrossCopyPreviewResponse {
  shared_columns: string[];
  source_only_columns: string[];
  dest_only_columns: string[];
  warnings: string[];
  rows: CrossCopyPreviewRow[];
  expand_columns?: ExpandColumn[];
}

export interface CrossCopyRowsRequest {
  target_id: string;
  source_db: string;
  source_branch: string;
  source_table: string;
  source_pks: string[];
  dest_db: string;
  dest_branch: string;
}

export interface CrossCopyRowsResponse {
  hash: string;
  inserted: number;
  updated: number;
  total: number;
}
export interface CrossCopyRowsResult extends CrossCopyRowsResponse, OperationResultFields {}

export interface CrossCopyAdminPrepareRowsRequest {
  target_id: string;
  source_db: string;
  source_branch: string;
  source_table: string;
  dest_db: string;
  dest_branch: string;
}

export interface CrossCopyAdminPrepareRowsResponse {
  main_hash: string;
  branch_hash: string;
  prepared_columns: ExpandColumn[];
  overwritten_tables?: OverwrittenTable[];
}
export interface CrossCopyAdminPrepareRowsResult extends CrossCopyAdminPrepareRowsResponse, OperationResultFields {}

export interface CrossCopyTableRequest {
  target_id: string;
  source_db: string;
  source_branch: string;
  source_table: string;
  dest_db: string;
}

export interface CrossCopyTableResponse {
  hash: string;
  branch_name: string;
  row_count: number;
  shared_columns: string[];
  source_only_columns: string[];
  dest_only_columns: string[];
}
export interface CrossCopyTableResult extends CrossCopyTableResponse, OperationResultFields {}

export interface CrossCopyAdminPrepareTableRequest {
  target_id: string;
  source_db: string;
  source_branch: string;
  source_table: string;
  dest_db: string;
}

export interface CrossCopyAdminPrepareTableResponse {
  main_hash: string;
  prepared_columns: ExpandColumn[];
}
export interface CrossCopyAdminPrepareTableResult extends CrossCopyAdminPrepareTableResponse, OperationResultFields {}

export interface CrossCopyAdminCleanupImportRequest {
  target_id: string;
  dest_db: string;
  branch_name: string;
}

export interface CrossCopyAdminCleanupImportResponse {
  branch_name: string;
}
export interface CrossCopyAdminCleanupImportResult extends CrossCopyAdminCleanupImportResponse, OperationResultFields {}

// --- Row History ---

export interface HistoryRowSnapshot {
  commit_hash: string;
  commit_date: string;
  committer: string;
  row: Record<string, unknown>;
}

export interface HistoryRowResponse {
  snapshots: HistoryRowSnapshot[];
}

// --- CSV Import ---

export interface CSVPreviewRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  rows: Record<string, unknown>[];
}

export interface CSVDiffRow {
  action: "insert" | "update";
  row: Record<string, unknown>;
  old_row?: Record<string, unknown>;
}

export interface CSVPreviewError {
  row_index: number;
  message: string;
}

export interface CSVPreviewResponse {
  inserts: number;
  updates: number;
  skips: number;
  errors: number;
  sample_diffs: CSVDiffRow[];
  preview_errors?: CSVPreviewError[];
}

export interface CSVApplyRequest {
  target_id: string;
  db_name: string;
  branch_name: string;
  table: string;
  expected_head: string;
  commit_message: string;
  rows: Record<string, unknown>[];
}

export interface CSVApplyResponse extends OperationResultFields {
  hash: string;
}

// --- Search ---

export interface SearchResult {
  table: string;
  pk: string;
  column: string;
  value: string;
  match_type: "value" | "memo";
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}
export interface SearchResultResponse extends SearchResponse, ReadResultFields {}

export interface HistoryCommitsResponse extends ReadResultFields {
  commits: HistoryCommit[];
}

export interface RejectResponse extends OperationResultFields {
  status: string;
}

// --- Cell Memos ---

export interface MemoResponse {
  pk_value: string;
  column_name: string;
  memo_text: string;
  updated_at?: string;
}
