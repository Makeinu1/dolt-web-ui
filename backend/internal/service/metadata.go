package service

import (
	"context"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func (s *Service) ListTargets() []model.TargetResponse {
	targets := make([]model.TargetResponse, len(s.cfg.Targets))
	for i, t := range s.cfg.Targets {
		targets[i] = model.TargetResponse{ID: t.ID}
	}
	return targets
}

func (s *Service) ListDatabases(targetID string) ([]model.DatabaseResponse, error) {
	if _, err := s.cfg.FindTarget(targetID); err != nil {
		return nil, fmt.Errorf("failed to list databases: %w", err)
	}

	dbs := s.cfg.FindDatabases(targetID)
	result := make([]model.DatabaseResponse, len(dbs))
	for i, db := range dbs {
		result[i] = model.DatabaseResponse{Name: db.Name}
	}
	return result, nil
}

func (s *Service) ListBranches(ctx context.Context, targetID, dbName string) ([]model.BranchResponse, error) {
	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, "SELECT name, hash FROM dolt_branches")
	if err != nil {
		return nil, fmt.Errorf("failed to query branches: %w", err)
	}
	defer rows.Close()

	branches := make([]model.BranchResponse, 0)
	for rows.Next() {
		var b model.BranchResponse
		if err := rows.Scan(&b.Name, &b.Hash); err != nil {
			return nil, fmt.Errorf("failed to scan branch: %w", err)
		}
		branches = append(branches, b)
	}
	return branches, rows.Err()
}

func (s *Service) CreateBranch(ctx context.Context, req model.CreateBranchRequest) error {
	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// ConnDB already sets USE db/main, so single-arg form creates from main HEAD.
	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH(?)", req.BranchName)
	if err != nil {
		return classifyBranchCreateError(ctx, conn, req.BranchName, err)
	}

	// Verify the branch is queryable on a fresh connection (USE db/branch).
	// Dolt may need a moment to propagate the branch across connections.
	queryability := s.verifyBranchQueryable(ctx, req.TargetID, req.DBName, req.BranchName)
	if !queryability.Ready {
		logBranchQueryabilityFailure("create_branch_not_ready", req.TargetID, req.DBName, req.BranchName, queryability)

		// If the branch exists on the creating connection, USE db/branch is simply lagging.
		// Surface a recoverable state instead of returning opaque INTERNAL.
		exists, existsErr := branchExists(ctx, conn, req.BranchName)
		if existsErr == nil && exists {
			return newBranchNotReadyError(req.BranchName, s.branchReadyRetryAfterMS())
		}

		// Fall back to a fresh connection check if the creating connection cannot confirm.
		checkConn, checkErr := s.repo.ConnDB(context.Background(), req.TargetID, req.DBName)
		if checkErr == nil {
			defer checkConn.Close()
			exists, existsErr = branchExists(context.Background(), checkConn, req.BranchName)
			if existsErr == nil && exists {
				return newBranchNotReadyError(req.BranchName, s.branchReadyRetryAfterMS())
			}
		}
		return fmt.Errorf("branch created but not yet queryable via USE: %w", queryability.Err(req.BranchName))
	}
	return nil
}

func (s *Service) GetBranchReady(ctx context.Context, targetID, dbName, branchName string) (*model.BranchReadyResponse, error) {
	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	exists, err := branchExists(ctx, conn, branchName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: fmt.Sprintf("branch %s not found", branchName)}
	}

	if err := s.checkBranchQueryableOnce(ctx, targetID, dbName, branchName); err != nil {
		return nil, newBranchNotReadyError(branchName, s.branchReadyRetryAfterMS())
	}

	return &model.BranchReadyResponse{Ready: true}, nil
}

func (s *Service) DeleteBranch(ctx context.Context, req model.DeleteBranchRequest) error {
	if validation.IsProtectedBranch(req.BranchName) {
		return &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "protected branch cannot be deleted"}
	}

	conn, err := s.repo.ConnDB(ctx, req.TargetID, req.DBName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	if apiErr := checkBranchLocked(ctx, conn, req.BranchName); apiErr != nil {
		return apiErr
	}

	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", req.BranchName)
	if err != nil {
		return fmt.Errorf("failed to delete branch: %w", err)
	}
	return nil
}

func (s *Service) GetHead(ctx context.Context, targetID, dbName, branchName string) (*model.HeadResponse, error) {
	conn, err := s.repo.ConnDB(ctx, targetID, dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	var hash string
	err = conn.QueryRowContext(ctx, "SELECT HASHOF(?)", branchName).Scan(&hash)
	if err != nil {
		return nil, fmt.Errorf("failed to get head: %w", err)
	}
	return &model.HeadResponse{Hash: hash}, nil
}
