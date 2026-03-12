package service

import (
	"context"
	"fmt"
	"strings"

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

		// If the branch exists on the creating connection, USE db/branch is simply lagging.
		// Surface a recoverable state instead of returning opaque INTERNAL.
		exists, existsErr := branchExists(ctx, conn, req.BranchName)
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

	// Use safe delete (-d) instead of force delete (-D) to prevent deleting
	// branches that have unmerged changes. Force delete can destroy data and
	// also leaves stale branch references in pooled connections.
	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH('-d', ?)", req.BranchName)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "not fully merged") || strings.Contains(errMsg, "is not merged") {
			return &model.APIError{
				Status: 409,
				Code:   model.CodePreconditionFailed,
				Msg:    fmt.Sprintf("ブランチ '%s' にはmainにマージされていない変更があります。先に同期するか、強制削除してください", req.BranchName),
			}
		}
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
