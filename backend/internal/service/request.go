package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// workBranchRe validates work branch names: wi/<WorkItem>/<Round>
var workBranchRe = regexp.MustCompile(`^wi/[A-Za-z0-9._-]+/[0-9]{2}$`)

// requestIDRe validates request IDs: req/<WorkItem>/<Round>
var requestIDRe = regexp.MustCompile(`^req/[A-Za-z0-9._-]+/[0-9]{2}$`)

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

// ApproveRequest performs a squash merge of work branch into main.
// Per v6f spec section 9.3: freeze gate check → squash merge → audit tag → delete req tag.
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
	submittedMainHash := meta["submitted_main_hash"]
	workBranch := meta["work_branch"]

	// Step 1: Freeze gate check - verify main hasn't changed
	var currentMainHash string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('main')").Scan(&currentMainHash); err != nil {
		return nil, fmt.Errorf("failed to get main hash: %w", err)
	}
	if currentMainHash != submittedMainHash {
		return nil, &model.APIError{
			Status:  412,
			Code:    model.CodePreconditionFailed,
			Msg:     "main branch has changed since submission",
			Details: map[string]string{"submitted_main_hash": submittedMainHash, "current_main_hash": currentMainHash},
		}
	}

	// Step 1b: Verify work branch HEAD hasn't changed
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

	// Step 2: Squash merge on main
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	if _, err := conn.ExecContext(ctx, fmt.Sprintf("CALL DOLT_MERGE('%s', '--squash')", workBranch)); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to squash merge: %w", err)
	}

	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('-am', ?)", req.MergeMessageJa); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	// Audit tag: merged/<WorkItem>/<Round>
	mergedTag := "merged/" + strings.TrimPrefix(req.RequestID, "req/")
	conn.ExecContext(ctx, "CALL DOLT_TAG('-m', ?, ?, 'HEAD')", req.MergeMessageJa, mergedTag)

	// Delete request tag
	conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", req.RequestID)

	// Delete work branch (cleanup after merge)
	conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", workBranch)

	// Get new HEAD
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.ApproveResponse{Hash: newHead}, nil
}

// RejectRequest deletes the request tag and creates an audit tag.
// Per v6f spec section 9.4: delete req tag, create rej tag.
func (s *Service) RejectRequest(ctx context.Context, req model.RejectRequest) error {
	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Get tag info before deletion
	var hash string
	err = conn.QueryRowContext(ctx,
		"SELECT tag_hash FROM dolt_tags WHERE tag_name = ?", req.RequestID).Scan(&hash)
	if err != nil {
		return &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "request not found"}
	}

	// Delete request tag
	if _, err := conn.ExecContext(ctx, "CALL DOLT_TAG('-d', ?)", req.RequestID); err != nil {
		return fmt.Errorf("failed to delete tag: %w", err)
	}

	// Create audit tag: rej/<WorkItem>/<Round>
	rejTag := "rej/" + strings.TrimPrefix(req.RequestID, "req/")
	rejMessage := fmt.Sprintf("却下: %s at %s", req.RequestID, time.Now().UTC().Format(time.RFC3339))
	conn.ExecContext(ctx, "CALL DOLT_TAG('-m', ?, ?, ?)", rejMessage, rejTag, hash)

	// Delete work branch (cleanup after rejection)
	workBranch := "wi/" + strings.TrimPrefix(req.RequestID, "req/")
	conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", workBranch)

	return nil
}
