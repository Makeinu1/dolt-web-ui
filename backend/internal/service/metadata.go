package service

import (
	"context"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
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
		return nil, err
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

	var branches []model.BranchResponse
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

	_, err = conn.ExecContext(ctx, "CALL DOLT_BRANCH(?, 'main')", req.BranchName)
	if err != nil {
		return fmt.Errorf("failed to create branch: %w", err)
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
