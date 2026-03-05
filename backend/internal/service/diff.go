package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
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

// workBranchExtractRe extracts a work branch name (wi/xxx/xx) from a commit message.
var workBranchExtractRe = regexp.MustCompile(`wi/[A-Za-z0-9._-]+/[0-9]{1,3}`)

// HistoryCommits returns the commit log for a branch.
// filter: "all" (default), "merges_only" (main: merge commits only),
// "exclude_auto_merge" (work branch: exclude auto-sync merges).
// keyword: substring match on message (empty = no filter).
// fromDate/toDate: ISO date "YYYY-MM-DD" inclusive range (empty = no filter).
func (s *Service) HistoryCommits(ctx context.Context, targetID, dbName, branchName string, page, pageSize int, filter, keyword, fromDate, toDate string) ([]model.HistoryCommit, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	offset := (page - 1) * pageSize

	// Build base FROM clause based on filter
	var baseFrom string
	var args []interface{}

	switch filter {
	case "merges_only":
		// Show merge commits on main: 2+ parents in dolt_commit_ancestors (standard Dolt merge)
		// OR message contains wi/xxx/xx branch pattern (our custom Approve merge commit).
		// LEFT JOIN ensures commits with our custom messages are not filtered out when
		// dolt_commit_ancestors doesn't yet reflect the merge topology.
		baseFrom = `dolt_log AS l
			LEFT JOIN (
				SELECT commit_hash FROM dolt_commit_ancestors
				GROUP BY commit_hash HAVING COUNT(*) > 1
			) AS m ON l.commit_hash = m.commit_hash`

	case "exclude_auto_merge":
		// For work branches: exclude auto-generated merge commits
		baseFrom = `dolt_log AS l`
	case "exclude_comments":
		baseFrom = `dolt_log AS l`
	case "exclude_auto_merge_and_comments":
		baseFrom = `dolt_log AS l`
	default:
		baseFrom = `dolt_log AS l`
	}

	// Build WHERE conditions
	var conditions []string

	switch filter {
	case "merges_only":
		// Keep only commits that are either standard merge commits (2+ parents via LEFT JOIN)
		// OR contain our wi/xxx/xx branch name pattern (custom Approve merge message).
		conditions = append(conditions, "(m.commit_hash IS NOT NULL OR l.message REGEXP 'wi/[A-Za-z0-9._-]+/[0-9]+')")
	case "exclude_auto_merge":
		conditions = append(conditions, "l.message NOT LIKE 'Merge branch%'", "l.message != 'Merge main with conflict resolution'")
	case "exclude_comments":
		conditions = append(conditions, "l.message NOT LIKE '[comment]%'")
	case "exclude_auto_merge_and_comments":
		conditions = append(conditions, "l.message NOT LIKE 'Merge branch%'", "l.message != 'Merge main with conflict resolution'", "l.message NOT LIKE '[comment]%'")
	}

	// Optional keyword filter
	if keyword != "" {
		// NEW-10: escape LIKE special characters (% and _) to prevent unintended wildcard matching.
		escapedKw := strings.ReplaceAll(strings.ReplaceAll(keyword, "\\", "\\\\"), "%", "\\%")
		escapedKw = strings.ReplaceAll(escapedKw, "_", "\\_")
		conditions = append(conditions, "l.message LIKE ? ESCAPE '\\'")
		args = append(args, "%"+escapedKw+"%")
	}

	// Optional date range filters
	if fromDate != "" {
		conditions = append(conditions, "l.date >= ?")
		args = append(args, fromDate)
	}
	if toDate != "" {
		conditions = append(conditions, "l.date <= ?")
		args = append(args, toDate+" 23:59:59")
	}

	// Assemble query
	query := fmt.Sprintf("SELECT l.commit_hash, l.committer, l.message, l.date FROM %s", baseFrom)
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY l.date DESC LIMIT ? OFFSET ?"
	args = append(args, pageSize, offset)

	rows, err := conn.QueryContext(ctx, query, args...)
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
		// 2a: Extract work branch name from merge commit message
		if filter == "merges_only" {
			if m := workBranchExtractRe.FindString(c.Message); m != "" {
				c.MergeBranch = m
			}
		}
		commits = append(commits, c)
	}
	return commits, rows.Err()
}

// ExportDiffZip generates a ZIP archive containing per-table, per-diff-type CSV files.
// Files are named {table}_insert.csv / {table}_update.csv / {table}_delete.csv.
// Update rows contain new values only (no old_ columns).
func (s *Service) ExportDiffZip(ctx context.Context, targetID, dbName, branchName, fromRef, toRef, mode string) ([]byte, string, error) {
	if err := validateRef("from", fromRef); err != nil {
		return nil, "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	// Get diff summary to know which tables have changes
	entries, err := s.DiffSummary(ctx, targetID, dbName, branchName, fromRef, toRef, mode)
	if err != nil {
		return nil, "", fmt.Errorf("failed to get diff summary: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	for _, entry := range entries {
		diffTypes := []struct {
			diffType string
			suffix   string
		}{
			{"added", "insert"},
			{"modified", "update"},
			{"removed", "delete"},
		}

		for _, dt := range diffTypes {
			count := 0
			switch dt.diffType {
			case "added":
				count = entry.Added
			case "modified":
				count = entry.Modified
			case "removed":
				count = entry.Removed
			}
			if count == 0 {
				continue
			}

			// BUG-K: cap rows to prevent OOM on large tables.
			rowLimit := count + 100
			if rowLimit > 10000 {
				rowLimit = 10000
			}
			// Fetch all rows for this table/diffType (no pagination)
			resp, err := s.DiffTable(ctx, targetID, dbName, branchName, entry.Table, fromRef, toRef, mode, false, dt.diffType, 1, rowLimit)
			if err != nil || len(resp.Rows) == 0 {
				continue
			}

			// Collect column names from first row's To map (or From for removed)
			var sample map[string]interface{}
			if dt.diffType == "removed" {
				sample = resp.Rows[0].From
			} else {
				sample = resp.Rows[0].To
			}
			cols := make([]string, 0, len(sample))
			for k := range sample {
				cols = append(cols, k)
			}
			// Sort for deterministic order
			for i := 0; i < len(cols)-1; i++ {
				for j := i + 1; j < len(cols); j++ {
					if cols[i] > cols[j] {
						cols[i], cols[j] = cols[j], cols[i]
					}
				}
			}

			fname := fmt.Sprintf("%s_%s.csv", entry.Table, dt.suffix)
			fw, err := zw.Create(fname)
			if err != nil {
				continue
			}
			cw := csv.NewWriter(fw)

			// Write header
			if err := cw.Write(cols); err != nil {
				continue
			}

			// Write data rows
			for _, row := range resp.Rows {
				var src map[string]interface{}
				if dt.diffType == "removed" {
					src = row.From
				} else {
					src = row.To
				}
				record := make([]string, len(cols))
				for i, col := range cols {
					v := src[col]
					if v == nil {
						record[i] = ""
					} else {
						record[i] = fmt.Sprintf("%v", v)
					}
				}
				if err := cw.Write(record); err != nil {
					break
				}
			}
			cw.Flush()
		}
	}

	if err := zw.Close(); err != nil {
		return nil, "", fmt.Errorf("failed to close zip: %w", err)
	}

	zipName := fmt.Sprintf("diff-%s-%s.zip", fromRef, toRef)
	return buf.Bytes(), zipName, nil
}

// parsePK parses a URL-encoded JSON PK map and returns it as-is.
// Supports both single and composite primary keys.
func parsePK(pkJSON string) (map[string]interface{}, error) {
	var pkMap map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &pkMap); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk JSON"}
	}
	if len(pkMap) < 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "pk must not be empty"}
	}
	return pkMap, nil
}

// HistoryRow returns all historical snapshots of a specific row from dolt_history_{table}.
// Snapshots are returned newest-first, up to limit entries.
func (s *Service) HistoryRow(ctx context.Context, targetID, dbName, branchName, table, pkJSON string, limit int) (*model.HistoryRowResponse, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	pkMap, err := parsePK(pkJSON)
	if err != nil {
		return nil, err
	}

	// Build WHERE clause from PK columns
	whereParts := make([]string, 0, len(pkMap))
	whereArgs := make([]interface{}, 0, len(pkMap))
	for k, v := range pkMap {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
		}
		// Convert JSON number (float64) to integer string for query
		if fv, ok := v.(float64); ok && fv == float64(int64(fv)) {
			v = strconv.FormatInt(int64(fv), 10)
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	histTable := fmt.Sprintf("dolt_history_%s", table)
	query := fmt.Sprintf(
		"SELECT * FROM `%s` WHERE %s ORDER BY commit_date DESC LIMIT ?",
		histTable, strings.Join(whereParts, " AND "),
	)
	whereArgs = append(whereArgs, limit)

	rows, err := conn.QueryContext(ctx, query, whereArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query row history: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	snapshots := make([]model.HistoryRowSnapshot, 0)
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, fmt.Errorf("failed to scan history row: %w", err)
		}

		snap := model.HistoryRowSnapshot{Row: make(map[string]interface{})}
		for i, col := range colNames {
			val := values[i]
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			switch col {
			case "commit_hash":
				if sv, ok := val.(string); ok {
					snap.CommitHash = sv
				}
			case "commit_date":
				if sv, ok := val.(string); ok {
					snap.CommitDate = sv
				} else {
					snap.CommitDate = fmt.Sprintf("%v", val)
				}
			case "committer":
				if sv, ok := val.(string); ok {
					snap.Committer = sv
				}
			default:
				snap.Row[col] = val
			}
		}
		snapshots = append(snapshots, snap)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("history row query error: %w", err)
	}

	return &model.HistoryRowResponse{Snapshots: snapshots}, nil
}
