package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

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
// Supports pagination (page/pageSize) and optional diffType filter.
// Per v6f spec section 5.1: DOLT_DIFF() requires literal arguments (no bind).
// Tokens are validated via allowlist + regex before SQL template embedding.
func (s *Service) DiffTable(ctx context.Context, targetID, dbName, branchName, table, fromRef, toRef, mode string, skinny bool, diffType string, page, pageSize int) (*model.DiffTableResponse, error) {
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
	diffBase := fmt.Sprintf("DOLT_DIFF('%s', '%s'%s)", refSpec, table, skinnyArg)

	// Build WHERE clause for diff_type filter
	whereClause := ""
	if diffType == "added" || diffType == "modified" || diffType == "removed" {
		whereClause = fmt.Sprintf(" WHERE diff_type = '%s'", diffType)
	}

	// Count query
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", diffBase, whereClause)
	var totalCount int
	if err := conn.QueryRowContext(ctx, countQuery).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to count diff rows: %w", err)
	}

	// Data query with LIMIT/OFFSET
	offset := (page - 1) * pageSize
	dataQuery := fmt.Sprintf("SELECT * FROM %s%s LIMIT %d OFFSET %d", diffBase, whereClause, pageSize, offset)

	rows, err := conn.QueryContext(ctx, dataQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to query diff: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	result := make([]model.DiffRow, 0)
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan diff row: %w", err)
		}

		// Separate from_<col> and to_<col> columns
		fromRow := make(map[string]interface{})
		toRow := make(map[string]interface{})
		var dt string

		for i, col := range colNames {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			switch {
			case col == "diff_type":
				if sv, ok := val.(string); ok {
					dt = sv
				}
			case strings.HasPrefix(col, "from_"):
				fromRow[strings.TrimPrefix(col, "from_")] = val
			case strings.HasPrefix(col, "to_"):
				toRow[strings.TrimPrefix(col, "to_")] = val
			}
		}

		if dt == "" {
			dt = "modified"
		}

		result = append(result, model.DiffRow{
			DiffType: dt,
			From:     fromRow,
			To:       toRow,
		})
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &model.DiffTableResponse{
		Rows:       result,
		TotalCount: totalCount,
		Page:       page,
		PageSize:   pageSize,
	}, nil
}

// DiffSummary returns per-table added/modified/removed counts for all tables
// in the branch, using three-dot diff vs fromRef (default "main").
func (s *Service) DiffSummary(ctx context.Context, targetID, dbName, branchName, fromRef, toRef, mode string) ([]model.DiffSummaryEntry, error) {
	if err := validateRef("from", fromRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	// Get the list of tables to diff
	tables, err := s.ListTables(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}

	var refSpec string
	if mode == "three_dot" {
		refSpec = fmt.Sprintf("%s...%s", fromRef, toRef)
	} else {
		refSpec = fmt.Sprintf("%s..%s", fromRef, toRef)
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	result := make([]model.DiffSummaryEntry, 0)
	for _, t := range tables {
		if err := validation.ValidateIdentifier("table", t.Name); err != nil {
			continue
		}

		query := fmt.Sprintf(
			"SELECT diff_type, COUNT(*) FROM DOLT_DIFF('%s', '%s') GROUP BY diff_type",
			refSpec, t.Name,
		)
		// NOTE: Must close rows before next query on the same connection.
		rows, err := conn.QueryContext(ctx, query)
		if err != nil {
			// Table may not have diff support (e.g. new table); skip silently.
			continue
		}

		entry := model.DiffSummaryEntry{Table: t.Name}
		for rows.Next() {
			var diffType string
			var count int
			if err := rows.Scan(&diffType, &count); err != nil {
				break
			}
			switch diffType {
			case "added":
				entry.Added = count
			case "modified":
				entry.Modified = count
			case "removed":
				entry.Removed = count
			}
		}
		rows.Close() // Close BEFORE next iteration's QueryContext

		if entry.Added+entry.Modified+entry.Removed > 0 {
			result = append(result, entry)
		}
	}
	return result, nil
}

// HistoryCommits returns the commit log for a branch.
// filter: "all" (default), "merges_only" (main: merge commits only),
// "exclude_auto_merge" (work branch: exclude auto-sync merges).
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int, filter string) ([]model.HistoryCommit, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	offset := (page - 1) * pageSize

	var query string
	switch filter {
	case "merges_only":
		// For main branch: show only merge commits (2+ parents)
		query = `SELECT l.commit_hash, l.committer, l.message, l.date
			FROM dolt_log AS l
			INNER JOIN (
				SELECT commit_hash FROM dolt_commit_ancestors
				GROUP BY commit_hash HAVING COUNT(*) > 1
			) AS m ON l.commit_hash = m.commit_hash
			ORDER BY l.date DESC LIMIT ? OFFSET ?`
	case "exclude_auto_merge":
		// For work branches: exclude auto-generated merge commits
		query = `SELECT commit_hash, committer, message, date
			FROM dolt_log
			WHERE message NOT LIKE 'Merge branch%'
			  AND message != 'Merge main with conflict resolution'
			ORDER BY date DESC LIMIT ? OFFSET ?`
	default:
		query = "SELECT commit_hash, committer, message, date FROM dolt_log ORDER BY date DESC LIMIT ? OFFSET ?"
	}

	rows, err := conn.QueryContext(ctx, query, pageSize, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query history: %w", err)
	}
	defer rows.Close()

	commits := make([]model.HistoryCommit, 0)
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

	result := make([]map[string]interface{}, 0)
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
