package service

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

var commitHashRefRe = regexp.MustCompile(`^[0-9a-z]{32}$`)

func (s *Service) configuredDatabase(targetID, dbName string) (*config.Database, error) {
	if _, err := s.cfg.FindTarget(targetID); err != nil {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: err.Error()}
	}
	db, err := s.cfg.FindDatabase(targetID, dbName)
	if err != nil {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: err.Error()}
	}
	return db, nil
}

func (s *Service) ensureAllowedBranchRef(targetID, dbName, branchName string) error {
	if err := validation.ValidateBranchName(branchName); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	db, err := s.configuredDatabase(targetID, dbName)
	if err != nil {
		return err
	}
	if validation.IsAllowedBranch(branchName, db.AllowedBranches) {
		return nil
	}
	return &model.APIError{
		Status: 403,
		Code:   model.CodeForbidden,
		Msg:    fmt.Sprintf("branch %s is not allowed for database %s", branchName, dbName),
	}
}

func (s *Service) filterAllowedBranches(targetID, dbName string, branches []model.BranchResponse) ([]model.BranchResponse, error) {
	db, err := s.configuredDatabase(targetID, dbName)
	if err != nil {
		return nil, err
	}

	filtered := make([]model.BranchResponse, 0, len(branches))
	for _, branch := range branches {
		if validation.IsAllowedBranch(branch.Name, db.AllowedBranches) {
			filtered = append(filtered, branch)
		}
	}
	return filtered, nil
}

func (s *Service) lookupNamedRef(ctx context.Context, targetID, dbName, refName string) (branchExists, tagExists bool, err error) {
	conn, err := s.connMetadataRevision(ctx, targetID, dbName)
	if err != nil {
		return false, false, err
	}
	defer conn.Close()

	var branchCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_branches WHERE name = ?", refName).Scan(&branchCount); err != nil {
		return false, false, fmt.Errorf("failed to query branches: %w", err)
	}

	var tagCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?", refName).Scan(&tagCount); err != nil {
		return false, false, fmt.Errorf("failed to query tags: %w", err)
	}

	return branchCount > 0, tagCount > 0, nil
}

func isHistoryExpressionRef(refName string) bool {
	return commitHashRefRe.MatchString(refName) || strings.ContainsAny(refName, "^~")
}

func (s *Service) ensureHistoryRef(ctx context.Context, targetID, dbName, refName string) error {
	if err := validation.ValidateRevisionRef(refName); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	db, err := s.configuredDatabase(targetID, dbName)
	if err != nil {
		return err
	}
	if validation.IsAllowedBranch(refName, db.AllowedBranches) {
		return nil
	}

	branchExists, tagExists, err := s.lookupNamedRef(ctx, targetID, dbName, refName)
	if err != nil {
		return err
	}
	if branchExists {
		return &model.APIError{
			Status: 403,
			Code:   model.CodeForbidden,
			Msg:    fmt.Sprintf("branch %s is not allowed for database %s", refName, dbName),
		}
	}
	if tagExists || isHistoryExpressionRef(refName) {
		return nil
	}

	return &model.APIError{
		Status: 403,
		Code:   model.CodeForbidden,
		Msg:    fmt.Sprintf("ref %s is not allowed for database %s", refName, dbName),
	}
}

func (s *Service) connAllowedRevision(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := s.ensureAllowedBranchRef(targetID, dbName, branchName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}

func (s *Service) connHistoryRevision(ctx context.Context, targetID, dbName, refName string) (*sql.Conn, error) {
	if err := s.ensureHistoryRef(ctx, targetID, dbName, refName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnRevision(ctx, targetID, dbName, refName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}

func (s *Service) connMetadataRevision(ctx context.Context, targetID, dbName string) (*sql.Conn, error) {
	if _, err := s.configuredDatabase(targetID, dbName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnRevision(ctx, targetID, dbName, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}

func (s *Service) ensureAllowedWorkBranchWrite(targetID, dbName, branchName string) error {
	if err := validation.ValidateBranchName(branchName); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if !validation.IsWorkBranchName(branchName) {
		return &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    "branch name must match pattern wi/<WorkItem>",
		}
	}
	return s.ensureAllowedBranchRef(targetID, dbName, branchName)
}

func (s *Service) connAllowedWorkBranchWrite(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := s.ensureAllowedWorkBranchWrite(targetID, dbName, branchName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnWorkBranchWrite(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}

func (s *Service) ensureCrossCopySourceRef(targetID, dbName, branchName string) error {
	if err := validation.ValidateBranchName(branchName); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if !validation.IsProtectedBranch(branchName) {
		return &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    "コピー元ブランチは main または audit のみです",
		}
	}
	return s.ensureAllowedBranchRef(targetID, dbName, branchName)
}

func (s *Service) connCrossCopySourceRevision(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := s.ensureCrossCopySourceRef(targetID, dbName, branchName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}

func (s *Service) ensureCrossCopyDestinationBranch(targetID, dbName, branchName string) error {
	if err := validation.ValidateBranchName(branchName); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if !validation.IsWorkBranchName(branchName) {
		return &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    "コピー先ブランチは wi/* のみです",
		}
	}
	return s.ensureAllowedBranchRef(targetID, dbName, branchName)
}

func (s *Service) connCrossCopyDestinationRevision(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := s.ensureCrossCopyDestinationBranch(targetID, dbName, branchName); err != nil {
		return nil, err
	}
	conn, err := s.repo.ConnRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	return conn, nil
}
