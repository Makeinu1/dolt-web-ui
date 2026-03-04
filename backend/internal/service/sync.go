package service

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// Sync merges main → work branch, automatically resolving data conflicts in favour of main.
// Schema conflicts still block (require CLI intervention).
// Flow:
//  1. Branch lock check
//  2. expected_head check
//  3. Preview: block on schema conflicts, collect data-conflicted table names
//  4. START TRANSACTION + DOLT_MERGE('main')
//  5. If mergeConflicts > 0: DOLT_CONFLICTS_RESOLVE('--theirs', table) for each table → DOLT_COMMIT
//  6. Return SyncResponse with overwritten_tables list (non-empty when auto-resolution occurred)
func (s *Service) Sync(ctx context.Context, req model.SyncRequest) (*model.SyncResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "sync on protected branch is forbidden"}
	}

	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Step -1: Branch lock check
	if apiErr := checkBranchLocked(ctx, conn, req.BranchName); apiErr != nil {
		return nil, apiErr
	}

	// Step 1: Preview — block on schema conflicts, collect data-conflicted tables
	dataConflictTables, apiErr := s.previewMergeInfo(ctx, conn, req.BranchName)
	if apiErr != nil {
		return nil, apiErr
	}

	// Step 2: START TRANSACTION and merge
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// NEW-4: expected_head check inside TX to eliminate race window.
	var currentHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, fmt.Errorf("failed to get HEAD: %w", err)
	}
	if currentHead != req.ExpectedHead {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, &model.APIError{
			Status:  409,
			Code:    model.CodeStaleHead,
			Msg:     "expected_head mismatch",
			Details: map[string]string{"expected_head": req.ExpectedHead, "actual_head": currentHead},
		}
	}

	var mergeHash string
	var fastForward, mergeConflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('main')").Scan(&mergeHash, &fastForward, &mergeConflicts, &mergeMessage)
	if err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to merge: %w", err)
	}

	if mergeConflicts > 0 {
		// Auto-resolve: main priority (--theirs) for all data-conflicted tables
		overwritten, resolveErr := s.resolveDataConflicts(ctx, conn, dataConflictTables)
		if resolveErr != nil {
			conn.ExecContext(context.Background(), "ROLLBACK")
			return nil, resolveErr
		}

		// Commit the resolved merge
		if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '--all', '-m', 'Sync: auto-resolved conflicts (main priority)')"); err != nil {
			conn.ExecContext(context.Background(), "ROLLBACK")
			return nil, fmt.Errorf("failed to commit resolved merge: %w", err)
		}

		var newHead string
		if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
			return nil, fmt.Errorf("failed to get new HEAD: %w", err)
		}
		return &model.SyncResponse{Hash: newHead, OverwrittenTables: overwritten}, nil
	}

	// No conflicts: get new HEAD (merge already committed at Dolt level)
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}
	return &model.SyncResponse{Hash: newHead}, nil
}

// previewMergeInfo runs DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY.
// Returns data-conflicted table names (auto-resolvable).
// Returns *APIError if schema conflicts are detected (must be resolved via CLI).
func (s *Service) previewMergeInfo(ctx context.Context, conn *sql.Conn, branchName string) ([]string, *model.APIError) {
	if err := validateRef("branch", branchName); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid branch name"}
	}
	query := fmt.Sprintf("SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('%s', 'main')", branchName)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, &model.APIError{Status: 500, Code: model.CodeInternal, Msg: fmt.Sprintf("failed to preview merge: %v", err)}
	}
	defer rows.Close()

	// Dolt v1.x: DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY returns 3 columns:
	// (table, num_data_conflicts, num_schema_conflicts)
	var dataConflictTables []string
	for rows.Next() {
		var tableName string
		var dataConflicts, schemaConflicts int
		if err := rows.Scan(&tableName, &dataConflicts, &schemaConflicts); err != nil {
			return nil, &model.APIError{Status: 500, Code: model.CodeInternal, Msg: fmt.Sprintf("failed to scan preview: %v", err)}
		}
		if schemaConflicts > 0 {
			return nil, &model.APIError{
				Status:  409,
				Code:    model.CodeSchemaConflictsPresent,
				Msg:     "schema conflicts detected",
				Details: map[string]interface{}{"tables": []string{tableName}, "hint": "Schema conflicts must be resolved via CLI."},
			}
		}
		if dataConflicts > 0 {
			dataConflictTables = append(dataConflictTables, tableName)
		}
	}
	return dataConflictTables, nil
}

// resolveDataConflicts calls DOLT_CONFLICTS_RESOLVE('--theirs', table) for each conflicted table
// and returns an OverwrittenTable entry for each resolved table.
func (s *Service) resolveDataConflicts(ctx context.Context, conn *sql.Conn, tables []string) ([]model.OverwrittenTable, error) {
	overwritten := make([]model.OverwrittenTable, 0)
	for _, table := range tables {
		if err := validateRef("table", table); err != nil {
			return nil, fmt.Errorf("invalid table name %s: %w", table, err)
		}

		// Get conflict count for notification (best-effort; ignore scan errors)
		var count int
		conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_conflicts").Scan(&count)

		resolveQuery := fmt.Sprintf("CALL DOLT_CONFLICTS_RESOLVE('--theirs', `%s`)", table)
		if _, err := conn.ExecContext(ctx, resolveQuery); err != nil {
			return nil, fmt.Errorf("failed to resolve conflicts for table %s: %w", table, err)
		}
		overwritten = append(overwritten, model.OverwrittenTable{Table: table, Conflicts: count})
	}
	return overwritten, nil
}

// AbortMerge performs DOLT_MERGE('--abort') to escape from a stuck merge state.
// L3-2: Provides an escape hatch for users who can't use CLI.
func (s *Service) AbortMerge(ctx context.Context, targetID, dbName, branchName string) error {
	if validation.IsProtectedBranch(branchName) {
		return &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "cannot abort merge on protected branch"}
	}

	conn, err := s.repo.ConnWrite(ctx, targetID, dbName, branchName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "CALL DOLT_MERGE('--abort')"); err != nil {
		return fmt.Errorf("failed to abort merge: %w", err)
	}

	return nil
}
