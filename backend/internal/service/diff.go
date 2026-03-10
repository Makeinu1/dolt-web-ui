package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// safeRefRe validates Dolt refs (commit hashes, branch names, tags).
var safeRefRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-\^~]+$`)

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

	// Run per-table DOLT_DIFF queries in parallel (max 5 concurrent) to eliminate N+1 latency.
	type diffResult struct {
		entry model.DiffSummaryEntry
		valid bool
	}
	results := make([]diffResult, len(tables))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 5) // limit to 5 concurrent connections

	for i, t := range tables {
		if err := validation.ValidateIdentifier("table", t.Name); err != nil {
			continue
		}
		wg.Add(1)
		go func(idx int, tableName string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
			if err != nil {
				return
			}
			defer conn.Close()

			query := fmt.Sprintf(
				"SELECT diff_type, COUNT(*) FROM DOLT_DIFF('%s', '%s') GROUP BY diff_type",
				refSpec, tableName,
			)
			rows, err := conn.QueryContext(ctx, query)
			if err != nil {
				// Table may not have diff support (e.g. new table); skip silently.
				return
			}
			defer rows.Close()

			entry := model.DiffSummaryEntry{Table: tableName}
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
			results[idx] = diffResult{entry: entry, valid: true}
		}(i, t.Name)
	}
	wg.Wait()

	result := make([]model.DiffSummaryEntry, 0)
	for _, r := range results {
		if !r.valid {
			continue
		}
		if r.entry.Added+r.entry.Modified+r.entry.Removed > 0 {
			result = append(result, r.entry)
		}
	}
	return result, nil
}

// ExportDiffZip generates a ZIP archive containing per-table, per-diff-type CSV files.
// Files are named {table}_insert.csv / {table}_update.csv / {table}_delete.csv.
// Update rows contain new values only (no old_ columns).
func (s *Service) ExportDiffZip(ctx context.Context, targetID, dbName, branchName, fromRef, toRef, mode string) ([]byte, string, string, error) {
	if err := validateRef("from", fromRef); err != nil {
		return nil, "", "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, "", "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}

	// Get diff summary to know which tables have changes
	entries, err := s.DiffSummary(ctx, targetID, dbName, branchName, fromRef, toRef, mode)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to get diff summary: %w", err)
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	truncatedTables := make([]string, 0)
	truncatedTableSet := make(map[string]bool)

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
				if !truncatedTableSet[entry.Table] {
					truncatedTableSet[entry.Table] = true
					truncatedTables = append(truncatedTables, entry.Table)
				}
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
		return nil, "", "", fmt.Errorf("failed to close zip: %w", err)
	}

	zipName := fmt.Sprintf("diff-%s-%s.zip", fromRef, toRef)
	warning := ""
	if len(truncatedTables) > 0 {
		warning = fmt.Sprintf("一部のCSVは1テーブルあたり10000行で打ち切られています: %s", strings.Join(truncatedTables, ", "))
	}
	return buf.Bytes(), zipName, warning, nil
}
