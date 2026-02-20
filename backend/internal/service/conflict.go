package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// ListConflicts returns a summary of merge conflicts between work branch and main.
// Per v6f spec section 8.1: uses DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY.
func (s *Service) ListConflicts(ctx context.Context, targetID, dbName, branchName string) ([]model.ConflictsSummaryEntry, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	query := fmt.Sprintf("SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('%s', 'main')", branchName)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query conflicts summary: %w", err)
	}
	defer rows.Close()

	// Dolt v1.x: DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY returns 3 columns:
	// (table, num_data_conflicts, num_schema_conflicts)
	result := make([]model.ConflictsSummaryEntry, 0)
	for rows.Next() {
		var entry model.ConflictsSummaryEntry
		if err := rows.Scan(&entry.Table, &entry.DataConflicts, &entry.SchemaConflicts); err != nil {
			return nil, fmt.Errorf("failed to scan conflict summary: %w", err)
		}
		result = append(result, entry)
	}
	return result, rows.Err()
}

// GetConflictsTable returns detailed conflict rows for a specific table.
// Per v6f spec section 8.2: uses dolt_preview_merge_conflicts.
func (s *Service) GetConflictsTable(ctx context.Context, targetID, dbName, branchName, table string) ([]model.ConflictRow, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if err := validateRef("branch", branchName); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid branch name"}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	query := fmt.Sprintf("SELECT * FROM dolt_preview_merge_conflicts('%s', 'main', '%s')", branchName, table)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query conflicts: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	result := make([]model.ConflictRow, 0)
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan conflict row: %w", err)
		}

		base := make(map[string]interface{})
		ours := make(map[string]interface{})
		theirs := make(map[string]interface{})
		for i, col := range colNames {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			// Dolt conflict columns use prefixes: base_<col>, our_<col>, their_<col>
			switch {
			case strings.HasPrefix(col, "base_"):
				base[strings.TrimPrefix(col, "base_")] = val
			case strings.HasPrefix(col, "our_"):
				ours[strings.TrimPrefix(col, "our_")] = val
			case strings.HasPrefix(col, "their_"):
				theirs[strings.TrimPrefix(col, "their_")] = val
			default:
				// Shared columns (e.g. diff_type) go into all maps
				base[col] = val
				ours[col] = val
				theirs[col] = val
			}
		}

		result = append(result, model.ConflictRow{
			Base:   base,
			Ours:   ours,
			Theirs: theirs,
		})
	}
	return result, rows.Err()
}

// ResolveConflicts performs a merge with conflict resolution.
// Per v6f spec section 8.3: expected_head check → START TRANSACTION →
// schema pre-check → DOLT_MERGE → DOLT_CONFLICTS_RESOLVE → verify → DOLT_COMMIT.
func (s *Service) ResolveConflicts(ctx context.Context, req model.ResolveConflictsRequest) (*model.CommitResponse, error) {
	if validation.IsMainBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if req.Strategy != "ours" && req.Strategy != "theirs" {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "strategy must be 'ours' or 'theirs'"}
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

	// Step 1: START TRANSACTION
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// Step 2: Schema conflict pre-check
	previewQuery := fmt.Sprintf("SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('%s', 'main')", req.BranchName)
	previewRows, err := conn.QueryContext(ctx, previewQuery)
	if err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to preview conflicts: %w", err)
	}
	// Dolt v1.x: DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY returns 3 columns:
	// (table, num_data_conflicts, num_schema_conflicts)
	for previewRows.Next() {
		var tableName string
		var dataConflicts, schemaConflicts int
		if err := previewRows.Scan(&tableName, &dataConflicts, &schemaConflicts); err != nil {
			previewRows.Close()
			conn.ExecContext(ctx, "ROLLBACK")
			return nil, fmt.Errorf("failed to scan preview: %w", err)
		}
		if schemaConflicts > 0 {
			previewRows.Close()
			conn.ExecContext(ctx, "ROLLBACK")
			return nil, &model.APIError{
				Status:  409,
				Code:    model.CodeSchemaConflictsPresent,
				Msg:     "schema conflicts detected",
				Details: map[string]string{"hint": "Schema conflicts must be resolved via CLI."},
			}
		}
	}
	previewRows.Close()

	// Step 3: DOLT_MERGE
	var mergeHash string
	var fastForward, mergeConflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('main', '--no-ff')").Scan(&mergeHash, &fastForward, &mergeConflicts, &mergeMessage)
	if err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to merge: %w", err)
	}

	if mergeConflicts == 0 {
		// No conflicts, merge succeeded
		var newHead string
		if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
			conn.ExecContext(ctx, "ROLLBACK")
			return nil, fmt.Errorf("failed to get new HEAD: %w", err)
		}
		return &model.CommitResponse{Hash: newHead}, nil
	}

	// Step 4: Resolve conflicts
	resolveArg := "--ours"
	if req.Strategy == "theirs" {
		resolveArg = "--theirs"
	}
	resolveQuery := fmt.Sprintf("CALL DOLT_CONFLICTS_RESOLVE('%s', '%s')", resolveArg, req.Table)
	if _, err := conn.ExecContext(ctx, resolveQuery); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to resolve conflicts: %w", err)
	}

	// Step 5: Check for lingering conflicts
	var remaining int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_conflicts").Scan(&remaining); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to check remaining conflicts: %w", err)
	}
	if remaining > 0 {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, &model.APIError{
			Status: 409,
			Code:   model.CodeMergeConflictsPresent,
			Msg:    "unresolved conflicts remain",
		}
	}

	// Step 6: Constraint violation check
	if _, err := conn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to verify constraints: %w", err)
	}
	var violationCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, &model.APIError{
			Status:  409,
			Code:    model.CodeConstraintViolationsPresent,
			Msg:     "constraint violations detected after merge",
			Details: map[string]string{"hint": "Constraint violations must be resolved via CLI."},
		}
	}

	// Step 7: DOLT_COMMIT
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('-am', 'Merge main with conflict resolution')"); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	// Step 8: Get new HEAD
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.CommitResponse{Hash: newHead}, nil
}
