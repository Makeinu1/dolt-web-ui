package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// SubmitRequest creates or replaces a request tag for approval.
// The request tag is fixed per WorkItem: req/<WorkItem>.
func (s *Service) SubmitRequest(ctx context.Context, req model.SubmitRequestRequest) (*model.SubmitRequestResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "cannot submit request from protected branch"}
	}

	if !isWorkBranchName(req.BranchName) {
		return nil, &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    "branch name must match pattern wi/<WorkItem>",
		}
	}

	requestID, ok := requestIDFromWorkBranch(req.BranchName)
	if !ok {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid work branch name"}
	}

	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

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

	// Keep the existing auto-sync UX before a request is submitted.
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	dataConflictTables, previewErr := s.previewMergeInfo(ctx, conn, req.BranchName)
	if previewErr != nil {
		safeRollback(conn)
		return nil, previewErr
	}

	var syncHash string
	var syncFF, syncConflicts int
	var syncMsg string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('main')").
		Scan(&syncHash, &syncFF, &syncConflicts, &syncMsg)
	if err != nil {
		safeRollback(conn)
		if !strings.Contains(err.Error(), "up to date") {
			return nil, fmt.Errorf("failed to auto-sync main: %w", err)
		}
	}

	var overwrittenTables []model.OverwrittenTable
	if syncConflicts > 0 {
		overwrittenTables, err = s.resolveDataConflicts(ctx, conn, dataConflictTables)
		if err != nil {
			safeRollback(conn)
			return nil, err
		}
		if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '--all', '-m', '承認申請前の自動同期: コンフリクト解決 (main優先)')"); err != nil {
			safeRollback(conn)
			return nil, fmt.Errorf("failed to commit resolved merge: %w", err)
		}
	}

	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		return nil, fmt.Errorf("failed to get HEAD after sync: %w", err)
	}

	submittedWorkHash := currentHead
	var submittedMainHash string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('main')").Scan(&submittedMainHash); err != nil {
		return nil, fmt.Errorf("failed to get main hash: %w", err)
	}

	tagMessage, err := json.Marshal(map[string]string{
		"schema":              "dolt-webui/request@2",
		"submitted_main_hash": submittedMainHash,
		"submitted_work_hash": submittedWorkHash,
		"submitted_at":        time.Now().UTC().Format(time.RFC3339),
		"work_branch":         req.BranchName,
		"summary_ja":          req.SummaryJa,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal tag message: %w", err)
	}

	var tagCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?", requestID).Scan(&tagCount); err == nil && tagCount > 0 {
		if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", requestID); err != nil {
			return nil, fmt.Errorf("failed to delete existing tag: %w", err)
		}
	}

	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-m', ?, ?, ?)", string(tagMessage), requestID, submittedWorkHash); err != nil {
		return nil, fmt.Errorf("failed to create tag: %w", err)
	}

	return &model.SubmitRequestResponse{
		RequestID:         requestID,
		SubmittedMainHash: submittedMainHash,
		SubmittedWorkHash: submittedWorkHash,
		OverwrittenTables: overwrittenTables,
	}, nil
}

// ListRequests returns all pending approval requests.
// This API is read-only and never performs cleanup.
func (s *Service) ListRequests(ctx context.Context, targetID, dbName string) ([]model.RequestSummary, error) {
	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx,
		"SELECT tag_name, tag_hash, message FROM dolt_tags WHERE tag_name LIKE 'req/%' ORDER BY tag_name")
	if err != nil {
		return nil, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	result := make([]model.RequestSummary, 0)
	for rows.Next() {
		var tagName, hash, message string
		if err := rows.Scan(&tagName, &hash, &message); err != nil {
			return nil, fmt.Errorf("failed to scan request: %w", err)
		}

		var meta map[string]string
		if jsonErr := json.Unmarshal([]byte(message), &meta); jsonErr != nil {
			log.Printf("WARN: failed to parse tag message for %s: %v", tagName, jsonErr)
			meta = map[string]string{}
		}

		workBranch, ok := workBranchFromRequestID(tagName)
		if !ok {
			log.Printf("WARN: skipping malformed request tag %s", tagName)
			continue
		}

		submittedWorkHash := meta["submitted_work_hash"]
		if submittedWorkHash == "" {
			submittedWorkHash = hash
		}

		result = append(result, model.RequestSummary{
			RequestID:         tagName,
			WorkBranch:        workBranch,
			SubmittedMainHash: meta["submitted_main_hash"],
			SubmittedWorkHash: submittedWorkHash,
			SummaryJa:         meta["summary_ja"],
			SubmittedAt:       meta["submitted_at"],
		})
	}
	return result, rows.Err()
}

// GetRequest returns details of a specific request.
func (s *Service) GetRequest(ctx context.Context, targetID, dbName, requestID string) (*model.RequestSummary, error) {
	if !isRequestTagName(requestID) {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid request_id format"}
	}

	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	var tagHash, message string
	err = conn.QueryRowContext(ctx,
		"SELECT tag_hash, message FROM dolt_tags WHERE tag_name = ?", requestID).Scan(&tagHash, &message)
	if err != nil {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "request not found"}
	}

	var meta map[string]string
	if jsonErr := json.Unmarshal([]byte(message), &meta); jsonErr != nil {
		log.Printf("WARN: failed to parse tag message for request %s: %v", requestID, jsonErr)
		meta = map[string]string{}
	}

	workBranch, ok := workBranchFromRequestID(requestID)
	if !ok {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid request_id format"}
	}

	submittedWorkHash := meta["submitted_work_hash"]
	if submittedWorkHash == "" {
		submittedWorkHash = tagHash
	}

	return &model.RequestSummary{
		RequestID:         requestID,
		WorkBranch:        workBranch,
		SubmittedMainHash: meta["submitted_main_hash"],
		SubmittedWorkHash: submittedWorkHash,
		SummaryJa:         meta["summary_ja"],
		SubmittedAt:       meta["submitted_at"],
	}, nil
}

// ApproveRequest performs a regular (non-squash) merge of work branch into main,
// archives the approval cycle, clears the request tag, and advances the same work
// branch to main HEAD for the next editing session.
func (s *Service) ApproveRequest(ctx context.Context, req model.ApproveRequest) (*model.ApproveResponse, error) {
	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	connClosed := false
	defer func() {
		if !connClosed {
			conn.Close()
		}
	}()

	var submittedWorkHash, message string
	err = conn.QueryRowContext(ctx,
		"SELECT tag_hash, message FROM dolt_tags WHERE tag_name = ?", req.RequestID).Scan(&submittedWorkHash, &message)
	if err != nil {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "request not found"}
	}

	var meta map[string]string
	if err := json.Unmarshal([]byte(message), &meta); err != nil {
		return nil, fmt.Errorf("failed to parse tag message: %w", err)
	}

	workBranch := meta["work_branch"]
	if !isWorkBranchName(workBranch) {
		fallbackBranch, ok := workBranchFromRequestID(req.RequestID)
		if !ok {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid request_id format"}
		}
		workBranch = fallbackBranch
	}

	var currentWorkHash string
	if err := conn.QueryRowContext(ctx, "SELECT HASHOF(?)", workBranch).Scan(&currentWorkHash); err != nil {
		return nil, fmt.Errorf("failed to get work HEAD: %w", err)
	}
	if currentWorkHash != submittedWorkHash {
		return nil, &model.APIError{
			Status:  412,
			Code:    model.CodePreconditionFailed,
			Msg:     "work branch has changed since submission",
			Details: map[string]string{"submitted_work_hash": submittedWorkHash, "current_work_hash": currentWorkHash},
		}
	}

	if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
		return nil, fmt.Errorf("failed to set autocommit: %w", err)
	}
	defer conn.ExecContext(context.Background(), "SET autocommit=0")

	var mergeHash string
	var fastForward, conflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE(?, '-m', ?)", workBranch, req.MergeMessageJa).
		Scan(&mergeHash, &fastForward, &conflicts, &mergeMessage)
	if err != nil {
		if strings.Contains(err.Error(), "Merge conflict detected") || strings.Contains(err.Error(), "conflict") {
			return nil, &model.APIError{
				Status: 409,
				Code:   model.CodeMergeConflictsPresent,
				Msg:    "merge conflicts detected - same cell edited in multiple branches",
				Details: map[string]interface{}{
					"hint": "Contact administrator for conflict resolution.",
				},
			}
		}
		return nil, fmt.Errorf("failed to merge: %w", err)
	}

	if conflicts > 0 {
		if _, err := conn.ExecContext(ctx, "CALL DOLT_MERGE('--abort')"); err != nil {
			log.Printf("WARN: merge abort failed: %v", err)
		}
		return nil, &model.APIError{
			Status: 409,
			Code:   model.CodeMergeConflictsPresent,
			Msg:    "merge conflicts detected - same cell edited in multiple branches",
			Details: map[string]interface{}{
				"conflicts": conflicts,
				"hint":      "Contact administrator for conflict resolution.",
			},
		}
	}

	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	bgCtx := context.Background()
	workItem, ok := workItemFromWorkBranch(workBranch)
	if !ok {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid work branch name"}
	}

	warnings := make([]string, 0)
	archiveTag, archiveErr := s.createArchiveTag(bgCtx, conn, workItem, req.MergeMessageJa)
	if archiveErr != nil {
		log.Printf("WARN: failed to create archive tag for %s: %v", workBranch, archiveErr)
		warnings = append(warnings, "mainへの反映は完了しましたが、履歴タグの保存に失敗しました。")
		archiveTag = ""
	}

	requestCleared := true
	if err := retryExec(bgCtx, 3, 500*time.Millisecond, func(execCtx context.Context) error {
		_, err := conn.ExecContext(execCtx, "CALL DOLT_TAG('-d', ?)", req.RequestID)
		return err
	}); err != nil {
		log.Printf("WARN: failed to delete request tag %s: %v", req.RequestID, err)
		requestCleared = false
		warnings = append(warnings, "mainへの反映は完了しましたが、申請タグの解除に失敗しました。Inbox から再試行または却下を行ってください。")
	}

	connClosed = true
	conn.Close()

	branchAdvanced := false
	branchConn, err := s.repo.ConnDB(bgCtx, req.TargetID, req.DBName)
	if err != nil {
		log.Printf("WARN: failed to open branch maintenance connection for %s: %v", workBranch, err)
		warnings = append(warnings, fmt.Sprintf("作業ブランチ %s を main 最新位置へ進められませんでした。次回は main から同期して再開してください。", workBranch))
	} else {
		defer branchConn.Close()
		branchAdvanced = s.advanceWorkBranch(bgCtx, branchConn, req.TargetID, req.DBName, workBranch, &warnings)
	}

	branchReady := requestCleared && branchAdvanced

	return &model.ApproveResponse{
		Hash:                 newHead,
		ActiveBranch:         workBranch,
		ActiveBranchAdvanced: branchReady,
		ArchiveTag:           archiveTag,
		Warnings:             warnings,
	}, nil
}

func (s *Service) createArchiveTag(ctx context.Context, conn *sql.Conn, workItem, mergeMessage string) (string, error) {
	sequence, err := s.nextArchiveSequence(ctx, conn, workItem)
	if err != nil {
		return "", err
	}

	archiveTag := archiveTagForWorkItem(workItem, sequence)
	if err := retryExec(ctx, 3, 500*time.Millisecond, func(execCtx context.Context) error {
		_, err := conn.ExecContext(execCtx, "CALL DOLT_TAG('-m', ?, ?, 'HEAD')", mergeMessage, archiveTag)
		return err
	}); err != nil {
		return "", err
	}
	return archiveTag, nil
}

func (s *Service) nextArchiveSequence(ctx context.Context, conn *sql.Conn, workItem string) (int, error) {
	rows, err := conn.QueryContext(ctx, "SELECT tag_name FROM dolt_tags WHERE tag_name LIKE ?", archiveTagPrefixForWorkItem(workItem)+"%")
	if err != nil {
		return 0, fmt.Errorf("failed to list archive tags: %w", err)
	}
	defer rows.Close()

	nextSequence := 1
	for rows.Next() {
		var tagName string
		if err := rows.Scan(&tagName); err != nil {
			return 0, fmt.Errorf("failed to scan archive tag: %w", err)
		}
		_, sequence, ok := parseArchiveTag(tagName)
		if ok && sequence >= nextSequence {
			nextSequence = sequence + 1
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return nextSequence, nil
}

func (s *Service) advanceWorkBranch(ctx context.Context, conn *sql.Conn, targetID, dbName, workBranch string, warnings *[]string) bool {
	if err := retryExec(ctx, 3, 500*time.Millisecond, func(execCtx context.Context) error {
		_, err := conn.ExecContext(execCtx, "CALL DOLT_BRANCH('-f', ?, 'main')", workBranch)
		return err
	}); err != nil {
		log.Printf("WARN: failed to advance work branch %s to main: %v", workBranch, err)
		*warnings = append(*warnings, fmt.Sprintf("作業ブランチ %s を main 最新位置へ進められませんでした。次回は main から同期して再開してください。", workBranch))
		return false
	}

	if err := s.verifyBranchQueryable(ctx, targetID, dbName, workBranch); err != nil {
		log.Printf("WARN: advanced branch %s not yet queryable: %v", workBranch, err)
		*warnings = append(*warnings, fmt.Sprintf("作業ブランチ %s は更新済みですが、接続反映を確認できませんでした。時間をおいて再度開いてください。", workBranch))
		return false
	}

	return true
}

func retryExec(ctx context.Context, attempts int, delay time.Duration, fn func(context.Context) error) error {
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if err := fn(ctx); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if attempt < attempts-1 {
			time.Sleep(delay)
		}
	}
	return lastErr
}

// RejectRequest deletes the request tag only.
// Branch is kept for user to fix and re-submit.
func (s *Service) RejectRequest(ctx context.Context, req model.RejectRequest) error {
	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	var count int
	err = conn.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?", req.RequestID).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to query tag: %w", err)
	}
	if count == 0 {
		return &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "request not found"}
	}

	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", req.RequestID); err != nil {
		return fmt.Errorf("failed to delete tag: %w", err)
	}

	return nil
}
