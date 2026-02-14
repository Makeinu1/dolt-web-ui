package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

func (s *Service) ListTables(ctx context.Context, targetID, dbName, branchName string) ([]model.TableResponse, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
	if err != nil {
		return nil, fmt.Errorf("failed to list tables: %w", err)
	}
	defer rows.Close()

	tables := make([]model.TableResponse, 0)
	for rows.Next() {
		var name, tableType string
		if err := rows.Scan(&name, &tableType); err != nil {
			return nil, fmt.Errorf("failed to scan table: %w", err)
		}
		// Exclude dolt_ system tables
		if strings.HasPrefix(name, "dolt_") {
			continue
		}
		tables = append(tables, model.TableResponse{Name: name})
	}
	return tables, rows.Err()
}

func (s *Service) GetTableSchema(ctx context.Context, targetID, dbName, branchName, table string) (*model.SchemaResponse, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, fmt.Errorf("invalid table name: %w", err)
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	query := fmt.Sprintf("SHOW COLUMNS FROM `%s`", table)
	rows, err := conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}
	defer rows.Close()

	var columns []model.ColumnSchema
	for rows.Next() {
		var field, colType, null, key string
		var defaultVal, extra sql.NullString
		if err := rows.Scan(&field, &colType, &null, &key, &defaultVal, &extra); err != nil {
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		columns = append(columns, model.ColumnSchema{
			Name:       field,
			Type:       colType,
			Nullable:   null == "YES",
			PrimaryKey: key == "PRI",
		})
	}

	if len(columns) == 0 {
		return nil, fmt.Errorf("table %q not found", table)
	}

	return &model.SchemaResponse{Table: table, Columns: columns}, rows.Err()
}

// GetTableRows returns paginated rows with optional filter and sort.
// Per v6f spec section 9: column names are validated against schema allowlist.
func (s *Service) GetTableRows(ctx context.Context, targetID, dbName, branchName, table string, page, pageSize int, filterJSON, sortStr string) (*model.RowsResponse, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Get schema for column allowlist
	schema, err := s.GetTableSchema(ctx, targetID, dbName, branchName, table)
	if err != nil {
		return nil, fmt.Errorf("failed to get schema: %w", err)
	}

	allowedCols := make(map[string]bool)
	var pkCol string
	for _, col := range schema.Columns {
		allowedCols[col.Name] = true
		if col.PrimaryKey {
			pkCol = col.Name
		}
	}

	if pkCol == "" {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "table has no primary key (not supported)"}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Build WHERE clause from filter
	var whereParts []string
	var whereArgs []interface{}
	if filterJSON != "" {
		var filters []model.FilterCondition
		if err := json.Unmarshal([]byte(filterJSON), &filters); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid filter JSON"}
		}
		for _, f := range filters {
			if !allowedCols[f.Column] {
				return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in filter: %s", f.Column)}
			}
			switch f.Op {
			case "eq":
				whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "contains":
				whereParts = append(whereParts, fmt.Sprintf("`%s` LIKE CONCAT('%%', ?, '%%')", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "in":
				vals, ok := f.Value.([]interface{})
				if !ok {
					return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "in filter value must be an array"}
				}
				placeholders := make([]string, len(vals))
				for i, v := range vals {
					placeholders[i] = "?"
					whereArgs = append(whereArgs, v)
				}
				whereParts = append(whereParts, fmt.Sprintf("`%s` IN (%s)", f.Column, strings.Join(placeholders, ",")))
			default:
				return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown filter operator: %s", f.Op)}
			}
		}
	}

	whereClause := ""
	if len(whereParts) > 0 {
		whereClause = "WHERE " + strings.Join(whereParts, " AND ")
	}

	// Build ORDER BY clause from sort
	orderByClause := ""
	if sortStr != "" {
		var orderParts []string
		tokens := strings.Split(sortStr, ",")
		hasPK := false
		for _, token := range tokens {
			token = strings.TrimSpace(token)
			if token == "" {
				continue
			}
			dir := "ASC"
			col := token
			if strings.HasPrefix(token, "-") {
				dir = "DESC"
				col = token[1:]
			}
			if !allowedCols[col] {
				return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in sort: %s", col)}
			}
			orderParts = append(orderParts, fmt.Sprintf("`%s` %s", col, dir))
			if col == pkCol {
				hasPK = true
			}
		}
		// Per v6f spec: append PK ASC for stable paging
		if !hasPK {
			orderParts = append(orderParts, fmt.Sprintf("`%s` ASC", pkCol))
		}
		orderByClause = "ORDER BY " + strings.Join(orderParts, ", ")
	} else {
		orderByClause = fmt.Sprintf("ORDER BY `%s` ASC", pkCol)
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` %s", table, whereClause)
	var totalCount int
	if err := conn.QueryRowContext(ctx, countQuery, whereArgs...).Scan(&totalCount); err != nil {
		return nil, fmt.Errorf("failed to count rows: %w", err)
	}

	// Fetch rows
	offset := (page - 1) * pageSize
	dataQuery := fmt.Sprintf("SELECT * FROM `%s` %s %s LIMIT ? OFFSET ?", table, whereClause, orderByClause)
	dataArgs := append(whereArgs, pageSize, offset)

	rows, err := conn.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query rows: %w", err)
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
			val := values[i]
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		result = append(result, row)
	}

	return &model.RowsResponse{
		Rows:       result,
		Page:       page,
		PageSize:   pageSize,
		TotalCount: totalCount,
	}, rows.Err()
}

// GetTableRow returns a single row by PK.
func (s *Service) GetTableRow(ctx context.Context, targetID, dbName, branchName, table, pkJSON string) (map[string]interface{}, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Parse PK (single key per v6f spec)
	var pkMap map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &pkMap); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk JSON"}
	}
	if len(pkMap) != 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "single primary key required (composite PKs not supported)"}
	}

	var pkCol string
	var pkVal interface{}
	for k, v := range pkMap {
		pkCol = k
		pkVal = v
	}

	if err := validation.ValidateIdentifier("pk column", pkCol); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
	}

	// Convert numeric JSON values to string for query
	switch v := pkVal.(type) {
	case float64:
		if v == float64(int64(v)) {
			pkVal = strconv.FormatInt(int64(v), 10)
		}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	query := fmt.Sprintf("SELECT * FROM `%s` WHERE `%s` = ? LIMIT 1", table, pkCol)
	rows, err := conn.QueryContext(ctx, query, pkVal)
	if err != nil {
		return nil, fmt.Errorf("failed to query row: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	if !rows.Next() {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "row not found"}
	}

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
		val := values[i]
		if b, ok := val.([]byte); ok {
			row[col] = string(b)
		} else {
			row[col] = val
		}
	}
	return row, nil
}
