package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func (s *Service) searchTimeBudget() time.Duration {
	return time.Duration(s.cfg.Server.Search.TimeoutSec) * time.Second
}

func (s *Service) searchTimeoutError() *model.APIError {
	searchTimeBudget := s.searchTimeBudget()
	return &model.APIError{
		Status:  408,
		Code:    model.CodePreconditionFailed,
		Msg:     "検索範囲が広すぎます。キーワードや対象を絞って再試行してください。",
		Details: map[string]string{"timeout": searchTimeBudget.String()},
	}
}

func isSearchTimeout(err error, ctx context.Context) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded)
}

func isMissingSearchTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "doesn't exist") || strings.Contains(msg, "not found")
}

func (s *Service) searchIntegrityError(stage, table string, err error) *model.APIError {
	details := map[string]string{
		"stage": stage,
	}
	if table != "" {
		details["table"] = table
	}
	if err != nil {
		details["cause"] = err.Error()
	}
	return &model.APIError{
		Status:  500,
		Code:    model.CodeInternal,
		Msg:     "検索結果の整合性を確認できませんでした。時間をおいて再試行してください。",
		Details: details,
	}
}

// Search performs a keyword search across selected user tables and, optionally, memo tables.
// It returns up to `limit` matching results across all tables.
func (s *Service) Search(ctx context.Context, targetID, dbName, branchName, keyword string, includeMemo bool, limit int, selectedTables []string) (*model.SearchResponse, error) {
	if keyword == "" {
		return &model.SearchResponse{
			Results: make([]model.SearchResult, 0),
			Total:   0,
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
	}

	searchCtx, cancel := context.WithTimeout(ctx, s.searchTimeBudget())
	defer cancel()

	conn, err := s.connAllowedRevision(searchCtx, targetID, dbName, branchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	// 1. List all user tables (exclude dolt_*, _memo_*, _cell_* tables)
	rows, err := conn.QueryContext(searchCtx, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
	if err != nil {
		if isSearchTimeout(err, searchCtx) {
			return nil, s.searchTimeoutError()
		}
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}
	var tableNames []string
	for rows.Next() {
		var name, tableType string
		if err := rows.Scan(&name, &tableType); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to scan table name: %w", err)
		}
		if !strings.HasPrefix(name, "dolt_") && !strings.HasPrefix(name, "_memo_") && !strings.HasPrefix(name, "_cell_") {
			tableNames = append(tableNames, name)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		if isSearchTimeout(err, searchCtx) {
			return nil, s.searchTimeoutError()
		}
		return nil, fmt.Errorf("failed to iterate tables: %w", err)
	}
	if err := searchCtx.Err(); err != nil {
		return nil, s.searchTimeoutError()
	}

	if len(tableNames) == 0 {
		return &model.SearchResponse{
			Results: make([]model.SearchResult, 0),
			Total:   0,
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
	}

	if len(selectedTables) > 0 {
		available := make(map[string]struct{}, len(tableNames))
		for _, tableName := range tableNames {
			available[tableName] = struct{}{}
		}
		filtered := make([]string, 0, len(selectedTables))
		seen := make(map[string]struct{}, len(selectedTables))
		for _, tableName := range selectedTables {
			if err := validation.ValidateIdentifier("table", tableName); err != nil {
				return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
			}
			if _, ok := available[tableName]; !ok {
				continue
			}
			if _, dup := seen[tableName]; dup {
				continue
			}
			seen[tableName] = struct{}{}
			filtered = append(filtered, tableName)
		}
		tableNames = filtered
	}
	if len(tableNames) == 0 {
		return &model.SearchResponse{
			Results: make([]model.SearchResult, 0),
			Total:   0,
			ReadResultFields: model.ReadResultFields{
				ReadIntegrity: model.ReadIntegrityComplete,
			},
		}, nil
	}

	// 2. Batch-fetch all column info for all user tables in ONE query (eliminates N+1).
	// Use DATABASE() so it scopes to the current revision DB (e.g. "Test/main").
	type colInfo struct {
		name string
		isPK bool
	}
	tableCols := make(map[string][]colInfo, len(tableNames))

	tblPlaceholders := make([]string, len(tableNames))
	tblArgs := make([]interface{}, len(tableNames))
	for i, t := range tableNames {
		tblPlaceholders[i] = "?"
		tblArgs[i] = t
	}
	colQuery := fmt.Sprintf(
		"SELECT TABLE_NAME, COLUMN_NAME, COLUMN_KEY FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (%s) ORDER BY TABLE_NAME, ORDINAL_POSITION",
		strings.Join(tblPlaceholders, ", "),
	)
	colRows, err := conn.QueryContext(searchCtx, colQuery, tblArgs...)
	if err == nil {
		for colRows.Next() {
			var tblName, colName, colKey string
			if err := colRows.Scan(&tblName, &colName, &colKey); err != nil {
				colRows.Close()
				return nil, s.searchIntegrityError("column_scan", tblName, err)
			}
			tableCols[tblName] = append(tableCols[tblName], colInfo{name: colName, isPK: colKey == "PRI"})
		}
		if err := colRows.Err(); err != nil {
			colRows.Close()
			if isSearchTimeout(err, searchCtx) {
				return nil, s.searchTimeoutError()
			}
			return nil, s.searchIntegrityError("column_iter", "", err)
		}
		colRows.Close()
	} else if isSearchTimeout(err, searchCtx) {
		return nil, s.searchTimeoutError()
	} else {
		return nil, s.searchIntegrityError("column_query", "", err)
	}
	// If INFORMATION_SCHEMA returned no columns (e.g. revision-DB TABLE_SCHEMA mismatch),
	// fall back to per-table SHOW COLUMNS for each table that has no entry yet.
	// This keeps the feature correct even if the batch query cannot scope to the right DB.

	results := make([]model.SearchResult, 0)
	// BUG-L: escape LIKE special characters to prevent wildcard injection.
	escapedKw := strings.ReplaceAll(strings.ReplaceAll(keyword, "\\", "\\\\"), "%", "\\%")
	escapedKw = strings.ReplaceAll(escapedKw, "_", "\\_")
	likePattern := "%" + escapedKw + "%"

	for _, tableName := range tableNames {
		if err := searchCtx.Err(); err != nil {
			return nil, s.searchTimeoutError()
		}
		if len(results) >= limit {
			break
		}

		// Use batch-fetched columns; fall back to SHOW COLUMNS if not available.
		cols := tableCols[tableName]
		if len(cols) == 0 {
			colRows2, err := conn.QueryContext(searchCtx, fmt.Sprintf("SHOW COLUMNS FROM `%s`", tableName))
			if err != nil {
				if isSearchTimeout(err, searchCtx) {
					return nil, s.searchTimeoutError()
				}
				return nil, s.searchIntegrityError("show_columns", tableName, err)
			}
			for colRows2.Next() {
				var field, colType, null, key string
				var defaultVal, extra interface{}
				if err := colRows2.Scan(&field, &colType, &null, &key, &defaultVal, &extra); err != nil {
					colRows2.Close()
					return nil, s.searchIntegrityError("show_columns_scan", tableName, err)
				}
				cols = append(cols, colInfo{name: field, isPK: key == "PRI"})
			}
			if err := colRows2.Err(); err != nil {
				colRows2.Close()
				if isSearchTimeout(err, searchCtx) {
					return nil, s.searchTimeoutError()
				}
				return nil, s.searchIntegrityError("show_columns_iter", tableName, err)
			}
			colRows2.Close()
		}

		if len(cols) == 0 {
			continue
		}

		// 3. Build PK JSON expression: JSON_OBJECT('col1', col1, 'col2', col2, ...)
		pkCols := make([]string, 0)
		allCols := make([]string, 0)
		whereClause := make([]string, 0)

		for _, c := range cols {
			quoted := fmt.Sprintf("`%s`", c.name)
			allCols = append(allCols, quoted)
			if c.isPK {
				pkCols = append(pkCols, fmt.Sprintf("'%s'", c.name), fmt.Sprintf("CAST(%s AS CHAR)", quoted))
			}
			whereClause = append(whereClause, fmt.Sprintf("CAST(%s AS CHAR) LIKE ?", quoted))
		}

		if len(pkCols) == 0 {
			// No PK — skip table
			continue
		}

		pkExpr := "JSON_OBJECT(" + strings.Join(pkCols, ", ") + ")"
		selectCols := strings.Join(allCols, ", ")
		whereSQL := strings.Join(whereClause, " OR ")

		query := fmt.Sprintf(
			"SELECT %s, %s FROM `%s` WHERE %s LIMIT %d",
			pkExpr, selectCols, tableName, whereSQL, limit-len(results)+1,
		)

		// Build args slice: one likePattern per column in WHERE
		args := make([]interface{}, len(cols))
		for i := range cols {
			args[i] = likePattern
		}

		dataRows, err := conn.QueryContext(searchCtx, query, args...)
		if err != nil {
			if isSearchTimeout(err, searchCtx) {
				return nil, s.searchTimeoutError()
			}
			return nil, s.searchIntegrityError("data_query", tableName, err)
		}

		colNames, err := dataRows.Columns()
		if err != nil {
			dataRows.Close()
			return nil, s.searchIntegrityError("data_columns", tableName, err)
		}

		// colNames[0] = pk_json, colNames[1..] = column values
		for dataRows.Next() {
			if len(results) >= limit {
				break
			}

			scanDest := make([]interface{}, len(colNames))
			rawVals := make([]*string, len(colNames))
			for i := range scanDest {
				scanDest[i] = &rawVals[i]
			}

			if err := dataRows.Scan(scanDest...); err != nil {
				if isSearchTimeout(err, searchCtx) {
					dataRows.Close()
					return nil, s.searchTimeoutError()
				}
				dataRows.Close()
				return nil, s.searchIntegrityError("data_scan", tableName, err)
			}

			pkJSON := ""
			if rawVals[0] != nil {
				pkJSON = *rawVals[0]
			}

			// Build compact pk string from JSON object
			var pkMap map[string]interface{}
			if json.Unmarshal([]byte(pkJSON), &pkMap) == nil && len(pkMap) == 1 {
				// single-PK: just use the value string
				for _, v := range pkMap {
					pkJSON = fmt.Sprintf("%v", v)
				}
			}

			// Check each column value for keyword match
			for j, c := range cols {
				valPtr := rawVals[j+1] // +1 because colNames[0] is pk_json
				if valPtr == nil {
					continue
				}
				val := *valPtr
				if strings.Contains(strings.ToLower(val), strings.ToLower(keyword)) {
					results = append(results, model.SearchResult{
						Table:     tableName,
						PK:        pkJSON,
						Column:    c.name,
						Value:     val,
						MatchType: "value",
					})
					if len(results) >= limit {
						break
					}
				}
			}
		}
		if err := dataRows.Err(); err != nil {
			dataRows.Close()
			if isSearchTimeout(err, searchCtx) {
				return nil, s.searchTimeoutError()
			}
			return nil, s.searchIntegrityError("data_iter", tableName, err)
		}
		dataRows.Close()

		// 4. Optionally search memo table
		if includeMemo && len(results) < limit {
			memoTbl := memoTableName(tableName)
			memoRows, err := conn.QueryContext(searchCtx,
				fmt.Sprintf(
					"SELECT pk_value, column_name, memo_text FROM `%s` WHERE memo_text LIKE ? LIMIT %d",
					memoTbl, limit-len(results),
				),
				likePattern,
			)
			if err == nil {
				for memoRows.Next() {
					if len(results) >= limit {
						break
					}
					var pk, col, memo string
					if err := memoRows.Scan(&pk, &col, &memo); err != nil {
						memoRows.Close()
						return nil, s.searchIntegrityError("memo_scan", tableName, err)
					}
					results = append(results, model.SearchResult{
						Table:     tableName,
						PK:        pk,
						Column:    col,
						Value:     memo,
						MatchType: "memo",
					})
				}
				if err := memoRows.Err(); err != nil {
					memoRows.Close()
					if isSearchTimeout(err, searchCtx) {
						return nil, s.searchTimeoutError()
					}
					return nil, s.searchIntegrityError("memo_iter", tableName, err)
				}
				memoRows.Close()
			} else if isSearchTimeout(err, searchCtx) {
				return nil, s.searchTimeoutError()
			} else if !isMissingSearchTable(err) {
				return nil, s.searchIntegrityError("memo_query", tableName, err)
			}
		}
	}
	if err := searchCtx.Err(); err != nil {
		return nil, s.searchTimeoutError()
	}

	return &model.SearchResponse{
		Results: results,
		Total:   len(results),
		ReadResultFields: model.ReadResultFields{
			ReadIntegrity: model.ReadIntegrityComplete,
		},
	}, nil
}
