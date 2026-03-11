package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func crossCopyFailure(err error, expanded bool) error {
	if !expanded {
		return err
	}
	const warning = "。main に反映済みのスキーマ拡張は自動では元に戻りません"
	if apiErr, ok := err.(*model.APIError); ok {
		cloned := *apiErr
		cloned.Msg += warning
		return &cloned
	}
	return fmt.Errorf("%w%s", err, warning)
}

func (s *Service) cleanupCrossCopyBranch(ctx context.Context, targetID, dbName, branchName string) {
	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		log.Printf("WARN: failed to open cleanup connection for branch %s: %v", branchName, err)
		return
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", branchName); err != nil {
		log.Printf("WARN: failed to cleanup branch %s after cross-copy failure: %v", branchName, err)
	}
}

// CrossCopyTable copies an entire table from source DB to a new branch in dest DB.
func (s *Service) CrossCopyTable(ctx context.Context, req model.CrossCopyTableRequest) (*model.CrossCopyTableResponse, error) {
	// Validate inputs
	if err := validation.ValidateDBName(req.SourceDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースDB名"}
	}
	if err := validation.ValidateDBName(req.DestDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効な宛先DB名"}
	}
	if err := validation.ValidateBranchName(req.SourceBranch); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースブランチ名"}
	}
	if err := validateProtectedCopySource(req.SourceBranch); err != nil {
		return nil, err
	}
	if err := validation.ValidateIdentifier("table", req.SourceTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}

	// Get source schema (using read-only conn)
	srcConn, err := s.repo.Conn(ctx, req.TargetID, req.SourceDB, req.SourceBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to source: %w", err)
	}
	srcCols, err := getSchemaColumns(ctx, srcConn, req.SourceTable)
	srcConn.Close()
	if err != nil {
		return nil, err
	}

	// Get dest schema on main (to verify table exists and compute shared columns)
	dstConnCheck, err := s.repo.Conn(ctx, req.TargetID, req.DestDB, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to dest: %w", err)
	}
	dstCols, err := getSchemaColumns(ctx, dstConnCheck, req.SourceTable)
	dstConnCheck.Close()
	if err != nil {
		return nil, err
	}

	shared, srcOnly, dstOnly := computeSharedColumns(srcCols, dstCols)
	if len(shared) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "共有カラムがありません"}
	}

	// Build column maps for expansion check (used in DDL phase and later)
	srcColMap := make(map[string]model.ColumnSchema, len(srcCols))
	for _, c := range srcCols {
		srcColMap[c.Name] = c
	}
	dstColMapTable := make(map[string]model.ColumnSchema, len(dstCols))
	for _, c := range dstCols {
		dstColMapTable[c.Name] = c
	}

	// DDL先行コミット: Apply schema expansion to main BEFORE creating the work branch.
	// This ensures the work branch inherits the updated schema, so the diff only shows
	// data changes (not spurious "all rows changed" due to schema mismatch).
	mainWriteConn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DestDB, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to main for DDL: %w", err)
	}
	expanded, err := applyExpandColumns(ctx, mainWriteConn, req.SourceTable, srcColMap, dstColMapTable, shared)
	if err != nil {
		mainWriteConn.Close()
		return nil, fmt.Errorf("failed to expand columns on main: %w", err)
	}
	if expanded {
		schemaMsg := fmt.Sprintf("schema: %s カラム型を拡張（クロスコピー前）", req.SourceTable)
		mainWriteConn.ExecContext(ctx, "CALL DOLT_ADD('.')") //nolint:errcheck
		if _, cerr := mainWriteConn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", schemaMsg); cerr != nil {
			mainWriteConn.Close()
			return nil, fmt.Errorf("failed to commit DDL to main: %w", cerr)
		}
	}
	mainWriteConn.Close()

	// Reuse a single long-lived import branch per source DB + table.
	dstConnDB, err := s.repo.ConnDB(ctx, req.TargetID, req.DestDB)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to dest DB: %w", err)
	}
	newBranchName := importWorkBranchName(req.SourceDB, req.SourceTable)
	exists, err := branchExists(ctx, dstConnDB, newBranchName)
	if err != nil {
		dstConnDB.Close()
		return nil, fmt.Errorf("failed to check branch %s: %w", newBranchName, err)
	}
	if exists {
		dstConnDB.Close()
		return nil, newBranchExistsError(newBranchName)
	}
	shouldCleanupBranch := false

	// Create new branch from main
	if _, err := dstConnDB.ExecContext(ctx, "CALL DOLT_BRANCH(?)", newBranchName); err != nil {
		classifiedErr := classifyBranchCreateError(ctx, dstConnDB, newBranchName, err)
		dstConnDB.Close()
		return nil, classifiedErr
	}
	shouldCleanupBranch = true
	dstConnDB.Close()

	defer func() {
		if shouldCleanupBranch {
			s.cleanupCrossCopyBranch(context.Background(), req.TargetID, req.DestDB, newBranchName)
		}
	}()

	// Verify branch is queryable before getting writable connection.
	// Guards against Dolt propagation lag (same pattern as CreateBranch).
	if err := s.verifyBranchQueryable(ctx, req.TargetID, req.DestDB, newBranchName); err != nil {
		return nil, crossCopyFailure(fmt.Errorf("failed to verify branch %s: %w", newBranchName, err), expanded)
	}

	// Get writable connection on the new branch
	dstConn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DestDB, newBranchName)
	if err != nil {
		return nil, crossCopyFailure(fmt.Errorf("failed to connect to new branch: %w", err), expanded)
	}
	defer dstConn.Close()

	// START TRANSACTION
	if _, err := dstConn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, crossCopyFailure(fmt.Errorf("failed to start transaction: %w", err), expanded)
	}

	// DELETE FROM table (within transaction — will be rolled back on error)
	if _, err := dstConn.ExecContext(ctx, fmt.Sprintf("DELETE FROM `%s`", req.SourceTable)); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, crossCopyFailure(fmt.Errorf("failed to delete dest data: %w", err), expanded)
	}

	// INSERT INTO dest(shared_cols) SELECT shared_cols FROM `source_db/source_branch`.table
	// Use Dolt revision specifier for cross-DB SELECT
	quotedCols := make([]string, len(shared))
	for i, c := range shared {
		quotedCols[i] = fmt.Sprintf("`%s`", c)
	}
	colList := strings.Join(quotedCols, ", ")
	sourceRef := fmt.Sprintf("`%s/%s`", req.SourceDB, req.SourceBranch)

	insertQuery := fmt.Sprintf("INSERT INTO `%s` (%s) SELECT %s FROM %s.`%s`",
		req.SourceTable, colList, colList, sourceRef, req.SourceTable)

	result, err := dstConn.ExecContext(ctx, insertQuery)
	if err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		if apiErr := parseCopyError(err); apiErr != nil {
			return nil, crossCopyFailure(apiErr, expanded)
		}
		return nil, crossCopyFailure(fmt.Errorf("failed to copy table data: %w", err), expanded)
	}

	rowCount, _ := result.RowsAffected()

	// DOLT_VERIFY_CONSTRAINTS
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, crossCopyFailure(fmt.Errorf("failed to verify constraints: %w", err), expanded)
	}
	var violationCount int
	if err := dstConn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, crossCopyFailure(&model.APIError{Status: 400, Code: model.CodeCopyFKError, Msg: "制約違反が検出されました"}, expanded)
	}

	// DOLT_ADD + DOLT_COMMIT
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, crossCopyFailure(fmt.Errorf("failed to dolt add: %w", err), expanded)
	}

	commitMsg := fmt.Sprintf("[cross-copy] %sから%sテーブルを全件コピー（%d行）", req.SourceDB, req.SourceTable, rowCount)
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", commitMsg); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, crossCopyFailure(fmt.Errorf("failed to commit: %w", err), expanded)
	}
	shouldCleanupBranch = false

	// Get new HEAD
	var newHead string
	if err := dstConn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.CrossCopyTableResponse{
		Hash:           newHead,
		BranchName:     newBranchName,
		RowCount:       int(rowCount),
		SharedColumns:  shared,
		SourceOnlyCols: srcOnly,
		DestOnlyCols:   dstOnly,
	}, nil
}
