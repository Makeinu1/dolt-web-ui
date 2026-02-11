package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// safeRefRe validates Dolt refs (commit hashes, branch names, tags).
var safeRefRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-]+$`)

func validateRef(name, value string) error {
	if !safeRefRe.MatchString(value) {
		return fmt.Errorf("%s contains invalid characters: %q", name, value)
	}
	return nil
}

// DiffTable returns the diff between two refs for a table.
// Per v6f spec section 5.1: DOLT_DIFF() requires literal arguments (no bind).
// Tokens are validated via allowlist + regex before SQL template embedding.
func (s *Service) DiffTable(ctx context.Context, targetID, dbName, branchName, table, fromRef, toRef, mode string, skinny bool) ([]model.DiffRow, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if err := validateRef("from", fromRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Build ref spec based on mode
	var refSpec string
	switch mode {
	case "three_dot":
		refSpec = fmt.Sprintf("%s...%s", fromRef, toRef)
	default: // "two_dot" or default
		refSpec = fmt.Sprintf("%s..%s", fromRef, toRef)
	}

	// Per v6f spec 1.4: DOLT_DIFF literal constraint - embed validated tokens
	skinnyArg := ""
	if skinny {
		skinnyArg = ", '--skinny'"
	}
	query := fmt.Sprintf("SELECT * FROM DOLT_DIFF('%s', '%s'%s)", refSpec, table, skinnyArg)

	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query diff: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	var result []model.DiffRow
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan diff row: %w", err)
		}

		row := make(map[string]interface{})
		for i, col := range colNames {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}

		diffType := "modified"
		if dt, ok := row["diff_type"]; ok {
			if s, ok := dt.(string); ok {
				diffType = s
			}
		}

		result = append(result, model.DiffRow{
			DiffType: diffType,
			From:     row,
			To:       row,
		})
	}

	return result, rows.Err()
}

// HistoryCommits returns the commit log for a branch.
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int) ([]model.HistoryCommit, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	offset := (page - 1) * pageSize
	rows, err := conn.QueryContext(ctx,
		"SELECT commit_hash, committer, message, date FROM dolt_log ORDER BY date DESC LIMIT ? OFFSET ?",
		pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query history: %w", err)
	}
	defer rows.Close()

	var commits []model.HistoryCommit
	for rows.Next() {
		var c model.HistoryCommit
		if err := rows.Scan(&c.Hash, &c.Author, &c.Message, &c.Timestamp); err != nil {
			return nil, fmt.Errorf("failed to scan commit: %w", err)
		}
		commits = append(commits, c)
	}
	return commits, rows.Err()
}

// HistoryRow returns the change history for a specific row.
func (s *Service) HistoryRow(ctx context.Context, targetID, dbName, branchName, table, pkJSON string, limit int) ([]map[string]interface{}, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Get PK column from schema
	schema, err := s.GetTableSchema(ctx, targetID, dbName, branchName, table)
	if err != nil {
		return nil, err
	}
	var pkCol string
	for _, col := range schema.Columns {
		if col.PrimaryKey {
			pkCol = col.Name
			break
		}
	}
	if pkCol == "" {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "table has no primary key"}
	}

	// Parse PK value
	pkVal, err := parseSinglePK(pkJSON)
	if err != nil {
		return nil, err
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	query := fmt.Sprintf("SELECT * FROM dolt_history_%s WHERE `%s` = ? ORDER BY commit_date DESC LIMIT ?", table, pkCol)
	rows, err := conn.QueryContext(ctx, query, pkVal, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query row history: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	var result []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		row := make(map[string]interface{})
		for i, col := range colNames {
			if b, ok := values[i].([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = values[i]
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// parseSinglePK parses a URL-encoded JSON PK and returns the single value.
func parseSinglePK(pkJSON string) (interface{}, error) {
	var pkMap map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &pkMap); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk JSON"}
	}
	if len(pkMap) != 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "single primary key required"}
	}
	for _, v := range pkMap {
		return v, nil
	}
	return nil, nil
}
