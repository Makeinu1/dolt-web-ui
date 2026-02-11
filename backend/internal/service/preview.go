package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// PreviewClone generates insert ops by cloning a template row with new PKs.
// Per v6f spec section 3.1: fetch template, generate ops, check collisions.
func (s *Service) PreviewClone(ctx context.Context, req model.PreviewCloneRequest) (*model.PreviewResponse, error) {
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table name"}
	}
	if len(req.TemplatePK) != 1 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "single primary key required"}
	}
	if len(req.NewPKs) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "at least one new_pk is required"}
	}

	var pkCol string
	var pkVal interface{}
	for k, v := range req.TemplatePK {
		pkCol = k
		pkVal = v
	}
	if err := validation.ValidateIdentifier("pk column", pkCol); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Fetch template row
	query := fmt.Sprintf("SELECT * FROM `%s` WHERE `%s` = ? LIMIT 1", req.Table, pkCol)
	rows, err := conn.QueryContext(ctx, query, pkVal)
	if err != nil {
		return nil, fmt.Errorf("failed to query template: %w", err)
	}
	defer rows.Close()

	colNames, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("failed to get columns: %w", err)
	}

	if !rows.Next() {
		return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "template row not found"}
	}

	values := make([]interface{}, len(colNames))
	valuePtrs := make([]interface{}, len(colNames))
	for i := range values {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		return nil, fmt.Errorf("failed to scan template: %w", err)
	}

	templateRow := make(map[string]interface{})
	for i, col := range colNames {
		if b, ok := values[i].([]byte); ok {
			templateRow[col] = string(b)
		} else {
			templateRow[col] = values[i]
		}
	}

	// Check for PK collisions
	if len(req.NewPKs) > 0 {
		placeholders := make([]string, len(req.NewPKs))
		for i := range req.NewPKs {
			placeholders[i] = "?"
		}
		collisionQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE `%s` IN (%s)",
			req.Table, pkCol, strings.Join(placeholders, ","))
		args := make([]interface{}, len(req.NewPKs))
		for i, pk := range req.NewPKs {
			args[i] = pk
		}
		var collisions int
		if err := conn.QueryRowContext(ctx, collisionQuery, args...).Scan(&collisions); err == nil && collisions > 0 {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("%d new PKs already exist in table", collisions)}
		}
	}

	// Generate ops
	ops := make([]model.CommitOp, 0, len(req.NewPKs))
	for _, newPK := range req.NewPKs {
		rowValues := make(map[string]interface{})
		for k, v := range templateRow {
			rowValues[k] = v
		}
		rowValues[pkCol] = newPK

		ops = append(ops, model.CommitOp{
			Type:   "insert",
			Table:  req.Table,
			Values: rowValues,
		})
	}

	return &model.PreviewResponse{Ops: ops}, nil
}

// PreviewBatchGenerate generates insert ops similar to clone with optional overrides.
// Per v6f spec section 3.3.
func (s *Service) PreviewBatchGenerate(ctx context.Context, req model.PreviewBatchGenerateRequest) (*model.PreviewResponse, error) {
	cloneReq := model.PreviewCloneRequest{
		TargetID:   req.TargetID,
		DBName:     req.DBName,
		BranchName: req.BranchName,
		Table:      req.Table,
		TemplatePK: req.TemplatePK,
		NewPKs:     req.NewPKs,
	}

	result, err := s.PreviewClone(ctx, cloneReq)
	if err != nil {
		return nil, err
	}

	// Apply overrides if specified
	if req.Overrides != nil && len(req.Overrides) > 0 {
		for i := range result.Ops {
			for k, v := range req.Overrides {
				result.Ops[i].Values[k] = v
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

	pkCol := strings.TrimSpace(headers[0])
	updateCols := make([]string, len(headers)-1)
	for i := 1; i < len(headers); i++ {
		updateCols[i-1] = strings.TrimSpace(headers[i])
	}

	// Get schema to validate columns exist
	schema, err := s.GetTableSchema(ctx, req.TargetID, req.DBName, req.BranchName, req.Table)
	if err != nil {
		return nil, err
	}
	allowedCols := make(map[string]bool)
	var schemaPKCol string
	for _, col := range schema.Columns {
		allowedCols[col.Name] = true
		if col.PrimaryKey {
			schemaPKCol = col.Name
		}
	}

	// Validate PK column matches schema
	if pkCol != schemaPKCol {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("first TSV column '%s' must match PK column '%s'", pkCol, schemaPKCol)}
	}
	for _, col := range updateCols {
		if !allowedCols[col] {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("unknown column in TSV: %s", col)}
		}
	}

	// Parse data rows
	type tsvRow struct {
		pk     string
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

		pk := strings.TrimSpace(fields[0])
		if seenPKs[pk] {
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("duplicate PK in TSV: %s", pk)}
		}
		seenPKs[pk] = true

		vals := make(map[string]interface{})
		for j, col := range updateCols {
			vals[col] = strings.TrimSpace(fields[j+1])
		}
		tsvRows = append(tsvRows, tsvRow{pk: pk, values: vals})
	}

	if len(tsvRows) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "no data rows in TSV"}
	}

	// Verify all PKs exist in the table
	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	placeholders := make([]string, len(tsvRows))
	pkArgs := make([]interface{}, len(tsvRows))
	for i, row := range tsvRows {
		placeholders[i] = "?"
		pkArgs[i] = row.pk
	}

	var existCount int
	existQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE `%s` IN (%s)",
		req.Table, pkCol, strings.Join(placeholders, ","))
	if err := conn.QueryRowContext(ctx, existQuery, pkArgs...).Scan(&existCount); err != nil {
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
			PK:     map[string]interface{}{pkCol: row.pk},
		})
	}

	return &model.PreviewResponse{Ops: ops}, nil
}
