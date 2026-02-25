package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// PreviewClone generates insert ops by cloning a template row with new PKs.
// Supports composite PKs: specify vary_column to indicate which PK column varies;
// new_values (or legacy new_pks) provide the new values for that column.
func (s *Service) PreviewClone(ctx context.Context, req model.PreviewCloneRequest) (*model.PreviewResponse, error) {
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if len(req.TemplatePK) < 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "template_pk must not be empty"}
	}

	// Resolve new values: prefer new_values, fall back to new_pks (legacy)
	newValues := req.NewValues
	if len(newValues) == 0 {
		newValues = req.NewPKs
	}
	if len(newValues) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "at least one value in new_values is required"}
	}

	// Resolve vary_column: explicit, or auto-detect for single-PK
	varyCol := req.VaryColumn
	if varyCol == "" {
		if len(req.TemplatePK) == 1 {
			for k := range req.TemplatePK {
				varyCol = k
			}
		} else {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument,
				Msg: "vary_column is required for composite PK tables"}
		}
	}
	if err := validation.ValidateIdentifier("vary_column", varyCol); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid vary_column name"}
	}
	if _, ok := req.TemplatePK[varyCol]; !ok {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument,
			Msg: fmt.Sprintf("vary_column '%s' not found in template_pk", varyCol)}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Build WHERE clause from all template PK columns
	whereParts := make([]string, 0, len(req.TemplatePK))
	whereArgs := make([]interface{}, 0, len(req.TemplatePK))
	for k, v := range req.TemplatePK {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name: " + k}
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	// Fetch template row
	query := fmt.Sprintf("SELECT * FROM `%s` WHERE %s LIMIT 1", req.Table, strings.Join(whereParts, " AND "))
	rows, err := conn.QueryContext(ctx, query, whereArgs...)
	if err != nil {
		return nil, fmt.Errorf("failed to query template: %w", err)
	}

	colNames, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	if !rows.Next() {
		rows.Close()
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "template row not found"}
	}

	values := make([]interface{}, len(colNames))
	valuePtrs := make([]interface{}, len(colNames))
	for i := range values {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		rows.Close()
		return nil, fmt.Errorf("failed to scan template: %w", err)
	}
	rows.Close()

	templateRow := make(map[string]interface{})
	for i, col := range colNames {
		if b, ok := values[i].([]byte); ok {
			templateRow[col] = string(b)
		} else {
			templateRow[col] = values[i]
		}
	}

	// Validate change_column if specified
	if req.ChangeColumn != "" {
		if err := validation.ValidateIdentifier("change_column", req.ChangeColumn); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid change_column name"}
		}
		if _, exists := templateRow[req.ChangeColumn]; !exists {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument,
				Msg: fmt.Sprintf("change_column '%s' not found in table", req.ChangeColumn)}
		}
	}

	// Generate ops: one insert per new value, varying the vary_column PK
	ops := make([]model.CommitOp, 0, len(newValues))
	for _, newVal := range newValues {
		rowValues := make(map[string]interface{})
		for k, v := range templateRow {
			rowValues[k] = v
		}
		// Override the vary column with the new value
		rowValues[varyCol] = newVal

		// Apply change_column override
		if req.ChangeColumn != "" && req.ChangeValue != nil {
			rowValues[req.ChangeColumn] = req.ChangeValue
		}

		ops = append(ops, model.CommitOp{
			Type:   "insert",
			Table:  req.Table,
			Values: rowValues,
		})
	}

	return &model.PreviewResponse{Ops: ops, Warnings: []string{}, Errors: []model.PreviewError{}}, nil
}

// PreviewBatchGenerate generates insert ops similar to clone with per-row change_column values.
func (s *Service) PreviewBatchGenerate(ctx context.Context, req model.PreviewBatchGenerateRequest) (*model.PreviewResponse, error) {
	// Resolve new values: prefer new_values, fall back to new_pks (legacy)
	newValues := req.NewValues
	if len(newValues) == 0 {
		newValues = req.NewPKs
	}

	// Validate change_values length if provided
	if len(req.ChangeValues) > 0 && len(req.ChangeValues) != len(newValues) {
		return nil, &model.APIError{
			Status: 400, Code: model.CodeInvalidArgument,
			Msg: fmt.Sprintf("change_values length (%d) must match new_values length (%d)", len(req.ChangeValues), len(newValues)),
		}
	}

	cloneReq := model.PreviewCloneRequest{
		TargetID:     req.TargetID,
		DBName:       req.DBName,
		BranchName:   req.BranchName,
		Table:        req.Table,
		TemplatePK:   req.TemplatePK,
		VaryColumn:   req.VaryColumn,
		NewValues:    newValues,
		ChangeColumn: req.ChangeColumn,
	}

	result, err := s.PreviewClone(ctx, cloneReq)
	if err != nil {
		return nil, err
	}

	// Apply per-row change_values if provided
	if req.ChangeColumn != "" && len(req.ChangeValues) > 0 {
		for i := range result.Ops {
			if i < len(req.ChangeValues) {
				result.Ops[i].Values[req.ChangeColumn] = req.ChangeValues[i]
			}
		}
	}

	return result, nil
}

// PreviewBulkUpdate generates update ops from TSV data.
// Per v6f spec section 3.2: parse TSV, validate columns, check PKs, generate ops.
func (s *Service) PreviewBulkUpdate(ctx context.Context, req model.PreviewBulkUpdateRequest) (*model.PreviewResponse, error) {
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}

	// Parse TSV
	lines := strings.Split(strings.TrimSpace(req.TSVData), "\n")
	if len(lines) < 2 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "TSV must have header and at least one data row"}
	}

	headers := strings.Split(lines[0], "\t")
	if len(headers) < 2 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "TSV must have PK column and at least one update column"}
	}

	// Validate all column names
	for _, h := range headers {
		if err := validation.ValidateIdentifier("column", strings.TrimSpace(h)); err != nil {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("invalid column name in TSV header: %s", h)}
		}
	}

	// Get schema to determine PK columns (N columns for composite PK)
	schema, err := s.GetTableSchema(ctx, req.TargetID, req.DBName, req.BranchName, req.Table)
	if err != nil {
		return nil, err
	}
	allowedCols := make(map[string]bool)
	var schemaPKCols []string
	var schemaPKColSet = make(map[string]bool)
	for _, col := range schema.Columns {
		allowedCols[col.Name] = true
		if col.PrimaryKey {
			schemaPKCols = append(schemaPKCols, col.Name)
			schemaPKColSet[col.Name] = true
		}
	}
	if len(schemaPKCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "table has no primary key"}
	}

	// Validate TSV headers: first N columns must match schema PK columns (in order)
	if len(headers) < len(schemaPKCols)+1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument,
			Msg: fmt.Sprintf("TSV must have %d PK column(s) + at least one update column", len(schemaPKCols))}
	}
	for i, pkCol := range schemaPKCols {
		if strings.TrimSpace(headers[i]) != pkCol {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument,
				Msg: fmt.Sprintf("TSV column %d must be '%s' (PK), got '%s'", i+1, pkCol, headers[i])}
		}
	}
	var updateCols []string
	updateCols = make([]string, len(headers)-len(schemaPKCols))
	for i := len(schemaPKCols); i < len(headers); i++ {
		updateCols[i-len(schemaPKCols)] = strings.TrimSpace(headers[i])
	}
	for _, col := range updateCols {
		if !allowedCols[col] {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in TSV: %s", col)}
		}
		if schemaPKColSet[col] {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("column '%s' is a PK column; cannot be in update columns", col)}
		}
	}

	// Parse data rows — composite PK support
	type tsvRow struct {
		pk     map[string]interface{} // all PK columns
		pkKey  string                 // JSON-encoded PK for dedup
		values map[string]interface{}
	}
	var tsvRows []tsvRow
	seenPKs := make(map[string]bool)

	for i := 1; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) != len(headers) {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("TSV row %d has %d fields, expected %d", i+1, len(fields), len(headers))}
		}

		// Build PK map from first N columns
		pkMap := make(map[string]interface{}, len(schemaPKCols))
		for j, col := range schemaPKCols {
			pkMap[col] = strings.TrimSpace(fields[j])
		}
		// BUG-12 fix: use normalizePkJSON to get deterministic JSON key order
		// (Go map iteration order is non-deterministic; same PK may produce different JSON)
		pkKeyBytes, _ := json.Marshal(normalizePkJSON(pkMap))
		pkKey := string(pkKeyBytes)
		if seenPKs[pkKey] {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("duplicate PK in TSV: %s", pkKey)}
		}
		seenPKs[pkKey] = true

		vals := make(map[string]interface{})
		for j, col := range updateCols {
			vals[col] = strings.TrimSpace(fields[j+len(schemaPKCols)])
		}
		tsvRows = append(tsvRows, tsvRow{pk: pkMap, pkKey: pkKey, values: vals})
	}

	if len(tsvRows) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "no data rows in TSV"}
	}

	// Verify all PK combinations exist in the table
	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Build: WHERE (col1=? AND col2=?) OR (col1=? AND col2=?) ...
	rowConditions := make([]string, len(tsvRows))
	pkExistArgs := make([]interface{}, 0, len(tsvRows)*len(schemaPKCols))
	for i, row := range tsvRows {
		conds := make([]string, len(schemaPKCols))
		for j, col := range schemaPKCols {
			conds[j] = fmt.Sprintf("`%s` = ?", col)
			pkExistArgs = append(pkExistArgs, row.pk[col])
		}
		rowConditions[i] = "(" + strings.Join(conds, " AND ") + ")"
	}

	var existCount int
	existQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE %s",
		req.Table, strings.Join(rowConditions, " OR "))
	if err := conn.QueryRowContext(ctx, existQuery, pkExistArgs...).Scan(&existCount); err != nil {
		return nil, fmt.Errorf("failed to check PKs: %w", err)
	}
	if existCount != len(tsvRows) {
		return nil, &model.APIError{
			Status: 400,
			Code:   model.CodeInvalidArgument,
			Msg:    fmt.Sprintf("%d of %d PKs not found in table", len(tsvRows)-existCount, len(tsvRows)),
		}
	}

	// Generate update ops
	ops := make([]model.CommitOp, 0, len(tsvRows))
	for _, row := range tsvRows {
		ops = append(ops, model.CommitOp{
			Type:   "update",
			Table:  req.Table,
			Values: row.values,
			PK:     row.pk,
		})
	}

	return &model.PreviewResponse{Ops: ops, Warnings: []string{}, Errors: []model.PreviewError{}}, nil
}
