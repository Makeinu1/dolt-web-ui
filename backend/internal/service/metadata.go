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
	conn, err := s.connMetadataRevision(ctx, targetID, dbName)
	if err != nil {
		return nil, err
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return s.filterAllowedBranches(targetID, dbName, branches)
}

func (s *Service) CreateBranch(ctx context.Context, req model.CreateBranchRequest) error {
	if err := s.ensureAllowedWorkBranchWrite(req.TargetID, req.DBName, req.BranchName); err != nil {
		return err
	}

	conn, err := s.repo.ConnProtectedMaintenance(ctx, req.TargetID, req.DBName, "main")
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// The protected maintenance session is checked out on main, so single-arg
	// DOLT_BRANCH creates from main HEAD.
	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH(?)", req.BranchName)
	if err != nil {
		return classifyBranchCreateError(ctx, conn, req.BranchName, err)
	}

	// Verify the branch is queryable on a fresh connection (USE db/branch).
	// Dolt may need a moment to propagate the branch across connections.
	readiness := s.branchReadiness(ctx, req.TargetID, req.DBName, req.BranchName)
	if !readiness.Ready {
		logBranchQueryabilityFailure("create_branch_not_ready", req.TargetID, req.DBName, req.BranchName, readiness)

		// Purge idle connections to clear any poisoned connections (e.g. open transactions
		// left by sync/submit) that may have caused the readiness probe to fail.
		s.repo.PurgeIdleConns(req.TargetID)

		// Use context.Background() because the HTTP request context may already be
		// canceled after the readiness probe timeout. With a canceled context,
		// branchExists would fail and we'd fall through to the opaque 500 error
		// instead of returning the retryable BRANCH_NOT_READY.
		exists, existsErr := branchExists(context.Background(), conn, req.BranchName)
		if existsErr == nil && exists {
			return newBranchNotReadyError(req.BranchName, s.branchReadyRetryAfterMS())
		}

		// Fall back to a fresh connection check if the creating connection cannot confirm.
		checkConn, checkErr := s.repo.ConnRevision(context.Background(), req.TargetID, req.DBName, "main")
		if checkErr == nil {
			defer checkConn.Close()
			exists, existsErr = branchExists(context.Background(), checkConn, req.BranchName)
			if existsErr == nil && exists {
				return newBranchNotReadyError(req.BranchName, s.branchReadyRetryAfterMS())
			}
		}
		return fmt.Errorf("branch created but not yet queryable via USE: %w", readiness.Err(req.BranchName))
	}
	return nil
}

func (s *Service) GetBranchReady(ctx context.Context, targetID, dbName, branchName string) (*model.BranchReadyResponse, error) {
	if err := s.ensureAllowedBranchRef(targetID, dbName, branchName); err != nil {
		return nil, err
	}

	conn, err := s.connMetadataRevision(ctx, targetID, dbName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	exists, err := branchExists(ctx, conn, branchName)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: fmt.Sprintf("branch %s not found", branchName)}
	}

	readiness := s.branchReadiness(ctx, targetID, dbName, branchName)
	if !readiness.Ready {
		return nil, newBranchNotReadyError(branchName, s.branchReadyRetryAfterMS())
	}

	return &model.BranchReadyResponse{Ready: true}, nil
}

func (s *Service) DeleteBranch(ctx context.Context, req model.DeleteBranchRequest) error {
	if validation.IsProtectedBranch(req.BranchName) {
		return &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "protected branch cannot be deleted"}
	}

	if err := s.ensureAllowedWorkBranchWrite(req.TargetID, req.DBName, req.BranchName); err != nil {
		return err
	}

	conn, err := s.repo.ConnProtectedMaintenance(ctx, req.TargetID, req.DBName, "main")
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	if apiErr := checkBranchLocked(ctx, conn, req.BranchName); apiErr != nil {
		return apiErr
	}

	// Force delete (-D) is required because Dolt's safe delete (-d) refuses to
	// delete any branch not fully merged into HEAD, including freshly created
	// branches with no changes ("unsafe to delete or rename" error).
	// PurgeIdleConns below prevents stale pooled connections from causing
	// cascading "branch not found" errors after deletion.
	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH('-D', ?)", req.BranchName)
	if err != nil {
		return fmt.Errorf("failed to delete branch: %w", err)
	}

	// Purge idle connections to prevent stale branch/database contexts from
	// lingering in the pool. Without this, pooled connections that were
	// previously set to USE `db/deletedBranch` would fail on reuse.
	s.repo.PurgeIdleConns(req.TargetID)

	return nil
}

func (s *Service) GetHead(ctx context.Context, targetID, dbName, branchName string) (*model.HeadResponse, error) {
	if err := s.ensureAllowedBranchRef(targetID, dbName, branchName); err != nil {
		return nil, err
	}

	conn, err := s.connMetadataRevision(ctx, targetID, dbName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	var hash string
	err = conn.QueryRowContext(ctx, "SELECT HASHOF(?)", branchName).Scan(&hash)
	if err != nil {
		return nil, fmt.Errorf("failed to get head: %w", err)
	}
	return &model.HeadResponse{Hash: hash}, nil
}
