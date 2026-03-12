package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// varcharRe parses varchar(N) type strings.
var varcharRe = regexp.MustCompile(`^varchar\((\d+)\)$`)

// stringTypeOrder defines the expansion order for text types.
// A column can be expanded to a wider type automatically.
var stringTypeOrder = []string{"tinytext", "text", "mediumtext", "longtext"}

// parseVarcharLen returns the length from "varchar(N)" or -1 if not varchar.
func parseVarcharLen(t string) int {
	m := varcharRe.FindStringSubmatch(t)
	if m == nil {
		return -1
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

// stringTypeLevel returns the expansion level of a text type (higher = wider), -1 if not a text type.
func stringTypeLevel(t string) int {
	for i, v := range stringTypeOrder {
		if strings.EqualFold(t, v) {
			return i
		}
	}
	return -1
}

// needsExpansion checks if destType is narrower than srcType for string columns.
// Returns (true, widenedType) if expansion is needed.
func needsExpansion(srcType, dstType string) (bool, string) {
	srcLen := parseVarcharLen(srcType)
	dstLen := parseVarcharLen(dstType)

	// Both varchar: expand if src is wider
	if srcLen >= 0 && dstLen >= 0 {
		if srcLen > dstLen {
			return true, srcType // use src's varchar(N)
		}
		return false, ""
	}

	// varchar → text upgrade (varchar is always narrower than any text type)
	if srcLen < 0 && dstLen >= 0 {
		srcLevel := stringTypeLevel(srcType)
		if srcLevel >= 0 {
			// src is text type, dst is varchar — expand dst to src
			return true, srcType
		}
		return false, ""
	}
	if srcLen >= 0 && dstLen < 0 {
		// src is varchar, dst is text — dest is already wider
		return false, ""
	}

	// Both text types: expand if src level is higher
	srcLevel := stringTypeLevel(srcType)
	dstLevel := stringTypeLevel(dstType)
	if srcLevel >= 0 && dstLevel >= 0 && srcLevel > dstLevel {
		return true, srcType
	}
	return false, ""
}

// parseCopyError maps MySQL data errors to user-friendly COPY_DATA_ERROR responses.
// Returns nil if the error is not a recognized copy-related error.
func parseCopyError(err error) *model.APIError {
	s := err.Error()
	switch {
	case strings.Contains(s, "Data too long"):
		return &model.APIError{Status: 400, Code: model.CodeCopyDataError, Msg: "データ長超過: " + s}
	case strings.Contains(s, "Out of range"):
		return &model.APIError{Status: 400, Code: model.CodeCopyDataError, Msg: "値域超過: " + s}
	case strings.Contains(s, "Data truncated"):
		return &model.APIError{Status: 400, Code: model.CodeCopyDataError, Msg: "データ切り捨て: " + s}
	case strings.Contains(s, "doesn't have a default"):
		return &model.APIError{Status: 400, Code: model.CodeCopyDataError, Msg: "必須カラム未設定: " + s}
	case strings.Contains(s, "Incorrect string value"):
		return &model.APIError{Status: 400, Code: model.CodeCopyDataError, Msg: "文字コード不一致: " + s}
	case strings.Contains(s, "foreign key constraint fails"):
		return &model.APIError{Status: 400, Code: model.CodeCopyFKError, Msg: "外部キー制約違反: " + s}
	default:
		return nil
	}
}

// getSchemaColumns fetches column schema for a table on a given connection.
// Caller must ensure conn is set to the correct db/branch.
func getSchemaColumns(ctx context.Context, conn *sql.Conn, table string) ([]model.ColumnSchema, error) {
	rows, err := conn.QueryContext(ctx, fmt.Sprintf("SHOW COLUMNS FROM `%s`", table))
	if err != nil {
		if strings.Contains(err.Error(), "doesn't exist") || strings.Contains(err.Error(), "not found") {
			return nil, &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: fmt.Sprintf("テーブル %s が見つかりません", table)}
		}
		return nil, fmt.Errorf("failed to get schema for %s: %w", table, err)
	}
	var cols []model.ColumnSchema
	for rows.Next() {
		var field, colType, null, key string
		var defaultVal, extra sql.NullString
		if err := rows.Scan(&field, &colType, &null, &key, &defaultVal, &extra); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to scan column: %w", err)
		}
		cols = append(cols, model.ColumnSchema{
			Name:       field,
			Type:       colType,
			Nullable:   null == "YES",
			PrimaryKey: key == "PRI",
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate columns: %w", err)
	}
	return cols, nil
}

// computeSharedColumns computes shared, source-only, and dest-only column names.
func computeSharedColumns(srcCols, dstCols []model.ColumnSchema) (shared, srcOnly, dstOnly []string) {
	srcSet := make(map[string]bool, len(srcCols))
	for _, c := range srcCols {
		srcSet[c.Name] = true
	}
	dstSet := make(map[string]bool, len(dstCols))
	for _, c := range dstCols {
		dstSet[c.Name] = true
	}

	for _, c := range srcCols {
		if dstSet[c.Name] {
			shared = append(shared, c.Name)
		} else {
			srcOnly = append(srcOnly, c.Name)
		}
	}
	for _, c := range dstCols {
		if !srcSet[c.Name] {
			dstOnly = append(dstOnly, c.Name)
		}
	}

	// Ensure non-nil slices for JSON
	if shared == nil {
		shared = make([]string, 0)
	}
	if srcOnly == nil {
		srcOnly = make([]string, 0)
	}
	if dstOnly == nil {
		dstOnly = make([]string, 0)
	}
	return
}

func expandColumnsForShared(srcCols, dstCols []model.ColumnSchema, shared []string) []model.ExpandColumn {
	srcColMap := make(map[string]model.ColumnSchema, len(srcCols))
	for _, c := range srcCols {
		srcColMap[c.Name] = c
	}
	dstColMap := make(map[string]model.ColumnSchema, len(dstCols))
	for _, c := range dstCols {
		dstColMap[c.Name] = c
	}

	expandColumns := make([]model.ExpandColumn, 0)
	for _, colName := range shared {
		sc := srcColMap[colName]
		dc := dstColMap[colName]
		if sc.Type != dc.Type {
			if expand, _ := needsExpansion(sc.Type, dc.Type); expand {
				expandColumns = append(expandColumns, model.ExpandColumn{
					Name:    colName,
					SrcType: sc.Type,
					DstType: dc.Type,
				})
			}
		}
	}
	return expandColumns
}

func crossCopySchemaPreconditionError(expandColumns []model.ExpandColumn) *model.APIError {
	return &model.APIError{
		Status: 412,
		Code:   model.CodePreconditionFailed,
		Msg:    "スキーマ準備が必要です。管理レーンで schema を揃えてから再試行してください。",
		Details: map[string]interface{}{
			"expand_columns": expandColumns,
		},
	}
}

func crossCopyRowsRetryResponse(hash string, inserted, updated int, message, retryReason string) *model.CrossCopyRowsResponse {
	total := inserted + updated
	return &model.CrossCopyRowsResponse{
		Hash:     hash,
		Inserted: inserted,
		Updated:  updated,
		Total:    total,
		OperationResultFields: model.OperationResultFields{
			Outcome:     model.OperationOutcomeRetryRequired,
			Message:     message,
			RetryReason: retryReason,
			RetryActions: []model.RetryAction{
				{Action: "reopen_destination_branch", Label: "宛先ブランチを開き直す"},
			},
			Completion: map[string]bool{
				"destination_committed":    hash != "",
				"destination_branch_ready": false,
				"protected_refs_clean":     true,
			},
		},
	}
}

// getPKColumns returns PK column names from a schema.
func getPKColumns(cols []model.ColumnSchema) []string {
	pks := make([]string, 0)
	for _, c := range cols {
		if c.PrimaryKey {
			pks = append(pks, c.Name)
		}
	}
	return pks
}

// fetchRowsByPKs fetches rows from a table using PK JSON strings.
// Each pkJSON is a JSON string like {"id":1} or {"a":1,"b":2}.
// Returns a map of pkJSON → row data (shared columns only).
func fetchRowsByPKs(ctx context.Context, conn *sql.Conn, table string, pkCols []string, pkJSONs []string, selectCols []string) (map[string]map[string]interface{}, error) {
	result := make(map[string]map[string]interface{}, len(pkJSONs))
	if len(pkJSONs) == 0 || len(selectCols) == 0 {
		return result, nil
	}

	// Build SELECT with all selectCols
	quotedCols := make([]string, len(selectCols))
	for i, c := range selectCols {
		quotedCols[i] = fmt.Sprintf("`%s`", c)
	}
	selectList := strings.Join(quotedCols, ", ")

	// For each PK, parse and query individually (simpler than building IN for composite PKs)
	for _, pkJSON := range pkJSONs {
		// Parse PK JSON to get column→value pairs
		pkMap, err := parsePKJSON(pkJSON)
		if err != nil {
			continue // skip invalid PKs
		}

		whereParts := make([]string, 0, len(pkCols))
		whereArgs := make([]interface{}, 0, len(pkCols))
		for _, pk := range pkCols {
			v, ok := pkMap[pk]
			if !ok {
				continue
			}
			whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", pk))
			whereArgs = append(whereArgs, v)
		}
		if len(whereParts) == 0 {
			continue
		}

		query := fmt.Sprintf("SELECT %s FROM `%s` WHERE %s LIMIT 1",
			selectList, table, strings.Join(whereParts, " AND "))
		rows, err := conn.QueryContext(ctx, query, whereArgs...)
		if err != nil {
			continue
		}

		colNames, err := rows.Columns()
		if err != nil {
			rows.Close()
			continue
		}
		if rows.Next() {
			vals := make([]interface{}, len(colNames))
			ptrs := make([]interface{}, len(colNames))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				rows.Close()
				continue
			}
			row := make(map[string]interface{}, len(colNames))
			for i, name := range colNames {
				v := vals[i]
				if b, ok := v.([]byte); ok {
					row[name] = string(b)
				} else {
					row[name] = v
				}
			}
			result[pkJSON] = row
		}
		rows.Close()
	}
	return result, nil
}

// parsePKJSON parses a PK JSON string like {"id":"1"} into a map.
func parsePKJSON(pkJSON string) (map[string]interface{}, error) {
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(pkJSON), &m); err != nil {
		return nil, err
	}
	return m, nil
}

// CrossCopyPreview generates a preview of cross-DB row copy.
func (s *Service) CrossCopyPreview(ctx context.Context, req model.CrossCopyPreviewRequest) (*model.CrossCopyPreviewResponse, error) {
	// Validate inputs
	if err := validation.ValidateDBName(req.SourceDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースDB名"}
	}
	if err := validation.ValidateDBName(req.DestDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効な宛先DB名"}
	}
	if err := validation.ValidateBranchName(req.SourceBranch); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースブランチ名"}
	}
	if err := s.ensureCrossCopySourceRef(req.TargetID, req.SourceDB, req.SourceBranch); err != nil {
		return nil, err
	}
	if err := s.ensureCrossCopyDestinationBranch(req.TargetID, req.DestDB, req.DestBranch); err != nil {
		return nil, err
	}
	if err := validation.ValidateIdentifier("table", req.SourceTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}
	if len(req.SourcePKs) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "source_pks は空にできません"}
	}

	// Get source connection (read-only)
	srcConn, err := s.connCrossCopySourceRevision(ctx, req.TargetID, req.SourceDB, req.SourceBranch)
	if err != nil {
		return nil, err
	}
	defer srcConn.Close()

	// Get dest connection (read-only for preview)
	dstConn, err := s.connCrossCopyDestinationRevision(ctx, req.TargetID, req.DestDB, req.DestBranch)
	if err != nil {
		return nil, err
	}
	defer dstConn.Close()

	// Get schemas
	srcCols, err := getSchemaColumns(ctx, srcConn, req.SourceTable)
	if err != nil {
		return nil, err
	}
	dstCols, err := getSchemaColumns(ctx, dstConn, req.SourceTable)
	if err != nil {
		return nil, err
	}

	shared, srcOnly, dstOnly := computeSharedColumns(srcCols, dstCols)
	if len(shared) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "共有カラムがありません"}
	}

	// Generate warnings
	warnings := make([]string, 0)
	if len(srcOnly) > 0 {
		warnings = append(warnings, fmt.Sprintf("コピーされないカラム（コピー元のみ）: %s", strings.Join(srcOnly, ", ")))
	}

	// Check dest-only NOT NULL without DEFAULT columns
	srcColMap := make(map[string]model.ColumnSchema, len(srcCols))
	for _, c := range srcCols {
		srcColMap[c.Name] = c
	}
	dstColMap := make(map[string]model.ColumnSchema, len(dstCols))
	for _, c := range dstCols {
		dstColMap[c.Name] = c
	}

	for _, colName := range dstOnly {
		dc := dstColMap[colName]
		if !dc.Nullable {
			warnings = append(warnings, fmt.Sprintf("宛先固有カラム %s は NOT NULL です（INSERT失敗の可能性）", colName))
		}
	}

	// Check type mismatches on shared columns; detect string columns that need expansion.
	expandColumns := expandColumnsForShared(srcCols, dstCols, shared)
	for _, colName := range shared {
		sc := srcColMap[colName]
		dc := dstColMap[colName]
		if sc.Type != dc.Type {
			if expand, _ := needsExpansion(sc.Type, dc.Type); !expand {
				warnings = append(warnings, fmt.Sprintf("カラム %s の型が異なります（コピー元: %s, 宛先: %s）", colName, sc.Type, dc.Type))
			}
		}
	}

	// Fetch source rows
	pkCols := getPKColumns(srcCols)
	if len(pkCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "ソーステーブルに主キーがありません"}
	}
	srcRows, err := fetchRowsByPKs(ctx, srcConn, req.SourceTable, pkCols, req.SourcePKs, shared)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch source rows: %w", err)
	}

	// Fetch dest rows for same PKs
	dstPKCols := getPKColumns(dstCols)
	if len(dstPKCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "宛先テーブルに主キーがありません"}
	}
	dstRows, err := fetchRowsByPKs(ctx, dstConn, req.SourceTable, dstPKCols, req.SourcePKs, shared)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch dest rows: %w", err)
	}

	// Build preview rows
	previewRows := make([]model.CrossCopyPreviewRow, 0, len(req.SourcePKs))
	for _, pkJSON := range req.SourcePKs {
		srcRow, ok := srcRows[pkJSON]
		if !ok {
			continue // source row not found, skip
		}
		dstRow, exists := dstRows[pkJSON]
		action := "insert"
		if exists {
			action = "update"
		}
		pr := model.CrossCopyPreviewRow{
			SourceRow: srcRow,
			Action:    action,
		}
		if exists {
			pr.DestRow = dstRow
		}
		previewRows = append(previewRows, pr)
	}

	return &model.CrossCopyPreviewResponse{
		SharedColumns:  shared,
		SourceOnlyCols: srcOnly,
		DestOnlyCols:   dstOnly,
		Warnings:       warnings,
		Rows:           previewRows,
		ExpandColumns:  expandColumns,
	}, nil
}

// applyExpandColumns runs ALTER TABLE MODIFY COLUMN for each column that needs widening.
// Must be called outside of a transaction (DDL auto-commits in Dolt/MySQL).
// Returns (true, nil) if at least one column was widened, (false, nil) if no expansion was needed.
func applyExpandColumns(ctx context.Context, conn *sql.Conn, table string, srcColMap, dstColMap map[string]model.ColumnSchema, shared []string) (bool, error) {
	expanded := false
	for _, colName := range shared {
		sc := srcColMap[colName]
		dc := dstColMap[colName]
		if sc.Type == dc.Type {
			continue
		}
		expand, widenedType := needsExpansion(sc.Type, dc.Type)
		if !expand {
			continue
		}
		// Preserve NOT NULL constraint from dest column
		nullClause := "NULL"
		if !dc.Nullable {
			nullClause = "NOT NULL"
		}
		alterSQL := fmt.Sprintf("ALTER TABLE `%s` MODIFY COLUMN `%s` %s %s", table, colName, widenedType, nullClause)
		if _, err := conn.ExecContext(ctx, alterSQL); err != nil {
			return false, fmt.Errorf("failed to expand column %s to %s: %w", colName, widenedType, err)
		}
		expanded = true
	}
	return expanded, nil
}

// CrossCopyRows copies selected rows from source DB/branch to dest DB/branch.
func (s *Service) CrossCopyRows(ctx context.Context, req model.CrossCopyRowsRequest) (*model.CrossCopyRowsResponse, error) {
	// Validate inputs
	if err := validation.ValidateDBName(req.SourceDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースDB名"}
	}
	if err := validation.ValidateDBName(req.DestDB); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効な宛先DB名"}
	}
	if err := validation.ValidateBranchName(req.SourceBranch); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なソースブランチ名"}
	}
	if err := s.ensureCrossCopySourceRef(req.TargetID, req.SourceDB, req.SourceBranch); err != nil {
		return nil, err
	}
	if err := s.ensureCrossCopyDestinationBranch(req.TargetID, req.DestDB, req.DestBranch); err != nil {
		return nil, err
	}
	if err := validation.ValidateIdentifier("table", req.SourceTable); err != nil {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "無効なテーブル名"}
	}
	if len(req.SourcePKs) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "source_pks は空にできません"}
	}

	// Source connection (read-only)
	srcConn, err := s.connCrossCopySourceRevision(ctx, req.TargetID, req.SourceDB, req.SourceBranch)
	if err != nil {
		return nil, err
	}
	defer srcConn.Close()

	// Dest connection (writable)
	dstConn, err := s.repo.ConnWorkBranchWrite(ctx, req.TargetID, req.DestDB, req.DestBranch)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to dest: %w", err)
	}
	defer dstConn.Close()

	// Branch lock check
	if apiErr := checkBranchLocked(ctx, dstConn, req.DestBranch); apiErr != nil {
		return nil, apiErr
	}

	// Get schemas
	srcCols, err := getSchemaColumns(ctx, srcConn, req.SourceTable)
	if err != nil {
		return nil, err
	}
	dstCols, err := getSchemaColumns(ctx, dstConn, req.SourceTable)
	if err != nil {
		return nil, err
	}

	shared, _, _ := computeSharedColumns(srcCols, dstCols)
	if len(shared) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "共有カラムがありません"}
	}

	expandColumns := expandColumnsForShared(srcCols, dstCols, shared)
	if len(expandColumns) > 0 {
		return nil, crossCopySchemaPreconditionError(expandColumns)
	}

	// Fetch source rows
	pkCols := getPKColumns(srcCols)
	if len(pkCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "ソーステーブルに主キーがありません"}
	}
	srcRows, err := fetchRowsByPKs(ctx, srcConn, req.SourceTable, pkCols, req.SourcePKs, shared)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch source rows: %w", err)
	}

	// Check dest rows for insert/update counting
	dstPKCols := getPKColumns(dstCols)
	if len(dstPKCols) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "宛先テーブルに主キーがありません"}
	}
	dstRows, err := fetchRowsByPKs(ctx, dstConn, req.SourceTable, dstPKCols, req.SourcePKs, dstPKCols)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch dest rows: %w", err)
	}

	// Get HEAD hash for optimistic locking
	var headHash string
	if err := dstConn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&headHash); err != nil {
		return nil, fmt.Errorf("failed to get HEAD: %w", err)
	}

	// START TRANSACTION
	if _, err := dstConn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// Build INSERT ... ON DUPLICATE KEY UPDATE for each row
	quotedCols := make([]string, len(shared))
	for i, c := range shared {
		quotedCols[i] = fmt.Sprintf("`%s`", c)
	}
	colList := strings.Join(quotedCols, ", ")

	updateParts := make([]string, 0, len(shared))
	for _, c := range shared {
		updateParts = append(updateParts, fmt.Sprintf("`%s` = VALUES(`%s`)", c, c))
	}
	updateClause := strings.Join(updateParts, ", ")

	inserted, updated := 0, 0
	for _, pkJSON := range req.SourcePKs {
		srcRow, ok := srcRows[pkJSON]
		if !ok {
			continue
		}

		placeholders := make([]string, len(shared))
		args := make([]interface{}, len(shared))
		for i, c := range shared {
			placeholders[i] = "?"
			args[i] = srcRow[c]
		}

		query := fmt.Sprintf("INSERT INTO `%s` (%s) VALUES (%s) ON DUPLICATE KEY UPDATE %s",
			req.SourceTable, colList, strings.Join(placeholders, ", "), updateClause)

		if _, err := dstConn.ExecContext(ctx, query, args...); err != nil {
			dstConn.ExecContext(context.Background(), "ROLLBACK")
			if apiErr := parseCopyError(err); apiErr != nil {
				return nil, apiErr
			}
			return nil, fmt.Errorf("failed to insert/update row: %w", err)
		}

		if _, exists := dstRows[pkJSON]; exists {
			updated++
		} else {
			inserted++
		}
	}

	// If no rows were copied, rollback the empty transaction and return current HEAD
	if inserted+updated == 0 {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		readiness := s.branchReadiness(ctx, req.TargetID, req.DestDB, req.DestBranch)
		if !readiness.Ready {
			logBranchQueryabilityFailure("cross_copy_rows_empty_branch_not_ready", req.TargetID, req.DestDB, req.DestBranch, readiness)
			return crossCopyRowsRetryResponse(headHash, 0, 0, "コピー先ブランチの接続反映を確認できませんでした。時間をおいて開き直してください。", "destination_branch_not_ready"), nil
		}
		return &model.CrossCopyRowsResponse{
			Hash:     headHash,
			Inserted: 0,
			Updated:  0,
			Total:    0,
			OperationResultFields: model.OperationResultFields{
				Outcome: model.OperationOutcomeCompleted,
				Message: "コピー対象の差分はありません",
				Completion: map[string]bool{
					"destination_committed":    false,
					"destination_branch_ready": true,
					"protected_refs_clean":     true,
				},
			},
		}, nil
	}

	// DOLT_VERIFY_CONSTRAINTS
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to verify constraints: %w", err)
	}
	var violationCount int
	if err := dstConn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, &model.APIError{Status: 400, Code: model.CodeCopyFKError, Msg: "制約違反が検出されました"}
	}

	// DOLT_ADD + DOLT_COMMIT
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to dolt add: %w", err)
	}

	commitMsg := fmt.Sprintf("[cross-copy] %sから%d件コピー（%s）", req.SourceDB, inserted+updated, req.SourceTable)
	if _, err := dstConn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", commitMsg); err != nil {
		dstConn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to commit: %w", err)
	}
	if _, err := dstConn.ExecContext(ctx, "COMMIT"); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	// Get new HEAD
	var newHead string
	if err := dstConn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return crossCopyRowsRetryResponse("", inserted, updated, "コピーコミットは作成された可能性がありますが、確認に失敗しました。宛先ブランチを確認して再試行してください。", "destination_commit_uncertain"), nil
	}

	readiness := s.branchReadiness(ctx, req.TargetID, req.DestDB, req.DestBranch)
	if !readiness.Ready {
		logBranchQueryabilityFailure("cross_copy_rows_branch_not_ready", req.TargetID, req.DestDB, req.DestBranch, readiness)
		return crossCopyRowsRetryResponse(newHead, inserted, updated, "コピーは完了しましたが、宛先ブランチの接続反映を確認できませんでした。時間をおいて開き直してください。", "destination_branch_not_ready"), nil
	}

	return &model.CrossCopyRowsResponse{
		Hash:     newHead,
		Inserted: inserted,
		Updated:  updated,
		Total:    inserted + updated,
		OperationResultFields: model.OperationResultFields{
			Outcome: model.OperationOutcomeCompleted,
			Message: "他DBへ行をコピーしました",
			Completion: map[string]bool{
				"destination_committed":    true,
				"destination_branch_ready": true,
				"protected_refs_clean":     true,
			},
		},
	}, nil
}
