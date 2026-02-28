package service

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// AuditMerge merges audit → main with memo table protection.
// Flow:
//  1. Connect to main branch (writable)
//  2. List _memo_* tables for later restoration
//  3. Save pre-merge HEAD hash
//  4. SET autocommit=1 + DOLT_MERGE('audit')
//  5. Restore _memo_* tables from pre-merge state
//  6. Commit memo restoration if needed
//  7. Reset autocommit=0
func (s *Service) AuditMerge(ctx context.Context, req model.AuditMergeRequest) (*model.AuditMergeResponse, error) {
	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, "main")
	if err != nil {
		return nil, fmt.Errorf("failed to connect to main: %w", err)
	}
	defer conn.Close()

	// Verify audit branch exists
	var auditExists int
	err = conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_branches WHERE name = 'audit'").Scan(&auditExists)
	if err != nil {
		return nil, fmt.Errorf("failed to check audit branch: %w", err)
	}
	if auditExists == 0 {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "auditブランチが見つかりません"}
	}

	// List _memo_* tables
	memoTables, err := listMemoTables(ctx, conn)
	if err != nil {
		return nil, fmt.Errorf("failed to list memo tables: %w", err)
	}

	// Save pre-merge HEAD
	var preMergeHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&preMergeHead); err != nil {
		return nil, fmt.Errorf("failed to get pre-merge HEAD: %w", err)
	}
	if err := validateRef("hash", preMergeHead); err != nil {
		return nil, fmt.Errorf("invalid pre-merge HEAD hash: %w", err)
	}

	// Set autocommit=1 for DOLT_MERGE (required for non-transactional merge)
	if _, err := conn.ExecContext(ctx, "SET autocommit=1"); err != nil {
		return nil, fmt.Errorf("failed to set autocommit: %w", err)
	}
	defer conn.ExecContext(context.Background(), "SET autocommit=0")

	// Execute merge
	var mergeHash string
	var fastForward, mergeConflicts int
	var mergeMessage string
	err = conn.QueryRowContext(ctx, "CALL DOLT_MERGE('audit', '-m', 'audit→main データ同期')").
		Scan(&mergeHash, &fastForward, &mergeConflicts, &mergeMessage)
	if err != nil {
		// Dolt merge conflict with autocommit=1 returns MySQL error 1105
		if strings.Contains(err.Error(), "onflict") {
			return nil, &model.APIError{
				Status: 409,
				Code:   model.CodeMergeConflictsPresent,
				Msg:    "audit→mainマージでコンフリクトが検出されました。CLIで解決してください。",
			}
		}
		if strings.Contains(err.Error(), "branch not found") {
			return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "auditブランチが見つかりません"}
		}
		return nil, fmt.Errorf("failed to merge audit into main: %w", err)
	}
	if mergeConflicts > 0 {
		return nil, &model.APIError{
			Status: 409,
			Code:   model.CodeMergeConflictsPresent,
			Msg:    "audit→mainマージでコンフリクトが検出されました。CLIで解決してください。",
		}
	}

	// Restore memo tables from pre-merge state
	if len(memoTables) > 0 {
		restored := false
		for _, mt := range memoTables {
			// DELETE current memo data and restore from pre-merge HEAD
			deleteSQL := fmt.Sprintf("DELETE FROM `%s`", mt)
			if _, err := conn.ExecContext(ctx, deleteSQL); err != nil {
				log.Printf("[WARN] audit-merge: failed to delete memo table %s, skipping restore: %v", mt, err)
				continue
			}

			insertSQL := fmt.Sprintf("INSERT INTO `%s` SELECT * FROM `%s` AS OF '%s'", mt, mt, preMergeHead)
			if _, err := conn.ExecContext(ctx, insertSQL); err != nil {
				// If the memo table didn't exist at that commit, skip (no data to restore)
				if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "doesn't exist") {
					continue
				}
				log.Printf("[WARN] audit-merge: failed to restore memo table %s from %s: %v", mt, preMergeHead, err)
				continue
			}
			restored = true
		}

		if restored {
			if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '--all', '-m', 'Restore memo tables after audit merge')"); err != nil {
				return nil, fmt.Errorf("failed to commit memo restoration: %w", err)
			}
		}
	}

	// Get final HEAD
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.AuditMergeResponse{Hash: newHead}, nil
}

// listMemoTables returns all _memo_* table names in the current database.
func listMemoTables(ctx context.Context, conn *sql.Conn) ([]string, error) {
	rows, err := conn.QueryContext(ctx, "SHOW TABLES")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		if strings.HasPrefix(name, "_memo_") {
			tables = append(tables, name)
		}
	}
	return tables, nil
}
