package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

const crossCopyImportBranchPrefix = "wi/import-"

type crossCopySchemaPreparation struct {
	sourceColumns     []model.ColumnSchema
	destMainColumns   []model.ColumnSchema
	sharedColumns     []string
	preparedColumns   []model.ExpandColumn
	sourceColumnMap   map[string]model.ColumnSchema
	destMainColumnMap map[string]model.ColumnSchema
}

func schemaColumnMap(cols []model.ColumnSchema) map[string]model.ColumnSchema {
	m := make(map[string]model.ColumnSchema, len(cols))
	for _, col := range cols {
		m[col.Name] = col
	}
	return m
}

func currentHeadHash(ctx context.Context, conn *sql.Conn) (string, error) {
	var hash string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&hash); err != nil {
		return "", fmt.Errorf("failed to get HEAD: %w", err)
	}
	return hash, nil
}

func (s *Service) crossCopySchemaPreparation(ctx context.Context, targetID, sourceDB, sourceBranch, sourceTable, destDB string) (*crossCopySchemaPreparation, error) {
	srcConn, err := s.connCrossCopySourceRevision(ctx, targetID, sourceDB, sourceBranch)
	if err != nil {
		return nil, err
	}
	defer srcConn.Close()

	dstMainConn, err := s.connMetadataRevision(ctx, targetID, destDB)
	if err != nil {
		return nil, err
	}
	defer dstMainConn.Close()

	srcCols, err := getSchemaColumns(ctx, srcConn, sourceTable)
	if err != nil {
		return nil, err
	}
	dstMainCols, err := getSchemaColumns(ctx, dstMainConn, sourceTable)
	if err != nil {
		return nil, err
	}

	shared, _, _ := computeSharedColumns(srcCols, dstMainCols)
	if len(shared) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "共有カラムがありません"}
	}

	return &crossCopySchemaPreparation{
		sourceColumns:     srcCols,
		destMainColumns:   dstMainCols,
		sharedColumns:     shared,
		preparedColumns:   expandColumnsForShared(srcCols, dstMainCols, shared),
		sourceColumnMap:   schemaColumnMap(srcCols),
		destMainColumnMap: schemaColumnMap(dstMainCols),
	}, nil
}

func adminCrossCopyPrepCommitMessage(sourceDB, sourceBranch, table string) string {
	return fmt.Sprintf("[admin cross-copy prep] %s/%s/%s schema prepared", sourceDB, sourceBranch, table)
}

func (s *Service) prepareCrossCopySchemaOnMain(
	ctx context.Context,
	targetID, sourceDB, sourceBranch, sourceTable, destDB string,
	prep *crossCopySchemaPreparation,
) (mainHash string, attempted bool, err error) {
	if len(prep.preparedColumns) == 0 {
		conn, headErr := s.connMetadataRevision(ctx, targetID, destDB)
		if headErr != nil {
			return "", false, headErr
		}
		defer conn.Close()

		hash, hashErr := currentHeadHash(ctx, conn)
		if hashErr != nil {
			return "", false, hashErr
		}
		return hash, false, nil
	}

	conn, connErr := s.repo.ConnProtectedMaintenance(ctx, targetID, destDB, "main")
	if connErr != nil {
		return "", true, fmt.Errorf("failed to connect to destination main: %w", connErr)
	}
	defer conn.Close()

	if _, expandErr := applyExpandColumns(ctx, conn, sourceTable, prep.sourceColumnMap, prep.destMainColumnMap, prep.sharedColumns); expandErr != nil {
		return "", true, expandErr
	}
	if _, addErr := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); addErr != nil {
		return "", true, fmt.Errorf("failed to add prepared schema: %w", addErr)
	}
	if _, commitErr := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", adminCrossCopyPrepCommitMessage(sourceDB, sourceBranch, sourceTable)); commitErr != nil {
		return "", true, fmt.Errorf("failed to commit prepared schema: %w", commitErr)
	}

	hash, hashErr := currentHeadHash(ctx, conn)
	if hashErr != nil {
		return "", true, hashErr
	}
	return hash, true, nil
}

func adminPrepareRowsRetryResponse(mainHash, branchHash string, preparedColumns []model.ExpandColumn, overwrittenTables []model.OverwrittenTable, message, retryReason string, retryActions []model.RetryAction, protectedPrepared, branchSynced, branchReady, protectedClean bool) *model.CrossCopyAdminPrepareRowsResponse {
	return &model.CrossCopyAdminPrepareRowsResponse{
		MainHash:          mainHash,
		BranchHash:        branchHash,
		PreparedColumns:   preparedColumns,
		OverwrittenTables: overwrittenTables,
		OperationResultFields: model.OperationResultFields{
			Outcome:      model.OperationOutcomeRetryRequired,
			Message:      message,
			RetryReason:  retryReason,
			RetryActions: retryActions,
			Completion: map[string]bool{
				"protected_schema_prepared": protectedPrepared,
				"destination_branch_synced": branchSynced,
				"destination_branch_ready":  branchReady,
				"protected_refs_clean":      protectedClean,
			},
		},
	}
}

func adminPrepareTableRetryResponse(mainHash string, preparedColumns []model.ExpandColumn, message, retryReason string, retryActions []model.RetryAction, protectedPrepared, protectedClean bool) *model.CrossCopyAdminPrepareTableResponse {
	return &model.CrossCopyAdminPrepareTableResponse{
		MainHash:        mainHash,
		PreparedColumns: preparedColumns,
		OperationResultFields: model.OperationResultFields{
			Outcome:      model.OperationOutcomeRetryRequired,
			Message:      message,
			RetryReason:  retryReason,
			RetryActions: retryActions,
			Completion: map[string]bool{
				"protected_schema_prepared": protectedPrepared,
				"protected_refs_clean":      protectedClean,
			},
		},
	}
}

func adminCleanupImportRetryResponse(branchName, message, retryReason string) *model.CrossCopyAdminCleanupImportResponse {
	return &model.CrossCopyAdminCleanupImportResponse{
		BranchName: branchName,
		OperationResultFields: model.OperationResultFields{
			Outcome:     model.OperationOutcomeRetryRequired,
			Message:     message,
			RetryReason: retryReason,
			RetryActions: []model.RetryAction{
				{Action: "open_import_branch", Label: "インポートブランチを確認する"},
			},
			Completion: map[string]bool{
				"destination_branch_removed": false,
				"protected_refs_clean":       false,
			},
		},
	}
}

func classifyRowsAdminSyncFailure(syncErr error) (message, retryReason string, retryActions []model.RetryAction) {
	var apiErr *model.APIError
	if errors.As(syncErr, &apiErr) {
		switch apiErr.Code {
		case model.CodeSchemaConflictsPresent, model.CodeBranchLocked:
			return "宛先 main の schema は準備できましたが、宛先ブランチの同期が手動対応待ちで止まりました。宛先ブランチを確認して再試行してください。",
				"destination_branch_sync_requires_manual_recovery",
				[]model.RetryAction{{Action: "open_destination_branch", Label: "宛先ブランチを確認する"}}
		default:
			return fmt.Sprintf("宛先 main の schema は準備できましたが、宛先ブランチの同期結果を確認できませんでした: %s", apiErr.Msg),
				"destination_branch_sync_uncertain",
				[]model.RetryAction{{Action: "open_destination_branch", Label: "宛先ブランチを確認する"}}
		}
	}

	return "宛先 main の schema は準備できましたが、宛先ブランチの同期結果を確認できませんでした。宛先ブランチを確認して再試行してください。",
		"destination_branch_sync_uncertain",
		[]model.RetryAction{{Action: "open_destination_branch", Label: "宛先ブランチを確認する"}}
}

func (s *Service) currentWorkBranchHead(ctx context.Context, targetID, dbName, branchName string) (string, error) {
	conn, err := s.connAllowedWorkBranchWrite(ctx, targetID, dbName, branchName)
	if err != nil {
		return "", err
	}
	defer conn.Close()

	if apiErr := checkBranchLocked(ctx, conn, branchName); apiErr != nil {
		return "", apiErr
	}
	return currentHeadHash(ctx, conn)
}

func (s *Service) checkPreparedRowsBranchVisibleOnce(
	ctx context.Context,
	targetID, sourceTable, destDB, destBranch, expectedHash string,
	prep *crossCopySchemaPreparation,
) error {
	conn, err := s.connCrossCopyDestinationRevision(ctx, targetID, destDB, destBranch)
	if err != nil {
		return err
	}
	defer conn.Close()

	head, err := currentHeadHash(ctx, conn)
	if err != nil {
		return err
	}
	if expectedHash != "" && head != expectedHash {
		return fmt.Errorf("branch HEAD %s does not match expected %s", head, expectedHash)
	}

	dstCols, err := getSchemaColumns(ctx, conn, sourceTable)
	if err != nil {
		return err
	}
	shared, _, _ := computeSharedColumns(prep.sourceColumns, dstCols)
	if len(shared) == 0 {
		return fmt.Errorf("no shared columns visible on destination branch")
	}
	if expand := expandColumnsForShared(prep.sourceColumns, dstCols, shared); len(expand) > 0 {
		return fmt.Errorf("expand_columns still visible on destination branch")
	}
	return nil
}

func (s *Service) preparedRowsBranchVisibility(
	ctx context.Context,
	targetID, sourceTable, destDB, destBranch, expectedHash string,
	prep *crossCopySchemaPreparation,
) branchQueryabilityResult {
	start := time.Now()
	attempts := s.branchReadyAttempts()
	poll := s.branchReadyPollInterval()

	result := branchQueryabilityResult{Attempts: attempts}
	for attempt := 1; attempt <= attempts; attempt++ {
		err := s.checkPreparedRowsBranchVisibleOnce(ctx, targetID, sourceTable, destDB, destBranch, expectedHash, prep)
		if err == nil {
			result.Ready = true
			result.Attempts = attempt
			result.Elapsed = time.Since(start)
			return result
		}
		result.LastErr = err
		result.Attempts = attempt

		if attempt < attempts {
			if sleepErr := sleepWithContext(ctx, poll); sleepErr != nil {
				result.LastErr = sleepErr
				break
			}
		}
	}

	result.Elapsed = time.Since(start)
	return result
}

// CrossCopyAdminPrepareRows prepares destination main and syncs main into the destination work branch.
func (s *Service) CrossCopyAdminPrepareRows(ctx context.Context, req model.CrossCopyAdminPrepareRowsRequest) (*model.CrossCopyAdminPrepareRowsResponse, error) {
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
	if err := s.ensureCrossCopyDestinationBranch(req.TargetID, req.DestDB, req.DestBranch); err != nil {
		return nil, err
	}
	if err := validation.ValidateIdentifier("table", req.SourceTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}

	prep, err := s.crossCopySchemaPreparation(ctx, req.TargetID, req.SourceDB, req.SourceBranch, req.SourceTable, req.DestDB)
	if err != nil {
		return nil, err
	}

	branchHead, err := s.currentWorkBranchHead(ctx, req.TargetID, req.DestDB, req.DestBranch)
	if err != nil {
		return nil, err
	}

	mainHash, attempted, err := s.prepareCrossCopySchemaOnMain(ctx, req.TargetID, req.SourceDB, req.SourceBranch, req.SourceTable, req.DestDB, prep)
	if err != nil {
		if attempted {
			return adminPrepareRowsRetryResponse(
				"",
				"",
				prep.preparedColumns,
				nil,
				"宛先 main の schema 準備結果を確認できませんでした。main を確認してから再試行してください。",
				"protected_schema_commit_uncertain",
				[]model.RetryAction{{Action: "review_destination_main", Label: "dest main を確認する"}},
				false,
				false,
				false,
				false,
			), nil
		}
		return nil, err
	}

	syncResp, syncErr := s.Sync(ctx, model.SyncRequest{
		TargetID:     req.TargetID,
		DBName:       req.DestDB,
		BranchName:   req.DestBranch,
		ExpectedHead: branchHead,
	})
	if syncErr != nil {
		message, retryReason, retryActions := classifyRowsAdminSyncFailure(syncErr)
		return adminPrepareRowsRetryResponse(
			mainHash,
			"",
			prep.preparedColumns,
			nil,
			message,
			retryReason,
			retryActions,
			true,
			false,
			false,
			true,
		), nil
	}

	visibility := s.preparedRowsBranchVisibility(ctx, req.TargetID, req.SourceTable, req.DestDB, req.DestBranch, syncResp.Hash, prep)
	if !visibility.Ready {
		logBranchQueryabilityFailure("cross_copy_admin_prepare_rows_branch_not_visible", req.TargetID, req.DestDB, req.DestBranch, visibility)
		return adminPrepareRowsRetryResponse(
			mainHash,
			syncResp.Hash,
			prep.preparedColumns,
			syncResp.OverwrittenTables,
			"schema prep と同期は完了しましたが、宛先ブランチへの反映を確認できませんでした。時間をおいてプレビューを更新してください。",
			"destination_branch_not_ready",
			[]model.RetryAction{{Action: "refresh_preview", Label: "プレビューを更新する"}},
			true,
			true,
			false,
			true,
		), nil
	}

	return &model.CrossCopyAdminPrepareRowsResponse{
		MainHash:          mainHash,
		BranchHash:        syncResp.Hash,
		PreparedColumns:   prep.preparedColumns,
		OverwrittenTables: syncResp.OverwrittenTables,
		OperationResultFields: model.OperationResultFields{
			Outcome: model.OperationOutcomeCompleted,
			Message: "schema prep とブランチ同期が完了しました。プレビューを更新して再試行してください。",
			Completion: map[string]bool{
				"protected_schema_prepared": true,
				"destination_branch_synced": true,
				"destination_branch_ready":  true,
				"protected_refs_clean":      true,
			},
		},
	}, nil
}

// CrossCopyAdminPrepareTable prepares destination main for a subsequent table copy retry.
func (s *Service) CrossCopyAdminPrepareTable(ctx context.Context, req model.CrossCopyAdminPrepareTableRequest) (*model.CrossCopyAdminPrepareTableResponse, error) {
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

	prep, err := s.crossCopySchemaPreparation(ctx, req.TargetID, req.SourceDB, req.SourceBranch, req.SourceTable, req.DestDB)
	if err != nil {
		return nil, err
	}

	mainHash, attempted, err := s.prepareCrossCopySchemaOnMain(ctx, req.TargetID, req.SourceDB, req.SourceBranch, req.SourceTable, req.DestDB, prep)
	if err != nil {
		if attempted {
			return adminPrepareTableRetryResponse(
				"",
				prep.preparedColumns,
				"宛先 main の schema 準備結果を確認できませんでした。main を確認してから再試行してください。",
				"protected_schema_commit_uncertain",
				[]model.RetryAction{{Action: "review_destination_main", Label: "dest main を確認する"}},
				false,
				false,
			), nil
		}
		return nil, err
	}

	return &model.CrossCopyAdminPrepareTableResponse{
		MainHash:        mainHash,
		PreparedColumns: prep.preparedColumns,
		OperationResultFields: model.OperationResultFields{
			Outcome: model.OperationOutcomeCompleted,
			Message: "schema prep が完了しました。コピーを再実行してください。",
			Completion: map[string]bool{
				"protected_schema_prepared": true,
				"protected_refs_clean":      true,
			},
		},
	}, nil
}

// CrossCopyAdminCleanupImport removes a deterministic import branch.
func (s *Service) CrossCopyAdminCleanupImport(ctx context.Context, req model.CrossCopyAdminCleanupImportRequest) (*model.CrossCopyAdminCleanupImportResponse, error) {
	if err := validation.ValidateDBName(req.DestDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効な宛先DB名"}
	}
	if err := validation.ValidateBranchName(req.BranchName); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なブランチ名"}
	}
	if !strings.HasPrefix(req.BranchName, crossCopyImportBranchPrefix) {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "cleanup 対象は wi/import-* ブランチのみです"}
	}
	if _, err := s.configuredDatabase(req.TargetID, req.DestDB); err != nil {
		return nil, err
	}

	conn, err := s.repo.ConnProtectedMaintenance(ctx, req.TargetID, req.DestDB, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to destination main: %w", err)
	}
	defer conn.Close()

	exists, err := branchExists(ctx, conn, req.BranchName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return &model.CrossCopyAdminCleanupImportResponse{
			BranchName: req.BranchName,
			OperationResultFields: model.OperationResultFields{
				Outcome: model.OperationOutcomeCompleted,
				Message: "stale import branch は見つかりませんでした。",
				Completion: map[string]bool{
					"destination_branch_removed": true,
					"protected_refs_clean":       true,
				},
			},
		}, nil
	}

	deleteErr := func() error {
		_, execErr := conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", req.BranchName)
		return execErr
	}()
	stillExists, verifyErr := branchExists(ctx, conn, req.BranchName)
	if verifyErr == nil && !stillExists {
		return &model.CrossCopyAdminCleanupImportResponse{
			BranchName: req.BranchName,
			OperationResultFields: model.OperationResultFields{
				Outcome: model.OperationOutcomeCompleted,
				Message: "stale import branch を掃除しました。コピーを再実行してください。",
				Completion: map[string]bool{
					"destination_branch_removed": true,
					"protected_refs_clean":       true,
				},
			},
		}, nil
	}
	if deleteErr != nil || verifyErr != nil || stillExists {
		return adminCleanupImportRetryResponse(
			req.BranchName,
			"stale import branch の掃除結果を確認できませんでした。確認してから再試行してください。",
			"destination_branch_cleanup_failed",
		), nil
	}
	return nil, fmt.Errorf("unexpected cleanup-import verification state")
}
