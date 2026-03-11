package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func branchExists(ctx context.Context, conn *sql.Conn, branchName string) (bool, error) {
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_branches WHERE name = ?", branchName).Scan(&count); err != nil {
		return false, fmt.Errorf("failed to query branch existence: %w", err)
	}
	return count > 0, nil
}

func newBranchExistsError(branchName string) *model.APIError {
	return &model.APIError{
		Status: 409,
		Code:   model.CodeBranchExists,
		Msg:    fmt.Sprintf("ブランチ %s は既に存在します。既存の作業ブランチを開いて続行してください。", branchName),
		Details: map[string]interface{}{
			"branch_name":   branchName,
			"open_existing": true,
		},
	}
}

func newBranchNotReadyError(branchName string, retryAfterMs int) *model.APIError {
	return &model.APIError{
		Status: 409,
		Code:   model.CodeBranchNotReady,
		Msg:    fmt.Sprintf("ブランチ %s は作成されましたが、まだ接続準備が完了していません。少し待ってから開いてください。", branchName),
		Details: map[string]interface{}{
			"branch_name":    branchName,
			"retry_after_ms": retryAfterMs,
		},
	}
}

func isDuplicateBranchCreateErr(err error) bool {
	if err == nil {
		return false
	}
	errText := strings.ToLower(err.Error())
	return strings.Contains(errText, "already exists") ||
		strings.Contains(errText, "branch exists") ||
		strings.Contains(errText, "existing branch")
}

func classifyBranchCreateError(ctx context.Context, conn *sql.Conn, branchName string, createErr error) error {
	if isDuplicateBranchCreateErr(createErr) {
		return newBranchExistsError(branchName)
	}
	exists, err := branchExists(ctx, conn, branchName)
	if err == nil && exists {
		return newBranchExistsError(branchName)
	}
	return fmt.Errorf("failed to create branch: %w", createErr)
}
