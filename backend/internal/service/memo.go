package service

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// memoTableName returns the hidden memo table name for a given user table.
func memoTableName(tableName string) string {
	return "_memo_" + tableName
}

const memoTableDDL = "CREATE TABLE IF NOT EXISTS `%s` (" +
	"pk_value    VARCHAR(1024) NOT NULL," +
	"column_name VARCHAR(255)  NOT NULL," +
	"memo_text   TEXT          NOT NULL," +
	"updated_at  DATETIME      NOT NULL," +
	"PRIMARY KEY (pk_value, column_name)" +
	")"

// ensureMemoTable creates the memo table for a user table if it does not exist.
// Must be called outside of a transaction (DDL implies implicit commit in Dolt/MySQL).
func ensureMemoTable(ctx context.Context, conn *sql.Conn, memoTable string) error {
	ddl := fmt.Sprintf(memoTableDDL, memoTable)
	if _, err := conn.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("failed to ensure memo table %s: %w", memoTable, err)
	}
	return nil
}

// GetMemoMap returns pk_value:column_name keys that have a memo for a table.
// Returns empty slice if the memo table does not exist yet.
func (s *Service) GetMemoMap(ctx context.Context, targetID, dbName, branchName, tableName string) ([]string, error) {
	conn, err := s.connAllowedRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	memoTbl := memoTableName(tableName)
	rows, err := conn.QueryContext(ctx,
		fmt.Sprintf("SELECT pk_value, column_name FROM `%s`", memoTbl),
	)
	if err != nil {
		// Table does not exist yet — return empty
		return make([]string, 0), nil
	}
	defer rows.Close()

	cells := make([]string, 0)
	for rows.Next() {
		var pk, col string
		if err := rows.Scan(&pk, &col); err != nil {
			return nil, fmt.Errorf("failed to scan memo map: %w", err)
		}
		cells = append(cells, pk+":"+col)
	}
	return cells, rows.Err()
}

// GetMemo returns the memo for a specific cell.
// Returns a MemoResponse with empty memo_text if no memo exists.
func (s *Service) GetMemo(ctx context.Context, targetID, dbName, branchName, tableName, pkValue, columnName string) (*model.MemoResponse, error) {
	conn, err := s.connAllowedRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	result := &model.MemoResponse{PkValue: pkValue, ColumnName: columnName, MemoText: ""}

	memoTbl := memoTableName(tableName)
	err = conn.QueryRowContext(ctx,
		fmt.Sprintf(
			"SELECT memo_text, DATE_FORMAT(updated_at, '%%Y-%%m-%%dT%%H:%%i:%%s') FROM `%s` WHERE pk_value = ? AND column_name = ?",
			memoTbl,
		),
		pkValue, columnName,
	).Scan(&result.MemoText, &result.UpdatedAt)
	if err != nil {
		// No memo or table does not exist — return empty
		result.MemoText = ""
		result.UpdatedAt = ""
		return result, nil
	}
	return result, nil
}
