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
	CodeForbidden                   = "FORBIDDEN"
	CodeNotFound                    = "NOT_FOUND"
	CodeStaleHead                   = "STALE_HEAD"
	CodeMergeConflictsPresent       = "MERGE_CONFLICTS_PRESENT"
	CodeSchemaConflictsPresent      = "SCHEMA_CONFLICTS_PRESENT"
	CodeConstraintViolationsPresent = "CONSTRAINT_VIOLATIONS_PRESENT"
	CodePreconditionFailed          = "PRECONDITION_FAILED"
	CodeInternal                    = "INTERNAL"
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

// SyncResponse represents the result of a sync.
type SyncResponse struct {
	Hash string `json:"hash"`
}

// DiffRow represents a single diff row.
type DiffRow struct {
	DiffType string                 `json:"diff_type"` // "added", "modified", "removed"
	From     map[string]interface{} `json:"from,omitempty"`
	To       map[string]interface{} `json:"to,omitempty"`
}

// DiffResponse represents a table diff.
type DiffResponse struct {
	Rows []DiffRow `json:"rows"`
}

// HistoryCommit represents a commit in history.
type HistoryCommit struct {
	Hash      string `json:"hash"`
	Author    string `json:"author"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

// ConflictSummary represents a table with conflicts.
type ConflictSummary struct {
	Table         string `json:"table"`
	ConflictCount int    `json:"conflict_count"`
}

// ConflictRow represents a single conflict.
type ConflictRow struct {
	Base   map[string]interface{} `json:"base"`
	Ours   map[string]interface{} `json:"ours"`
	Theirs map[string]interface{} `json:"theirs"`
}

// ResolveConflictsRequest represents a request to resolve conflicts.
type ResolveConflictsRequest struct {
	TargetID     string `json:"target_id"`
	DBName       string `json:"db_name"`
	BranchName   string `json:"branch_name"`
	ExpectedHead string `json:"expected_head"`
	Table        string `json:"table"`
	Strategy     string `json:"strategy"` // "ours" or "theirs"
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
	RequestID         string `json:"request_id"`
	SubmittedMainHash string `json:"submitted_main_hash"`
	SubmittedWorkHash string `json:"submitted_work_hash"`
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
	TargetID     string                 `json:"target_id"`
	DBName       string                 `json:"db_name"`
	BranchName   string                 `json:"branch_name"`
	Table        string                 `json:"table"`
	TemplatePK   map[string]interface{} `json:"template_pk"`
	NewPKs       []interface{}          `json:"new_pks"`
	ChangeColumn string                 `json:"change_column,omitempty"`
	ChangeValue  interface{}            `json:"change_value,omitempty"`
}

// PreviewBatchGenerateRequest represents a batch generate preview request.
type PreviewBatchGenerateRequest struct {
	TargetID     string                 `json:"target_id"`
	DBName       string                 `json:"db_name"`
	BranchName   string                 `json:"branch_name"`
	Table        string                 `json:"table"`
	TemplatePK   map[string]interface{} `json:"template_pk"`
	NewPKs       []interface{}          `json:"new_pks"`
	ChangeColumn string                 `json:"change_column,omitempty"`
	ChangeValues []interface{}          `json:"change_values,omitempty"`
}

// PreviewBulkUpdateRequest represents a bulk update preview request.
type PreviewBulkUpdateRequest struct {
	TargetID   string `json:"target_id"`
	DBName     string `json:"db_name"`
	BranchName string `json:"branch_name"`
	Table      string `json:"table"`
	TSVData    string `json:"tsv_data"`
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
	Hash       string `json:"hash"`
	NextBranch string `json:"next_branch"` // Auto-created next round branch (e.g., "wi/ProjectA/02")
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

// ConflictsSummaryEntry represents a table's conflict summary from preview.
// Dolt v1.x: DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY returns (table, num_data_conflicts, num_schema_conflicts).
type ConflictsSummaryEntry struct {
	Table           string `json:"table"`
	DataConflicts   int    `json:"data_conflicts"`
	SchemaConflicts int    `json:"schema_conflicts"`
}
