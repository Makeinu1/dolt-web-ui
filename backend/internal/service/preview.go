package service

import (
	"context"
	"database/sql"
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

	// PK-preserving copy: if no new_values, fetch template and return as-is insert op
	if len(newValues) == 0 {
		conn, err := s.connAllowedRevision(ctx, req.TargetID, req.DBName, req.BranchName)
		if err != nil {
			return nil, err
		}
		defer conn.Close()

		templateRow, _, err := s.fetchTemplateRow(ctx, conn, req.Table, req.TemplatePK)
		if err != nil {
			return nil, err
		}

		ops := []model.CommitOp{{
			Type:   "insert",
			Table:  req.Table,
			Values: templateRow,
		}}
		return &model.PreviewResponse{Ops: ops, Warnings: []string{}, Errors: []model.PreviewError{}}, nil
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

	conn, err := s.connAllowedRevision(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	templateRow, colNames, err := s.fetchTemplateRow(ctx, conn, req.Table, req.TemplatePK)
	if err != nil {
		return nil, err
	}
	_ = colNames

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

// fetchTemplateRow fetches a single row by its PK values and returns the row as a map + column names.
func (s *Service) fetchTemplateRow(ctx context.Context, conn *sql.Conn, table string, templatePK map[string]interface{}) (map[string]interface{}, []string, error) {
	whereParts := make([]string, 0, len(templatePK))
	whereArgs := make([]interface{}, 0, len(templatePK))
	for k, v := range templatePK {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return nil, nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name: " + k}
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	query := fmt.Sprintf("SELECT * FROM `%s` WHERE %s LIMIT 1", table, strings.Join(whereParts, " AND "))
	rows, err := conn.QueryContext(ctx, query, whereArgs...)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to query template: %w", err)
	}

	colNames, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, nil, fmt.Errorf("failed to get columns: %w", err)
	}

	if !rows.Next() {
		rows.Close()
		return nil, nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: "template row not found"}
	}

	values := make([]interface{}, len(colNames))
	valuePtrs := make([]interface{}, len(colNames))
	for i := range values {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		rows.Close()
		return nil, nil, fmt.Errorf("failed to scan template: %w", err)
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
	return templateRow, colNames, nil
}
