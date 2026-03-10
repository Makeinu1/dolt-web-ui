package model

// ErrorEnvelope wraps ErrorDetail in {"error": {...}} per v6f spec section 0.2.
type ErrorEnvelope struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail represents the error detail inside the envelope.
type ErrorDetail struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// NewError creates an ErrorEnvelope for API responses.
func NewError(code, message string, details interface{}) ErrorEnvelope {
	return ErrorEnvelope{
		Error: ErrorDetail{Code: code, Message: message, Details: details},
	}
}

// Error codes per v6f error spec.
const (
	CodeInvalidArgument             = "INVALID_ARGUMENT"
	CodePKCollision                 = "PK_COLLISION"
	CodeForbidden                   = "FORBIDDEN"
	CodeNotFound                    = "NOT_FOUND"
	CodeStaleHead                   = "STALE_HEAD"
	CodeMergeConflictsPresent       = "MERGE_CONFLICTS_PRESENT"
	CodeSchemaConflictsPresent      = "SCHEMA_CONFLICTS_PRESENT"
	CodeConstraintViolationsPresent = "CONSTRAINT_VIOLATIONS_PRESENT"
	CodePreconditionFailed          = "PRECONDITION_FAILED"
	CodeBranchLocked                = "BRANCH_LOCKED"
	CodeBranchExists                = "BRANCH_EXISTS"
	CodeBranchNotReady              = "BRANCH_NOT_READY"
	CodeInternal                    = "INTERNAL"
	CodeCopyDataError               = "COPY_DATA_ERROR"
	CodeCopyFKError                 = "COPY_FK_ERROR"
)

// TargetResponse represents a Dolt target.
type TargetResponse struct {
	ID string `json:"id"`
}

// DatabaseResponse represents an allowed database.
type DatabaseResponse struct {
	Name string `json:"name"`
}

// BranchResponse represents a branch.
type BranchResponse struct {
	Name string `json:"name"`
	Hash string `json:"hash"`
}

// HeadResponse represents the current HEAD hash.
type HeadResponse struct {
	Hash string `json:"hash"`
}

// CreateBranchRequest represents a request to create a work branch.
type CreateBranchRequest struct {
	TargetID   string `json:"target_id"`
	DBName     string `json:"db_name"`
	BranchName string `json:"branch_name"`
}

// DeleteBranchRequest represents a request to delete a work branch.
type DeleteBranchRequest struct {
	TargetID   string `json:"target_id"`
	DBName     string `json:"db_name"`
	BranchName string `json:"branch_name"`
}

// TableResponse represents a table name.
type TableResponse struct {
	Name string `json:"name"`
}

// ColumnSchema represents a column's schema information.
type ColumnSchema struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primary_key"`
}

// SchemaResponse represents a table's schema.
type SchemaResponse struct {
	Table   string         `json:"table"`
	Columns []ColumnSchema `json:"columns"`
}

// RowsResponse represents paginated rows.
type RowsResponse struct {
	Rows       []map[string]interface{} `json:"rows"`
	Page       int                      `json:"page"`
	PageSize   int                      `json:"page_size"`
	TotalCount int                      `json:"total_count"`
}

// CommitRequest represents a commit operation.
type CommitRequest struct {
	TargetID      string     `json:"target_id"`
	DBName        string     `json:"db_name"`
	BranchName    string     `json:"branch_name"`
	ExpectedHead  string     `json:"expected_head"`
	CommitMessage string     `json:"commit_message"`
	Ops           []CommitOp `json:"ops"`
}

// CommitOp represents a single insert, update, or delete operation.
type CommitOp struct {
	Type   string                 `json:"type"` // "insert", "update", or "delete"
	Table  string                 `json:"table"`
	Values map[string]interface{} `json:"values"`
	PK     map[string]interface{} `json:"pk,omitempty"` // for update only
}

// CommitResponse represents the result of a commit.
type CommitResponse struct {
	Hash string `json:"hash"`
}

// SyncRequest represents a sync (merge main → work) operation.
type SyncRequest struct {
	TargetID     string `json:"target_id"`
	DBName       string `json:"db_name"`
	BranchName   string `json:"branch_name"`
	ExpectedHead string `json:"expected_head"`
}

// OverwrittenTable describes a table in which main overwrote local changes during auto-resolution.
type OverwrittenTable struct {
	Table     string `json:"table"`
	Conflicts int    `json:"conflicts"`
}

// SyncResponse represents the result of a sync.
type SyncResponse struct {
	Hash              string             `json:"hash"`
	OverwrittenTables []OverwrittenTable `json:"overwritten_tables,omitempty"`
}

// DiffRow represents a single diff row.
type DiffRow struct {
	DiffType string                 `json:"diff_type"` // "added", "modified", "removed"
	From     map[string]interface{} `json:"from,omitempty"`
	To       map[string]interface{} `json:"to,omitempty"`
}

// DiffResponse represents a table diff (legacy, full dump).
type DiffResponse struct {
	Rows []DiffRow `json:"rows"`
}

// DiffTableResponse represents a paginated table diff.
type DiffTableResponse struct {
	Rows       []DiffRow `json:"rows"`
	TotalCount int       `json:"total_count"`
	Page       int       `json:"page"`
	PageSize   int       `json:"page_size"`
}

// HistoryCommit represents a commit in history.
type HistoryCommit struct {
	Hash        string `json:"hash"`
	Author      string `json:"author"`
	Message     string `json:"message"`
	Timestamp   string `json:"timestamp"`
	MergeBranch string `json:"merge_branch,omitempty"` // 2a: work branch merged into main (merges_only filter)
}

// SubmitRequestRequest represents a request submission for approval.
type SubmitRequestRequest struct {
	TargetID     string `json:"target_id"`
	DBName       string `json:"db_name"`
	BranchName   string `json:"branch_name"`
	ExpectedHead string `json:"expected_head"`
	SummaryJa    string `json:"summary_ja"`
}

// SubmitRequestResponse represents the result of a request submission.
type SubmitRequestResponse struct {
	RequestID         string             `json:"request_id"`
	SubmittedMainHash string             `json:"submitted_main_hash"`
	SubmittedWorkHash string             `json:"submitted_work_hash"`
	OverwrittenTables []OverwrittenTable `json:"overwritten_tables,omitempty"`
}

// RequestSummary represents a pending approval request.
type RequestSummary struct {
	RequestID         string `json:"request_id"`
	WorkBranch        string `json:"work_branch"`
	SubmittedMainHash string `json:"submitted_main_hash"`
	SubmittedWorkHash string `json:"submitted_work_hash"`
	SummaryJa         string `json:"summary_ja"`
	SubmittedAt       string `json:"submitted_at,omitempty"`
}

// ApproveRequest represents an approval action.
type ApproveRequest struct {
	TargetID       string `json:"target_id"`
	DBName         string `json:"db_name"`
	RequestID      string `json:"request_id"`
	MergeMessageJa string `json:"merge_message_ja"`
}

// RejectRequest represents a rejection action.
type RejectRequest struct {
	TargetID  string `json:"target_id"`
	DBName    string `json:"db_name"`
	RequestID string `json:"request_id"`
}

// APIError is a typed error that handlers can map to specific HTTP responses.
type APIError struct {
	Status  int
	Code    string
	Msg     string
	Details interface{}
}

func (e *APIError) Error() string {
	return e.Msg
}

// FilterCondition represents a single filter in /table/rows.
// Per v6f spec: eq, contains, in operators only, combined with AND.
type FilterCondition struct {
	Column string      `json:"column"`
	Op     string      `json:"op"` // "eq", "contains", "in"
	Value  interface{} `json:"value"`
}

// PreviewCloneRequest represents a clone preview request.
type PreviewCloneRequest struct {
	TargetID   string                 `json:"target_id"`
	DBName     string                 `json:"db_name"`
	BranchName string                 `json:"branch_name"`
	Table      string                 `json:"table"`
	TemplatePK map[string]interface{} `json:"template_pk"`
	// VaryColumn: the PK column whose value varies across cloned rows.
	// For single-PK tables this can be omitted (auto-detected).
	VaryColumn string `json:"vary_column,omitempty"`
	// NewValues: the new values for VaryColumn in each cloned row.
	NewValues []interface{} `json:"new_values,omitempty"`
	// NewPKs is a deprecated alias for NewValues (single-PK backward compat).
	NewPKs       []interface{} `json:"new_pks,omitempty"`
	ChangeColumn string        `json:"change_column,omitempty"`
	ChangeValue  interface{}   `json:"change_value,omitempty"`
}

// PreviewError represents an error for a specific row in preview.
type PreviewError struct {
	RowIndex int         `json:"row_index"`
	Code     string      `json:"code"`
	Message  string      `json:"message"`
	Details  interface{} `json:"details,omitempty"`
}

// PreviewResponse represents the result of a preview operation.
type PreviewResponse struct {
	Ops      []CommitOp     `json:"ops"`
	Warnings []string       `json:"warnings"`
	Errors   []PreviewError `json:"errors"`
}

// ApproveResponse represents the result of an approval.
type ApproveResponse struct {
	Hash                 string   `json:"hash"`
	ActiveBranch         string   `json:"active_branch"`
	ActiveBranchAdvanced bool     `json:"active_branch_advanced"`
	ArchiveTag           string   `json:"archive_tag,omitempty"`
	Warnings             []string `json:"warnings,omitempty"`
}

// DiffSummaryEntry represents the row-count diff for one table.
type DiffSummaryEntry struct {
	Table    string `json:"table"`
	Added    int    `json:"added"`
	Modified int    `json:"modified"`
	Removed  int    `json:"removed"`
}

// DiffSummaryResponse is the full response for GET /diff/summary.
type DiffSummaryResponse struct {
	Entries []DiffSummaryEntry `json:"entries"`
}

// --- Row History ---

// HistoryRowSnapshot represents a single historical snapshot of a row.
type HistoryRowSnapshot struct {
	CommitHash string                 `json:"commit_hash"`
	CommitDate string                 `json:"commit_date"`
	Committer  string                 `json:"committer"`
	Row        map[string]interface{} `json:"row"`
}

// HistoryRowResponse is the response for GET /history/row.
type HistoryRowResponse struct {
	Snapshots []HistoryRowSnapshot `json:"snapshots"`
}

// --- Cell Memos ---

// MemoResponse represents a single cell memo (1 per cell).
// memo_text is empty string when no memo exists for the cell.
type MemoResponse struct {
	PkValue    string `json:"pk_value"`
	ColumnName string `json:"column_name"`
	MemoText   string `json:"memo_text"`
	UpdatedAt  string `json:"updated_at,omitempty"`
}

// --- Cross-DB Copy ---

// CrossCopyPreviewRequest represents a request to preview cross-DB row copy.
type CrossCopyPreviewRequest struct {
	TargetID     string   `json:"target_id"`
	SourceDB     string   `json:"source_db"`
	SourceBranch string   `json:"source_branch"`
	SourceTable  string   `json:"source_table"`
	SourcePKs    []string `json:"source_pks"`
	DestDB       string   `json:"dest_db"`
	DestBranch   string   `json:"dest_branch"`
}

// CrossCopyPreviewRow represents one row in the cross-copy preview.
type CrossCopyPreviewRow struct {
	SourceRow map[string]interface{} `json:"source_row"`
	DestRow   map[string]interface{} `json:"dest_row,omitempty"`
	Action    string                 `json:"action"` // "insert" or "update"
}

// ExpandColumn describes a string-type column in dest that must be widened to fit source data.
type ExpandColumn struct {
	Name    string `json:"name"`
	SrcType string `json:"src_type"`
	DstType string `json:"dst_type"`
}

// CrossCopyPreviewResponse represents the result of a cross-copy preview.
type CrossCopyPreviewResponse struct {
	SharedColumns  []string              `json:"shared_columns"`
	SourceOnlyCols []string              `json:"source_only_columns"`
	DestOnlyCols   []string              `json:"dest_only_columns"`
	Warnings       []string              `json:"warnings"`
	Rows           []CrossCopyPreviewRow `json:"rows"`
	ExpandColumns  []ExpandColumn        `json:"expand_columns,omitempty"`
}

// CrossCopyRowsRequest represents a request to copy rows across databases.
type CrossCopyRowsRequest struct {
	TargetID     string   `json:"target_id"`
	SourceDB     string   `json:"source_db"`
	SourceBranch string   `json:"source_branch"`
	SourceTable  string   `json:"source_table"`
	SourcePKs    []string `json:"source_pks"`
	DestDB       string   `json:"dest_db"`
	DestBranch   string   `json:"dest_branch"`
}

// CrossCopyRowsResponse represents the result of a cross-DB row copy.
type CrossCopyRowsResponse struct {
	Hash     string `json:"hash"`
	Inserted int    `json:"inserted"`
	Updated  int    `json:"updated"`
	Total    int    `json:"total"`
}

// CrossCopyTableRequest represents a request to copy an entire table across databases.
type CrossCopyTableRequest struct {
	TargetID     string `json:"target_id"`
	SourceDB     string `json:"source_db"`
	SourceBranch string `json:"source_branch"`
	SourceTable  string `json:"source_table"`
	DestDB       string `json:"dest_db"`
}

// CrossCopyTableResponse represents the result of a cross-DB table copy.
type CrossCopyTableResponse struct {
	Hash           string   `json:"hash"`
	BranchName     string   `json:"branch_name"`
	RowCount       int      `json:"row_count"`
	SharedColumns  []string `json:"shared_columns"`
	SourceOnlyCols []string `json:"source_only_columns"`
	DestOnlyCols   []string `json:"dest_only_columns"`
}

// --- CSV Import ---

// CSVPreviewRequest represents a CSV preview request.
type CSVPreviewRequest struct {
	TargetID   string                   `json:"target_id"`
	DBName     string                   `json:"db_name"`
	BranchName string                   `json:"branch_name"`
	Table      string                   `json:"table"`
	Rows       []map[string]interface{} `json:"rows"`
}

// CSVDiffRow represents a single row in the CSV diff preview.
type CSVDiffRow struct {
	Action string                 `json:"action"` // "insert" or "update"
	Row    map[string]interface{} `json:"row"`
	OldRow map[string]interface{} `json:"old_row,omitempty"`
}

// CSVPreviewError represents an error for a specific CSV row.
type CSVPreviewError struct {
	RowIndex int    `json:"row_index"`
	Message  string `json:"message"`
}

// CSVPreviewResponse represents the result of a CSV preview.
type CSVPreviewResponse struct {
	Inserts       int               `json:"inserts"`
	Updates       int               `json:"updates"`
	Skips         int               `json:"skips"`
	Errors        int               `json:"errors"`
	SampleDiffs   []CSVDiffRow      `json:"sample_diffs"`
	PreviewErrors []CSVPreviewError `json:"preview_errors,omitempty"`
}

// CSVApplyRequest represents a request to apply CSV data.
type CSVApplyRequest struct {
	TargetID      string                   `json:"target_id"`
	DBName        string                   `json:"db_name"`
	BranchName    string                   `json:"branch_name"`
	Table         string                   `json:"table"`
	ExpectedHead  string                   `json:"expected_head"`
	CommitMessage string                   `json:"commit_message"`
	Rows          []map[string]interface{} `json:"rows"`
}

// --- Search ---

// SearchResult represents a single search hit.
type SearchResult struct {
	Table     string `json:"table"`
	PK        string `json:"pk"`
	Column    string `json:"column"`
	Value     string `json:"value"`
	MatchType string `json:"match_type"` // "value" or "memo"
}

// SearchResponse represents the result of a full-table search.
type SearchResponse struct {
	Results []SearchResult `json:"results"`
	Total   int            `json:"total"`
}
