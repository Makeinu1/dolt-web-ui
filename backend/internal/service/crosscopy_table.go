package service

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func (s *Service) cleanupCrossCopyBranch(ctx context.Context, targetID, dbName, branchName string) error {
	conn, err := s.connMetadataRevision(ctx, targetID, dbName)
	if err != nil {
		return fmt.Errorf("failed to open cleanup connection for branch %s: %w", branchName, err)
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", branchName); err != nil {
		if isBranchNotFoundError(err) {
			return nil
		}
		return fmt.Errorf("failed to cleanup branch %s after cross-copy failure: %w", branchName, err)
	}
	return nil
}

func crossCopyTableFailureResponse(branchName string, shared, srcOnly, dstOnly []string, cleanupErr error) *model.CrossCopyTableResponse {
	outcome := model.OperationOutcomeFailed
	message := "インポートブランチの準備に失敗しました。残留ブランチは掃除済みです。"
	retryReason := ""
	retryActions := []model.RetryAction(nil)
	responseBranchName := ""

	if cleanupErr != nil {
		outcome = model.OperationOutcomeRetryRequired
		message = "インポートブランチの準備に失敗し、後片付けを完了できませんでした。確認して再試行してください。"
		retryReason = "destination_branch_cleanup_failed"
		responseBranchName = branchName
		retryActions = []model.RetryAction{
			{Action: "open_import_branch", Label: "インポートブランチを確認する"},
		}
	}

	return &model.CrossCopyTableResponse{
		BranchName:     responseBranchName,
		SharedColumns:  shared,
		SourceOnlyCols: srcOnly,
		DestOnlyCols:   dstOnly,
		OperationResultFields: model.OperationResultFields{
			Outcome:      outcome,
			Message:      message,
			RetryReason:  retryReason,
			RetryActions: retryActions,
			Completion: map[string]bool{
				"destination_committed":    false,
				"destination_branch_ready": false,
				"protected_refs_clean":     true,
			},
		},
	}
}

func crossCopyTableRetryResponse(branchName, hash string, rowCount int, shared, srcOnly, dstOnly []string, message, retryReason string, retryActions []model.RetryAction) *model.CrossCopyTableResponse {
	return &model.CrossCopyTableResponse{
		Hash:           hash,
		BranchName:     branchName,
		RowCount:       rowCount,
		SharedColumns:  shared,
		SourceOnlyCols: srcOnly,
		DestOnlyCols:   dstOnly,
		OperationResultFields: model.OperationResultFields{
			Outcome:      model.OperationOutcomeRetryRequired,
			Message:      message,
			RetryReason:  retryReason,
			RetryActions: retryActions,
			Completion: map[string]bool{
				"destination_committed":    hash != "",
				"destination_branch_ready": false,
				"protected_refs_clean":     true,
			},
		},
	}
}

// CrossCopyTable copies an entire table from source DB to a new branch in dest DB.
func (s *Service) CrossCopyTable(ctx context.Context, req model.CrossCopyTableRequest) (*model.CrossCopyTableResponse, error) {
	if err := validation.ValidateDBName(req.SourceDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースDB名"}
	}
	if err := validation.ValidateDBName(req.DestDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効な宛先DB名"}
	}
	if err := validation.ValidateBranchName(req.SourceBranch); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースブランチ名"}
	}
	if err := s.ensureCrossCopySourceRef(req.TargetID, req.SourceDB, req.SourceBranch); err != nil {
		return nil, err
	}
	if err := validation.ValidateIdentifier("table", req.SourceTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}

	srcConn, err := s.connCrossCopySourceRevision(ctx, req.TargetID, req.SourceDB, req.SourceBranch)
	if err != nil {
		return nil, err
	}
	srcCols, err := getSchemaColumns(ctx, srcConn, req.SourceTable)
	srcConn.Close()
	if err != nil {
		return nil, err
	}

	dstConnCheck, err := s.connMetadataRevision(ctx, req.TargetID, req.DestDB)
	if err != nil {
		return nil, err
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

	expandColumns := expandColumnsForShared(srcCols, dstCols, shared)
	if len(expandColumns) > 0 {
		return nil, crossCopySchemaPreconditionError(expandColumns)
	}

	dstConnDB, err := s.connMetadataRevision(ctx, req.TargetID, req.DestDB)
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

	if _, err := dstConnDB.ExecContext(ctx, "CALL DOLT_BRANCH(?)", newBranchName); err != nil {
		classifiedErr := classifyBranchCreateError(ctx, dstConnDB, newBranchName, err)
		dstConnDB.Close()
		return nil, classifiedErr
	}
	dstConnDB.Close()

	cleanupIfNeeded := func() error {
		cleanupErr := s.cleanupCrossCopyBranch(context.Background(), req.TargetID, req.DestDB, newBranchName)
		if cleanupErr != nil {
			log.Printf("WARN: %v", cleanupErr)
		}
		return cleanupErr
	}

	readiness := s.branchReadiness(ctx, req.TargetID, req.DestDB, newBranchName)
	if !readiness.Ready {
		logBranchQueryabilityFailure("cross_copy_branch_not_ready", req.TargetID, req.DestDB, newBranchName, readiness)
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}

	dstConn, err := s.repo.ConnWorkBranchWrite(ctx, req.TargetID, req.DestDB, newBranchName)
	if err != nil {
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}
	defer dstConn.Close()

	if _, err := dstConn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}

	if _, err := dstConn.ExecContext(ctx, fmt.Sprintf("DELETE FROM `%s`", req.SourceTable)); err != nil {
		safeRollback(dstConn)
		if apiErr := parseCopyError(err); apiErr != nil {
			cleanupErr := cleanupIfNeeded()
			if cleanupErr != nil {
				return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupErr), nil
			}
			return nil, apiErr
		}
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}

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
		safeRollback(dstConn)
		if apiErr := parseCopyError(err); apiErr != nil {
			cleanupErr := cleanupIfNeeded()
			if cleanupErr != nil {
				return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupErr), nil
			}
			return nil, apiErr
		}
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}

	rowCount, _ := result.RowsAffected()

	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		safeRollback(dstConn)
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}
	var violationCount int
	if err := dstConn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		safeRollback(dstConn)
		cleanupErr := cleanupIfNeeded()
		if cleanupErr != nil {
			return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupErr), nil
		}
		return nil, &model.APIError{Status: 400, Code: model.CodeCopyFKError, Msg: "制約違反が検出されました"}
	}

	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		safeRollback(dstConn)
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}

	commitMsg := fmt.Sprintf("[cross-copy] %sから%sテーブルを全件コピー（%d行）", req.SourceDB, req.SourceTable, rowCount)
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", commitMsg); err != nil {
		safeRollback(dstConn)
		return crossCopyTableFailureResponse(newBranchName, shared, srcOnly, dstOnly, cleanupIfNeeded()), nil
	}
	if _, err := dstConn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	var newHead string
	if err := dstConn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return crossCopyTableRetryResponse(
			newBranchName,
			"",
			int(rowCount),
			shared,
			srcOnly,
			dstOnly,
			"コピーコミットは作成された可能性がありますが、確認に失敗しました。インポートブランチを確認して再試行してください。",
			"destination_commit_uncertain",
			[]model.RetryAction{{Action: "open_import_branch", Label: "インポートブランチを確認する"}},
		), nil
	}

	readiness = s.branchReadiness(ctx, req.TargetID, req.DestDB, newBranchName)
	if !readiness.Ready {
		logBranchQueryabilityFailure("cross_copy_committed_branch_not_ready", req.TargetID, req.DestDB, newBranchName, readiness)
		return crossCopyTableRetryResponse(
			newBranchName,
			newHead,
			int(rowCount),
			shared,
			srcOnly,
			dstOnly,
			"コピーコミットは作成されましたが、インポートブランチの接続反映を確認できませんでした。時間をおいて開き直してください。",
			"destination_branch_not_ready",
			[]model.RetryAction{{Action: "open_import_branch", Label: "インポートブランチを開き直す"}},
		), nil
	}

	return &model.CrossCopyTableResponse{
		Hash:           newHead,
		BranchName:     newBranchName,
		RowCount:       int(rowCount),
		SharedColumns:  shared,
		SourceOnlyCols: srcOnly,
		DestOnlyCols:   dstOnly,
		OperationResultFields: model.OperationResultFields{
			Outcome: model.OperationOutcomeCompleted,
			Message: "他DBへテーブルをコピーしました",
			Completion: map[string]bool{
				"destination_committed":    true,
				"destination_branch_ready": true,
				"protected_refs_clean":     true,
			},
		},
	}, nil
}
