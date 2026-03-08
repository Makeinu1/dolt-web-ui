package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// Search performs a full-table keyword search across all user tables and, optionally, memo tables.
// It returns up to `limit` matching results across all tables.
func (s *Service) Search(ctx context.Context, targetID, dbName, branchName, keyword string, includeMemo bool, limit int) (*model.SearchResponse, error) {
	if keyword == "" {
		return &model.SearchResponse{Results: make([]model.SearchResult, 0), Total: 0}, nil
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// 1. List all user tables (exclude dolt_*, _memo_*, _cell_* tables)
	rows, err := conn.QueryContext(ctx, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
	if err != nil {
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
		return nil, fmt.Errorf("failed to iterate tables: %w", err)
	}

	if len(tableNames) == 0 {
		return &model.SearchResponse{Results: make([]model.SearchResult, 0), Total: 0}, nil
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
	colRows, err := conn.QueryContext(ctx, colQuery, tblArgs...)
	if err == nil {
		for colRows.Next() {
			var tblName, colName, colKey string
			if err := colRows.Scan(&tblName, &colName, &colKey); err != nil {
				colRows.Close()
				break
			}
			tableCols[tblName] = append(tableCols[tblName], colInfo{name: colName, isPK: colKey == "PRI"})
		}
		colRows.Close()
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
		if len(results) >= limit {
			break
		}

		// Use batch-fetched columns; fall back to SHOW COLUMNS if not available.
		cols := tableCols[tableName]
		if len(cols) == 0 {
			colRows2, err := conn.QueryContext(ctx, fmt.Sprintf("SHOW COLUMNS FROM `%s`", tableName))
			if err != nil {
				continue
			}
			for colRows2.Next() {
				var field, colType, null, key string
				var defaultVal, extra interface{}
				if err := colRows2.Scan(&field, &colType, &null, &key, &defaultVal, &extra); err != nil {
					colRows2.Close()
					break
				}
				cols = append(cols, colInfo{name: field, isPK: key == "PRI"})
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

		dataRows, err := conn.QueryContext(ctx, query, args...)
		if err != nil {
			// Query failed — skip table
			continue
		}

		colNames, err := dataRows.Columns()
		if err != nil {
			dataRows.Close()
			continue
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
				continue
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
		dataRows.Close()

		// 4. Optionally search memo table
		if includeMemo && len(results) < limit {
			memoTbl := memoTableName(tableName)
			memoRows, err := conn.QueryContext(ctx,
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
					if err := memoRows.Scan(&pk, &col, &memo); err == nil {
						results = append(results, model.SearchResult{
							Table:     tableName,
							PK:        pk,
							Column:    col,
							Value:     memo,
							MatchType: "memo",
						})
					}
				}
				memoRows.Close()
			}
		}
	}

	return &model.SearchResponse{Results: results, Total: len(results)}, nil
}
