package model

// ErrorResponse represents the standard API error response per v6f spec.
type ErrorResponse struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// Error codes per v6f error spec.
const (
	CodeInvalidArgument            = "INVALID_ARGUMENT"
	CodeForbidden                  = "FORBIDDEN"
	CodeNotFound                   = "NOT_FOUND"
	CodeStaleHead                  = "STALE_HEAD"
	CodeMergeConflictsPresent      = "MERGE_CONFLICTS_PRESENT"
	CodeSchemaConflictsPresent     = "SCHEMA_CONFLICTS_PRESENT"
	CodeConstraintViolationsPresent = "CONSTRAINT_VIOLATIONS_PRESENT"
	CodePreconditionFailed         = "PRECONDITION_FAILED"
	CodeInternal                   = "INTERNAL"
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
	TargetID      string      `json:"target_id"`
	DBName        string      `json:"db_name"`
	BranchName    string      `json:"branch_name"`
	ExpectedHead  string      `json:"expected_head"`
	CommitMessage string      `json:"commit_message"`
	Ops           []CommitOp  `json:"ops"`
}

// CommitOp represents a single insert or update operation.
type CommitOp struct {
	Type   string                 `json:"type"` // "insert" or "update"
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
	Table        string `json:"table"`
	ConflictCount int   `json:"conflict_count"`
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
	TargetID   string `json:"target_id"`
	DBName     string `json:"db_name"`
	BranchName string `json:"branch_name"`
	RequestID  string `json:"request_id"`
}

// RequestSummary represents a pending approval request.
type RequestSummary struct {
	RequestID         string `json:"request_id"`
	BranchName        string `json:"branch_name"`
	SubmittedMainHash string `json:"submitted_main_hash"`
	SubmittedWorkHash string `json:"submitted_work_hash"`
}

// ApproveRequest represents an approval action.
type ApproveRequest struct {
	TargetID  string `json:"target_id"`
	DBName    string `json:"db_name"`
	RequestID string `json:"request_id"`
}

// RejectRequest represents a rejection action.
type RejectRequest struct {
	TargetID  string `json:"target_id"`
	DBName    string `json:"db_name"`
	RequestID string `json:"request_id"`
}
