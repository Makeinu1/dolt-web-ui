package service

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func validateRef(name, value string) error {
	if err := validation.ValidateRevisionRef(value); err != nil {
		return fmt.Errorf("%s %w", name, err)
	}
	return nil
}

func resolveDiffRefs(ctx context.Context, conn *sql.Conn, fromRef, toRef, mode string) (string, string, error) {
	if mode != "three_dot" {
		return fromRef, toRef, nil
	}

	var mergeBase sql.NullString
	query := fmt.Sprintf("SELECT DOLT_MERGE_BASE('%s', '%s')", fromRef, toRef)
	if err := conn.QueryRowContext(ctx, query).Scan(&mergeBase); err != nil {
		return "", "", fmt.Errorf("failed to resolve merge base: %w", err)
	}
	if !mergeBase.Valid || mergeBase.String == "" {
		return "", "", &model.APIError{
			Status: httpStatusPreconditionFailed(),
			Code:   model.CodePreconditionFailed,
			Msg:    fmt.Sprintf("merge base not found for %s and %s", fromRef, toRef),
		}
	}
	return mergeBase.String, toRef, nil
}

func scanBoolFlag(value interface{}) bool {
	switch v := value.(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case int32:
		return v != 0
	case int:
		return v != 0
	case []byte:
		s := strings.TrimSpace(string(v))
		return s == "1" || strings.EqualFold(s, "true")
	case string:
		s := strings.TrimSpace(v)
		return s == "1" || strings.EqualFold(s, "true")
	default:
		return false
	}
}

func httpStatusPreconditionFailed() int {
	return 412
}

// DiffTable returns the diff between two refs for a table.
// buildDiffFilterSQL converts a FilterCondition to SQL for DOLT_DIFF columns.
// User-facing column "col" maps to COALESCE(`to_col`, `from_col`) so that
// removed rows (where to_ is NULL) are also filtered by their from_ values.
func buildDiffFilterSQL(f model.FilterCondition, allowedCols map[string]bool) (string, []interface{}, *model.APIError) {
	if f.Op == "or_group" {
		if len(f.OrGroup) == 0 {
			return "1=1", nil, nil
		}
		var parts []string
		var args []interface{}
		for _, sub := range f.OrGroup {
			part, subArgs, apiErr := buildDiffFilterSQL(sub, allowedCols)
			if apiErr != nil {
				return "", nil, apiErr
			}
			parts = append(parts, part)
			args = append(args, subArgs...)
		}
		return "(" + strings.Join(parts, " OR ") + ")", args, nil
	}

	if !allowedCols[f.Column] {
		return "", nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in filter: %s", f.Column)}
	}
	colExpr := fmt.Sprintf("COALESCE(`to_%s`, `from_%s`)", f.Column, f.Column)
	switch f.Op {
	case "eq":
		return fmt.Sprintf("%s = ?", colExpr), []interface{}{f.Value}, nil
	case "neq":
		return fmt.Sprintf("%s != ?", colExpr), []interface{}{f.Value}, nil
	case "contains":
		return fmt.Sprintf("%s LIKE CONCAT('%%', ?, '%%')", colExpr), []interface{}{f.Value}, nil
	case "startsWith":
		return fmt.Sprintf("%s LIKE CONCAT(?, '%%')", colExpr), []interface{}{f.Value}, nil
	case "endsWith":
		return fmt.Sprintf("%s LIKE CONCAT('%%', ?)", colExpr), []interface{}{f.Value}, nil
	case "blank":
		return fmt.Sprintf("%s IS NULL", colExpr), nil, nil
	case "notBlank":
		return fmt.Sprintf("%s IS NOT NULL", colExpr), nil, nil
	case "in":
		vals, ok := f.Value.([]interface{})
		if !ok {
			return "", nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "in filter value must be an array"}
		}
		placeholders := make([]string, len(vals))
		args := make([]interface{}, len(vals))
		for i, v := range vals {
			placeholders[i] = "?"
			args[i] = v
		}
		return fmt.Sprintf("%s IN (%s)", colExpr, strings.Join(placeholders, ",")), args, nil
	default:
		return "", nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown filter operator: %s", f.Op)}
	}
}

// Supports pagination (page/pageSize) and optional diffType filter.
// Per v6f spec section 5.1: DOLT_DIFF() requires literal arguments (no bind).
// Tokens are validated via allowlist + regex before SQL template embedding.
func (s *Service) DiffTable(ctx context.Context, targetID, dbName, branchName, table, fromRef, toRef, mode string, skinny bool, diffType, filterJSON string, page, pageSize int) (*model.DiffTableResponse, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if err := validateRef("from", fromRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, fromRef); err != nil {
		return nil, err
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, toRef); err != nil {
		return nil, err
	}

	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
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

	// Build WHERE clause
	var whereParts []string
	var whereArgs []interface{}

	// diff_type filter (parameterized)
	if diffType == "added" || diffType == "modified" || diffType == "removed" {
		whereParts = append(whereParts, "diff_type = ?")
		whereArgs = append(whereArgs, diffType)
	}

	// Column filter (JSON-encoded conditions from frontend AG Grid)
	if filterJSON != "" {
		var filters []model.FilterCondition
		if err := json.Unmarshal([]byte(filterJSON), &filters); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid filter JSON"}
		}
		// Probe DOLT_DIFF columns to build allowed user-facing column set
		probeQuery := fmt.Sprintf("SELECT * FROM %s LIMIT 0", diffBase)
		probeRows, err := conn.QueryContext(ctx, probeQuery)
		if err != nil {
			return nil, fmt.Errorf("failed to probe diff columns: %w", err)
		}
		probeCols, _ := probeRows.Columns()
		probeRows.Close()

		userCols := make(map[string]bool)
		for _, c := range probeCols {
			if strings.HasPrefix(c, "to_") {
				userCols[strings.TrimPrefix(c, "to_")] = true
			}
		}

		for _, f := range filters {
			part, args, apiErr := buildDiffFilterSQL(f, userCols)
			if apiErr != nil {
				return nil, apiErr
			}
			whereParts = append(whereParts, part)
			whereArgs = append(whereArgs, args...)
		}
	}

	whereClause := ""
	if len(whereParts) > 0 {
		whereClause = " WHERE " + strings.Join(whereParts, " AND ")
	}

	// Count query
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", diffBase, whereClause)
	var totalCount int
	if err := conn.QueryRowContext(ctx, countQuery, whereArgs...).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to count diff rows: %w", err)
	}

	// Data query with LIMIT/OFFSET
	offset := (page - 1) * pageSize
	dataQuery := fmt.Sprintf("SELECT * FROM %s%s LIMIT %d OFFSET %d", diffBase, whereClause, pageSize, offset)

	dataArgs := make([]interface{}, 0, len(whereArgs))
	dataArgs = append(dataArgs, whereArgs...)
	rows, err := conn.QueryContext(ctx, dataQuery, dataArgs...)
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
	if err := s.ensureHistoryRef(ctx, targetID, dbName, fromRef); err != nil {
		return nil, err
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, toRef); err != nil {
		return nil, err
	}

	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	resolvedFrom, resolvedTo, err := resolveDiffRefs(ctx, conn, fromRef, toRef, mode)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf(
		"SELECT table_name, rows_added, rows_modified, rows_deleted FROM DOLT_DIFF_STAT('%s', '%s')",
		resolvedFrom, resolvedTo,
	)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		log.Printf(
			"ERROR: diff summary stat query failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
			branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
		)
		return nil, fmt.Errorf("failed to get diff summary: %w", err)
	}
	defer rows.Close()

	entries := make([]model.DiffSummaryEntry, 0)
	for rows.Next() {
		var (
			tableName string
			added     int
			modified  int
			removed   int
		)
		if err := rows.Scan(&tableName, &added, &modified, &removed); err != nil {
			log.Printf(
				"ERROR: diff summary stat scan failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
				branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
			)
			return nil, fmt.Errorf("failed to scan diff summary: %w", err)
		}
		if added+modified+removed == 0 {
			continue
		}
		entries = append(entries, model.DiffSummaryEntry{
			Table:    tableName,
			Added:    added,
			Modified: modified,
			Removed:  removed,
		})
	}
	if err := rows.Err(); err != nil {
		log.Printf(
			"ERROR: diff summary stat rows failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
			branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
		)
		return nil, fmt.Errorf("failed to read diff summary: %w", err)
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Table < entries[j].Table
	})
	return entries, nil
}

func (s *Service) DiffSummaryLight(ctx context.Context, targetID, dbName, branchName, fromRef, toRef, mode string) ([]model.DiffSummaryLightEntry, error) {
	if err := validateRef("from", fromRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := validateRef("to", toRef); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: err.Error()}
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, fromRef); err != nil {
		return nil, err
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, toRef); err != nil {
		return nil, err
	}

	conn, err := s.connHistoryRevision(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	resolvedFrom, resolvedTo, err := resolveDiffRefs(ctx, conn, fromRef, toRef, mode)
	if err != nil {
		return nil, err
	}

	query := fmt.Sprintf(
		"SELECT from_table_name, to_table_name, diff_type, data_change, schema_change FROM DOLT_DIFF_SUMMARY('%s', '%s')",
		resolvedFrom, resolvedTo,
	)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		log.Printf(
			"ERROR: diff summary light query failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
			branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
		)
		return nil, fmt.Errorf("failed to get changed tables: %w", err)
	}
	defer rows.Close()

	entriesByTable := make(map[string]model.DiffSummaryLightEntry)
	for rows.Next() {
		var (
			fromTable    sql.NullString
			toTable      sql.NullString
			diffType     string
			dataChange   interface{}
			schemaChange interface{}
		)
		if err := rows.Scan(&fromTable, &toTable, &diffType, &dataChange, &schemaChange); err != nil {
			log.Printf(
				"ERROR: diff summary light scan failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
				branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
			)
			return nil, fmt.Errorf("failed to scan changed tables: %w", err)
		}
		tableName := toTable.String
		if tableName == "" {
			tableName = fromTable.String
		}
		entry := entriesByTable[tableName]
		entry.Table = tableName
		entry.HasDataChange = entry.HasDataChange || scanBoolFlag(dataChange)
		entry.HasSchemaChange = entry.HasSchemaChange || scanBoolFlag(schemaChange)
		entriesByTable[tableName] = entry
		_ = diffType
	}
	if err := rows.Err(); err != nil {
		log.Printf(
			"ERROR: diff summary light rows failed: branch=%s from_ref=%s to_ref=%s resolved_from=%s resolved_to=%s mode=%s error=%v",
			branchName, fromRef, toRef, resolvedFrom, resolvedTo, mode, err,
		)
		return nil, fmt.Errorf("failed to read changed tables: %w", err)
	}

	entries := make([]model.DiffSummaryLightEntry, 0, len(entriesByTable))
	for _, entry := range entriesByTable {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Table < entries[j].Table
	})
	return entries, nil
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
	if err := s.ensureHistoryRef(ctx, targetID, dbName, fromRef); err != nil {
		return nil, "", "", err
	}
	if err := s.ensureHistoryRef(ctx, targetID, dbName, toRef); err != nil {
		return nil, "", "", err
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
			resp, err := s.DiffTable(ctx, targetID, dbName, branchName, entry.Table, fromRef, toRef, mode, false, dt.diffType, "", 1, rowLimit)
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
