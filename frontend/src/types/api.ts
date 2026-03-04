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

export interface OverwrittenTable {
  table: string;
  conflicts: number;
}

export interface SyncResponse {
  hash: string;
  overwritten_tables?: OverwrittenTable[];
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

// --- Cell Memos ---

export interface MemoResponse {
  pk_value: string;
  column_name: string;
  memo_text: string;
  updated_at?: string;
}
