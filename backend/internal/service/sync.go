package service

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// Sync merges main → work branch with two-stage conflict detection.
// Per v6f spec section 7.1:
//  1. Preview (check for data/schema conflicts before merge)
//  2. Merge (AUTOCOMMIT=1)
//  3. If merge fails (conflicts>0), re-run preview to distinguish conflict types
func (s *Service) Sync(ctx context.Context, req model.SyncRequest) (*model.SyncResponse, error) {
	if validation.IsMainBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "sync on main branch is forbidden"}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Step 0: expected_head check
	var currentHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		return nil, fmt.Errorf("failed to get HEAD: %w", err)
	}
	if currentHead != req.ExpectedHead {
		return nil, &model.APIError{
			Status:  409,
			Code:    model.CodeStaleHead,
			Msg:     "expected_head mismatch",
			Details: map[string]string{"expected_head": req.ExpectedHead, "actual_head": currentHead},
		}
	}

	// Step 1: Preview (mandatory pre-check)
	if apiErr := s.previewMergeConflicts(ctx, conn, req.BranchName); apiErr != nil {
		return nil, apiErr
	}

	// Step 2: Ensure AUTOCOMMIT=1 and merge
	if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
		return nil, fmt.Errorf("failed to set autocommit: %w", err)
	}
	// Reset autocommit when connection returns to pool to prevent pool pollution.
	defer conn.ExecContext(ctx, "SET autocommit=0")

	var mergeHash string
	var fastForward, mergeConflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('main')").Scan(&mergeHash, &fastForward, &mergeConflicts, &mergeMessage)
	if err != nil {
		return nil, fmt.Errorf("failed to merge: %w", err)
	}

	if mergeConflicts > 0 {
		// Step 3: Re-run preview to distinguish conflict types (two-stage detection)
		if apiErr := s.previewMergeConflicts(ctx, conn, req.BranchName); apiErr != nil {
			return nil, apiErr
		}
		// If preview found no data/schema conflicts, it's constraint violations
		return nil, &model.APIError{
			Status: 409,
			Code:   model.CodeConstraintViolationsPresent,
			Msg:    "constraint violations detected after merge",
			Details: map[string]string{
				"hint": "Constraint violations must be resolved via CLI.",
			},
		}
	}

	// Success: get new HEAD
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.SyncResponse{Hash: newHead}, nil
}

// previewMergeConflicts runs DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY and returns
// an *APIError if conflicts are detected, or nil if clean.
func (s *Service) previewMergeConflicts(ctx context.Context, conn *sql.Conn, branchName string) *model.APIError {
	query := fmt.Sprintf("SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('%s', 'main')", branchName)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return &model.APIError{Status: 500, Code: model.CodeInternal, Msg: fmt.Sprintf("failed to preview merge: %v", err)}
	}
	defer rows.Close()

	// Dolt v1.x: DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY returns 3 columns:
	// (table, num_data_conflicts, num_schema_conflicts)
	for rows.Next() {
		var tableName string
		var dataConflicts, schemaConflicts int
		if err := rows.Scan(&tableName, &dataConflicts, &schemaConflicts); err != nil {
			return &model.APIError{Status: 500, Code: model.CodeInternal, Msg: fmt.Sprintf("failed to scan preview: %v", err)}
		}
		if schemaConflicts > 0 {
			return &model.APIError{
				Status:  409,
				Code:    model.CodeSchemaConflictsPresent,
				Msg:     "schema conflicts detected",
				Details: map[string]interface{}{"tables": []string{tableName}, "hint": "Schema conflicts must be resolved via CLI."},
			}
		}
		if dataConflicts > 0 {
			return &model.APIError{
				Status:  409,
				Code:    model.CodeMergeConflictsPresent,
				Msg:     "merge conflicts detected",
				Details: map[string]interface{}{"conflicts": []map[string]interface{}{{"table_name": tableName, "data_conflicts": dataConflicts}}, "hint": "Resolve conflicts and retry."},
			}
		}
	}
	return nil
}
