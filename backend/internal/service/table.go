package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
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
		// Exclude dolt_ system tables and _cell_ internal tables
		if strings.HasPrefix(name, "dolt_") || strings.HasPrefix(name, "_cell_") {
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

// GetTableRows streams paginated rows directly to the writer as JSON to avoid OOM.
// Per v6f spec section 9: column names are validated against schema allowlist.
func (s *Service) GetTableRows(ctx context.Context, targetID, dbName, branchName, table string, page, pageSize int, filterJSON, sortStr string, w io.Writer) error {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Get schema for column allowlist
	schema, err := s.GetTableSchema(ctx, targetID, dbName, branchName, table)
	if err != nil {
		return fmt.Errorf("failed to get schema: %w", err)
	}

	allowedCols := make(map[string]bool)
	pkColSet := make(map[string]bool) // for hasPK detection
	var pkCols []string
	for _, col := range schema.Columns {
		allowedCols[col.Name] = true
		if col.PrimaryKey {
			pkCols = append(pkCols, col.Name)
			pkColSet[col.Name] = true
		}
	}

	if len(pkCols) == 0 {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "table has no primary key (not supported)"}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Build WHERE clause from filter
	var whereParts []string
	var whereArgs []interface{}
	if filterJSON != "" {
		var filters []model.FilterCondition
		if err := json.Unmarshal([]byte(filterJSON), &filters); err != nil {
			return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid filter JSON"}
		}
		for _, f := range filters {
			if !allowedCols[f.Column] {
				return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in filter: %s", f.Column)}
			}
			switch f.Op {
			case "eq":
				whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "neq":
				whereParts = append(whereParts, fmt.Sprintf("`%s` != ?", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "contains":
				whereParts = append(whereParts, fmt.Sprintf("`%s` LIKE CONCAT('%%', ?, '%%')", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "startsWith":
				whereParts = append(whereParts, fmt.Sprintf("`%s` LIKE CONCAT(?, '%%')", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "endsWith":
				whereParts = append(whereParts, fmt.Sprintf("`%s` LIKE CONCAT('%%', ?)", f.Column))
				whereArgs = append(whereArgs, f.Value)
			case "blank":
				whereParts = append(whereParts, fmt.Sprintf("`%s` IS NULL", f.Column))
			case "notBlank":
				whereParts = append(whereParts, fmt.Sprintf("`%s` IS NOT NULL", f.Column))
			case "in":
				vals, ok := f.Value.([]interface{})
				if !ok {
					return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "in filter value must be an array"}
				}
				placeholders := make([]string, len(vals))
				for i, v := range vals {
					placeholders[i] = "?"
					whereArgs = append(whereArgs, v)
				}
				whereParts = append(whereParts, fmt.Sprintf("`%s` IN (%s)", f.Column, strings.Join(placeholders, ",")))
			default:
				return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown filter operator: %s", f.Op)}
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
				return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in sort: %s", col)}
			}
			orderParts = append(orderParts, fmt.Sprintf("`%s` %s", col, dir))
			if pkColSet[col] {
				hasPK = true
			}
		}
		// Per v6f spec: append all PK cols ASC for stable paging if not covered
		if !hasPK {
			for _, pk := range pkCols {
				orderParts = append(orderParts, fmt.Sprintf("`%s` ASC", pk))
			}
		}
		orderByClause = "ORDER BY " + strings.Join(orderParts, ", ")
	} else {
		// Default: order by all PK cols
		pkOrderParts := make([]string, len(pkCols))
		for i, pk := range pkCols {
			pkOrderParts[i] = fmt.Sprintf("`%s` ASC", pk)
		}
		orderByClause = "ORDER BY " + strings.Join(pkOrderParts, ", ")
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` %s", table, whereClause)
	var totalCount int
	if err := conn.QueryRowContext(ctx, countQuery, whereArgs...).Scan(&totalCount); err != nil {
		return fmt.Errorf("failed to count rows: %w", err)
	}

	// Fetch rows
	offset := (page - 1) * pageSize
	dataQuery := fmt.Sprintf("SELECT * FROM `%s` %s %s LIMIT ? OFFSET ?", table, whereClause, orderByClause)
	// A-2: safe copy to avoid append() mutating the whereArgs backing array
	dataArgs := make([]interface{}, 0, len(whereArgs)+2)
	dataArgs = append(dataArgs, whereArgs...)
	dataArgs = append(dataArgs, pageSize, offset)

	rows, err := conn.QueryContext(ctx, dataQuery, dataArgs...)
	if err != nil {
		return fmt.Errorf("failed to query rows: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return fmt.Errorf("failed to get columns: %w", err)
	}

	// A-1: Write the JSON response header fields manually.
	// We use json.Marshal (not json.Encoder.Encode) because Encoder.Encode appends '\n'
	// after each object, producing invalid JSON when embedded inside the outer object.
	w.Write([]byte(`{`))
	w.Write([]byte(fmt.Sprintf(`"page":%d,`, page)))
	w.Write([]byte(fmt.Sprintf(`"page_size":%d,`, pageSize)))
	w.Write([]byte(fmt.Sprintf(`"total_count":%d,`, totalCount)))
	w.Write([]byte(`"rows":[`))

	first := true
	for rows.Next() {
		values := make([]interface{}, len(colNames))
		valuePtrs := make([]interface{}, len(colNames))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			return fmt.Errorf("failed to scan row: %w", err)
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

		rowBytes, err := json.Marshal(row)
		if err != nil {
			return fmt.Errorf("failed to marshal row: %w", err)
		}
		if !first {
			w.Write([]byte(`,`))
		}
		first = false
		w.Write(rowBytes)
	}

	// End JSON array and object
	w.Write([]byte(`]}`))

	return rows.Err()
}

// GetTableRow returns a single row by PK.
func (s *Service) GetTableRow(ctx context.Context, targetID, dbName, branchName, table, pkJSON string) (map[string]interface{}, error) {
	if err := validation.ValidateIdentifier("table", table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Parse PK — supports single and composite keys
	var pkMap map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &pkMap); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk JSON"}
	}
	if len(pkMap) < 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "pk must not be empty"}
	}

	// Validate key names and build WHERE
	whereParts := make([]string, 0, len(pkMap))
	whereArgs := make([]interface{}, 0, len(pkMap))
	for k, v := range pkMap {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name: " + k}
		}
		// Convert float64 (JSON number) to integer string for query
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

	query := fmt.Sprintf("SELECT * FROM `%s` WHERE %s LIMIT 1", table, strings.Join(whereParts, " AND "))
	rows, err := conn.QueryContext(ctx, query, whereArgs...)
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
