package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// workBranchRe validates work branch names: wi/<WorkItem>/<Round>
var workBranchRe = regexp.MustCompile(`^wi/[A-Za-z0-9._-]+/[0-9]{2}$`)

// requestIDRe validates request IDs: req/<WorkItem>/<Round>
var requestIDRe = regexp.MustCompile(`^req/[A-Za-z0-9._-]+/[0-9]{2}$`)

// nextRoundRe extracts item and round from wi/<WorkItem>/<Round>
var nextRoundRe = regexp.MustCompile(`^wi/(.+)/(\d{2})$`)

// SubmitRequest creates a request tag for approval.
// Per v6f spec section 9.1: derives request_id from work branch name,
// captures hashes, and creates/upserts a dolt_tag.
func (s *Service) SubmitRequest(ctx context.Context, req model.SubmitRequestRequest) (*model.SubmitRequestResponse, error) {
	if validation.IsMainBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "cannot submit request from main branch"}
	}

	// Validate branch name pattern: wi/<WorkItem>/<Round>
	if !workBranchRe.MatchString(req.BranchName) {
		return nil, &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    "branch name must match pattern wi/<WorkItem>/<Round>",
		}
	}

	// Derive request_id: wi/ → req/
	requestID := "req/" + strings.TrimPrefix(req.BranchName, "wi/")

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Step 1: expected_head check
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

	// Step 1.5: Auto-sync main into work branch before submit
	if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
		return nil, fmt.Errorf("failed to set autocommit: %w", err)
	}
	defer conn.ExecContext(ctx, "SET autocommit=0")

	var syncHash string
	var syncFF, syncConflicts int
	var syncMsg string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('main')").
		Scan(&syncHash, &syncFF, &syncConflicts, &syncMsg)
	if err != nil {
		if strings.Contains(err.Error(), "conflict") {
			return nil, &model.APIError{
				Status: 409,
				Code:   model.CodeMergeConflictsPresent,
				Msg:    "Main との同期でコンフリクトが検出されました。ダイアログを閉じてコンフリクトを解決してください。",
			}
		}
		// If merge returns "nothing to merge" or similar non-error, continue
		if !strings.Contains(err.Error(), "up to date") {
			return nil, fmt.Errorf("failed to auto-sync main: %w", err)
		}
	}
	if syncConflicts > 0 {
		// Abort the conflicting merge
		conn.ExecContext(ctx, "CALL DOLT_MERGE('--abort')")
		return nil, &model.APIError{
			Status: 409,
			Code:   model.CodeMergeConflictsPresent,
			Msg:    "Main との同期でコンフリクトが検出されました。ダイアログを閉じてコンフリクトを解決してください。",
		}
	}

	// Re-read HEAD after potential sync merge
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		return nil, fmt.Errorf("failed to get HEAD after sync: %w", err)
	}

	// Step 2: Capture hashes
	submittedWorkHash := currentHead
	var submittedMainHash string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('main')").Scan(&submittedMainHash); err != nil {
		return nil, fmt.Errorf("failed to get main hash: %w", err)
	}

	// Step 3: Build tag message JSON (includes summary_ja for approver review)
	tagMessage, err := json.Marshal(map[string]string{
		"schema":              "dolt-webui/request@1",
		"submitted_main_hash": submittedMainHash,
		"submitted_work_hash": submittedWorkHash,
		"submitted_at":        time.Now().UTC().Format(time.RFC3339),
		"work_branch":         req.BranchName,
		"summary_ja":          req.SummaryJa,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal tag message: %w", err)
	}

	// Step 4: Upsert tag (delete if exists, then create)
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
	}, nil
}

// ListRequests returns all pending approval requests.
// Per v6f spec section 9.2: queries dolt_tags with req/ prefix.
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

		// Parse message JSON to extract metadata
		var meta map[string]string
		json.Unmarshal([]byte(message), &meta)

		workBranch := "wi/" + strings.TrimPrefix(tagName, "req/")

		result = append(result, model.RequestSummary{
			RequestID:         tagName,
			WorkBranch:        workBranch,
			SubmittedMainHash: meta["submitted_main_hash"],
			SubmittedWorkHash: hash,
			SummaryJa:         meta["summary_ja"],
			SubmittedAt:       meta["submitted_at"],
		})
	}
	return result, rows.Err()
}

// GetRequest returns details of a specific request.
func (s *Service) GetRequest(ctx context.Context, targetID, dbName, requestID string) (*model.RequestSummary, error) {
	if !requestIDRe.MatchString(requestID) {
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
	json.Unmarshal([]byte(message), &meta)

	workBranch := "wi/" + strings.TrimPrefix(requestID, "req/")

	return &model.RequestSummary{
		RequestID:         requestID,
		WorkBranch:        workBranch,
		SubmittedMainHash: meta["submitted_main_hash"],
		SubmittedWorkHash: tagHash,
		SummaryJa:         meta["summary_ja"],
		SubmittedAt:       meta["submitted_at"],
	}, nil
}

// ApproveRequest performs a regular (non-squash) merge of work branch into main.
// Removes freeze gate to enable parallel merges, relying on Dolt's cell-level 3-way merge.
func (s *Service) ApproveRequest(ctx context.Context, req model.ApproveRequest) (*model.ApproveResponse, error) {
	// Step 0: Get request tag info
	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

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

	// Step 1: Work HEAD integrity check (NOT freeze gate - only checks work branch unchanged)
	workConn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, workBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to work branch: %w", err)
	}
	var currentWorkHash string
	if err := workConn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentWorkHash); err != nil {
		workConn.Close()
		return nil, fmt.Errorf("failed to get work HEAD: %w", err)
	}
	workConn.Close()
	if currentWorkHash != submittedWorkHash {
		return nil, &model.APIError{
			Status:  412,
			Code:    model.CodePreconditionFailed,
			Msg:     "work branch has changed since submission",
			Details: map[string]string{"submitted_work_hash": submittedWorkHash, "current_work_hash": currentWorkHash},
		}
	}

	// Step 2: Regular merge with autocommit (enables immediate commit)
	if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
		return nil, fmt.Errorf("failed to set autocommit: %w", err)
	}
	// Reset autocommit to prevent pool pollution (sync.go pattern)
	defer conn.ExecContext(ctx, "SET autocommit=0")

	// DOLT_MERGE with parameterized query (prevents SQL injection).
	// With autocommit=1, Dolt auto-rolls back conflicting merges and returns error 1105
	// ("Merge conflict detected") instead of returning conflicts>0 in the result row.
	// Detect this and map to MERGE_CONFLICTS_PRESENT.
	var mergeHash string
	var fastForward, conflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE(?, '-m', ?)", workBranch, req.MergeMessageJa).
		Scan(&mergeHash, &fastForward, &conflicts, &mergeMessage)
	if err != nil {
		if strings.Contains(err.Error(), "Merge conflict detected") || strings.Contains(err.Error(), "conflict") {
			// autocommit=1: Dolt already rolled back the transaction automatically.
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
		// Fallback: conflicts returned in result row (non-autocommit path).
		// Abort to restore clean state.
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

	// Step 3: Post-processing (log errors but continue)
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	// Audit tag: merged/<WorkItem>/<Round>
	mergedTag := "merged/" + strings.TrimPrefix(req.RequestID, "req/")
	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-m', ?, ?, 'HEAD')", req.MergeMessageJa, mergedTag); err != nil {
		log.Printf("ERROR: audit tag creation failed for %s: %v", mergedTag, err)
	}

	// Delete request tag
	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", req.RequestID); err != nil {
		log.Printf("ERROR: req tag deletion failed for %s: %v", req.RequestID, err)
	}

	// Delete old work branch
	if _, err := conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", workBranch); err != nil {
		log.Printf("ERROR: branch deletion failed for %s: %v", workBranch, err)
	}

	// Step 4: Create next round branch
	// Parse: wi/ProjectA/01 → item="ProjectA", round=1
	matches := nextRoundRe.FindStringSubmatch(workBranch)
	if len(matches) != 3 {
		return nil, fmt.Errorf("invalid work branch format: %s", workBranch)
	}
	item := matches[1]
	round, err := strconv.Atoi(matches[2])
	if err != nil {
		return nil, fmt.Errorf("failed to parse round number: %w", err)
	}
	nextBranch := fmt.Sprintf("wi/%s/%02d", item, round+1)

	// Create next branch from current main HEAD
	if _, err := conn.ExecContext(ctx, "CALL DOLT_BRANCH(?)", nextBranch); err != nil {
		log.Printf("ERROR: next branch creation failed for %s: %v", nextBranch, err)
		// Non-fatal: return success with empty next_branch
		return &model.ApproveResponse{Hash: newHead, NextBranch: ""}, nil
	}

	return &model.ApproveResponse{Hash: newHead, NextBranch: nextBranch}, nil
}

// RejectRequest deletes the request tag only.
// Branch is kept for user to fix and re-submit. No rej tag needed (simplicity).
func (s *Service) RejectRequest(ctx context.Context, req model.RejectRequest) error {
	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Verify request exists
	var count int
	err = conn.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?", req.RequestID).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to query tag: %w", err)
	}
	if count == 0 {
		return &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "request not found"}
	}

	// Delete request tag only
	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", req.RequestID); err != nil {
		return fmt.Errorf("failed to delete tag: %w", err)
	}

	// Branch remains for user to fix and re-submit
	// No rej tag created (simpler: absence of req tag = rejected)
	return nil
}
