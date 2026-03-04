package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// CSVPreview compares CSV rows against DB rows and returns insert/update/skip counts.
func (s *Service) CSVPreview(ctx context.Context, req model.CSVPreviewRequest) (*model.CSVPreviewResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "protected branch cannot be modified"}
	}
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}
	if len(req.Rows) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "CSVデータが空です"}
	}

	// NEW-7: CSVPreview is read-only, use Conn (not ConnWrite) to avoid unnecessary write lock.
	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Get table schema
	cols, err := getSchemaColumns(ctx, conn, req.Table)
	if err != nil {
		return nil, err
	}

	pkCols := getPKColumns(cols)
	if len(pkCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "テーブルに主キーがありません"}
	}

	// Validate CSV headers contain all PK columns
	if len(req.Rows) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "CSVにデータ行がありません"}
	}
	headers := make(map[string]bool)
	for k := range req.Rows[0] {
		headers[k] = true
	}
	for _, pk := range pkCols {
		if !headers[pk] {
			return nil, &model.APIError{
				Status: 400,
				Code:   model.CodeInvalidArgument,
				Msg:    fmt.Sprintf("CSVに主キーカラム '%s' が含まれていません", pk),
			}
		}
	}

	inserts, updates, skips := 0, 0, 0
	var sampleDiffs []model.CSVDiffRow
	var previewErrors []model.CSVPreviewError

	for i, csvRow := range req.Rows {
		if i >= 1000 {
			break // safety limit
		}

		// Build WHERE clause for PK lookup
		whereParts := make([]string, 0, len(pkCols))
		whereArgs := make([]interface{}, 0, len(pkCols))
		for _, pk := range pkCols {
			val, ok := csvRow[pk]
			if !ok {
				previewErrors = append(previewErrors, model.CSVPreviewError{
					RowIndex: i,
					Message:  fmt.Sprintf("主キー '%s' が見つかりません", pk),
				})
				continue
			}
			whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", pk))
			whereArgs = append(whereArgs, val)
		}
		if len(whereParts) != len(pkCols) {
			continue
		}

		// Fetch existing DB row
		query := fmt.Sprintf("SELECT * FROM `%s` WHERE %s LIMIT 1", req.Table, strings.Join(whereParts, " AND "))
		rows, err := conn.QueryContext(ctx, query, whereArgs...)
		if err != nil {
			previewErrors = append(previewErrors, model.CSVPreviewError{RowIndex: i, Message: err.Error()})
			continue
		}

		dbCols, _ := rows.Columns()
		var dbRow map[string]interface{}
		if rows.Next() {
			vals := make([]interface{}, len(dbCols))
			ptrs := make([]interface{}, len(dbCols))
			for j := range vals {
				ptrs[j] = &vals[j]
			}
			if err := rows.Scan(ptrs...); err == nil {
				dbRow = make(map[string]interface{}, len(dbCols))
				for j, col := range dbCols {
					v := vals[j]
					if b, ok := v.([]byte); ok {
						dbRow[col] = string(b)
					} else {
						dbRow[col] = v
					}
				}
			}
		}
		rows.Close()

		if dbRow == nil {
			// Row not in DB → insert
			inserts++
			if len(sampleDiffs) < 5 {
				sampleDiffs = append(sampleDiffs, model.CSVDiffRow{
					Action: "insert",
					Row:    csvRow,
				})
			}
		} else {
			// Check if anything changed
			changed := false
			for k, csvVal := range csvRow {
				dbVal := dbRow[k]
				if fmt.Sprintf("%v", csvVal) != fmt.Sprintf("%v", dbVal) {
					changed = true
					break
				}
			}
			if changed {
				updates++
				if len(sampleDiffs) < 5 {
					sampleDiffs = append(sampleDiffs, model.CSVDiffRow{
						Action: "update",
						Row:    csvRow,
						OldRow: dbRow,
					})
				}
			} else {
				skips++
			}
		}
	}

	return &model.CSVPreviewResponse{
		Inserts:       inserts,
		Updates:       updates,
		Skips:         skips,
		Errors:        len(previewErrors),
		SampleDiffs:   sampleDiffs,
		PreviewErrors: previewErrors,
	}, nil
}

// CSVApply inserts or updates rows from CSV data, then commits.
func (s *Service) CSVApply(ctx context.Context, req model.CSVApplyRequest) (*model.CommitResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "protected branch cannot be modified"}
	}
	if err := validation.ValidateIdentifier("table", req.Table); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}
	if len(req.Rows) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "CSVデータが空です"}
	}

	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Branch lock check
	if apiErr := checkBranchLocked(ctx, conn, req.BranchName); apiErr != nil {
		return nil, apiErr
	}

	// Get schema
	cols, err := getSchemaColumns(ctx, conn, req.Table)
	if err != nil {
		return nil, err
	}
	pkCols := getPKColumns(cols)
	if len(pkCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "テーブルに主キーがありません"}
	}

	// START TRANSACTION
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// NEW-3: expected_head check inside TX to eliminate race window.
	var currentHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, fmt.Errorf("failed to get HEAD: %w", err)
	}
	if currentHead != req.ExpectedHead {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, &model.APIError{
			Status:  409,
			Code:    model.CodeStaleHead,
			Msg:     "expected_head mismatch",
			Details: map[string]string{"expected_head": req.ExpectedHead, "actual_head": currentHead},
		}
	}

	for i, csvRow := range req.Rows {
		if i >= 1000 {
			break
		}

		// Build PKs map
		pkMap := make(map[string]interface{}, len(pkCols))
		for _, pk := range pkCols {
			pkMap[pk] = csvRow[pk]
		}

		// Check existence
		whereParts := make([]string, 0, len(pkCols))
		whereArgs := make([]interface{}, 0, len(pkCols))
		for _, pk := range pkCols {
			whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", pk))
			whereArgs = append(whereArgs, pkMap[pk])
		}

		var existCount int
		checkQuery := fmt.Sprintf("SELECT COUNT(*) FROM `%s` WHERE %s", req.Table, strings.Join(whereParts, " AND "))
		if err := conn.QueryRowContext(ctx, checkQuery, whereArgs...).Scan(&existCount); err != nil {
			conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
			return nil, fmt.Errorf("failed to check row existence: %w", err)
		}

		if existCount == 0 {
			// INSERT
			csvCols := make([]string, 0, len(csvRow))
			placeholders := make([]string, 0, len(csvRow))
			args := make([]interface{}, 0, len(csvRow))
			for col, val := range csvRow {
				if err := validation.ValidateIdentifier("column", col); err != nil {
					continue
				}
				csvCols = append(csvCols, fmt.Sprintf("`%s`", col))
				placeholders = append(placeholders, "?")
				args = append(args, val)
			}
			insertSQL := fmt.Sprintf("INSERT INTO `%s` (%s) VALUES (%s)",
				req.Table, strings.Join(csvCols, ", "), strings.Join(placeholders, ", "))
			if _, err := conn.ExecContext(ctx, insertSQL, args...); err != nil {
				conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
				return nil, fmt.Errorf("failed to insert row %d: %w", i, err)
			}
		} else {
			// UPDATE non-PK columns
			setParts := make([]string, 0)
			setArgs := make([]interface{}, 0)
			pkSet := make(map[string]bool, len(pkCols))
			for _, pk := range pkCols {
				pkSet[pk] = true
			}
			for col, val := range csvRow {
				if pkSet[col] {
					continue
				}
				if err := validation.ValidateIdentifier("column", col); err != nil {
					continue
				}
				setParts = append(setParts, fmt.Sprintf("`%s` = ?", col))
				setArgs = append(setArgs, val)
			}
			if len(setParts) == 0 {
				continue
			}
			updateSQL := fmt.Sprintf("UPDATE `%s` SET %s WHERE %s",
				req.Table, strings.Join(setParts, ", "), strings.Join(whereParts, " AND "))
			// NEW-1: avoid append backing-array corruption by allocating a new slice.
			allArgs := make([]interface{}, 0, len(setArgs)+len(whereArgs))
			allArgs = append(allArgs, setArgs...)
			allArgs = append(allArgs, whereArgs...)
			if _, err := conn.ExecContext(ctx, updateSQL, allArgs...); err != nil {
				conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
				return nil, fmt.Errorf("failed to update row %d: %w", i, err)
			}
		}
	}

	// NEW-2: DOLT_VERIFY_CONSTRAINTS — ensure FK/CHECK constraints are not violated.
	if _, err := conn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, fmt.Errorf("failed to verify constraints: %w", err)
	}
	var violationCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "constraint violations detected"}
	}

	// DOLT_ADD + DOLT_COMMIT
	if _, err := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, fmt.Errorf("failed to add: %w", err)
	}

	commitMsg := req.CommitMessage
	if commitMsg == "" {
		commitMsg = fmt.Sprintf("[CSV] %s: 一括更新", req.Table)
	}
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", commitMsg); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.CommitResponse{Hash: newHead}, nil
}
