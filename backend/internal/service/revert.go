package service

import (
	"context"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// Revert reverts a specific commit by hash and creates a new commit on the work branch.
func (s *Service) Revert(ctx context.Context, req model.RevertRequest) (*model.RevertResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}
	if req.RevertHash == "" {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "revert_hash is required"}
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

	// Step 1: Call DOLT_REVERT
	if _, err := conn.ExecContext(ctx, "CALL DOLT_REVERT(?)", req.RevertHash); err != nil {
		return nil, fmt.Errorf("dolt revert failed: %w", err)
	}

	var newHash string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHash); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD hash: %w", err)
	}

	return &model.RevertResponse{Hash: newHash}, nil
}
