package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

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

func isMissingMemoTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "doesn't exist") || strings.Contains(msg, "not found")
}

func memoReadError(stage, table string, err error) *model.APIError {
	details := map[string]string{
		"stage": stage,
		"table": table,
	}
	if err != nil {
		details["cause"] = err.Error()
	}
	return &model.APIError{
		Status:  500,
		Code:    model.CodeInternal,
		Msg:     "メモの読み込みに失敗しました。時間をおいて再試行してください。",
		Details: details,
	}
}

// GetMemoMap returns pk_value:column_name keys that have a memo for a table.
// Returns empty slice if the memo table does not exist yet.
func (s *Service) GetMemoMap(ctx context.Context, targetID, dbName, branchName, tableName string) ([]string, error) {
	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	memoTbl := memoTableName(tableName)
	rows, err := conn.QueryContext(ctx,
		fmt.Sprintf("SELECT pk_value, column_name FROM `%s`", memoTbl),
	)
	if err != nil {
		if isMissingMemoTable(err) {
			return make([]string, 0), nil
		}
		return nil, memoReadError("memo_map_query", tableName, err)
	}
	defer rows.Close()

	cells := make([]string, 0)
	for rows.Next() {
		var pk, col string
		if err := rows.Scan(&pk, &col); err != nil {
			return nil, memoReadError("memo_map_scan", tableName, err)
		}
		cells = append(cells, pk+":"+col)
	}
	if err := rows.Err(); err != nil {
		return nil, memoReadError("memo_map_iter", tableName, err)
	}
	return cells, nil
}

// GetMemo returns the memo for a specific cell.
// Returns a MemoResponse with empty memo_text if no memo exists.
func (s *Service) GetMemo(ctx context.Context, targetID, dbName, branchName, tableName, pkValue, columnName string) (*model.MemoResponse, error) {
	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
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
		if errors.Is(err, sql.ErrNoRows) || isMissingMemoTable(err) {
			result.MemoText = ""
			result.UpdatedAt = ""
			return result, nil
		}
		// No memo or table does not exist — return empty
		result.MemoText = ""
		result.UpdatedAt = ""
		return nil, memoReadError("memo_query", tableName, err)
	}
	return result, nil
}
