package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// normalizePkJSON returns a new map whose keys are sorted alphabetically,
// producing a canonical JSON string matching the frontend rowPkId.
func normalizePkJSON(pk map[string]interface{}) map[string]interface{} {
	if len(pk) <= 1 {
		return pk
	}
	keys := make([]string, 0, len(pk))
	for k := range pk {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(map[string]interface{}, len(pk))
	for _, k := range keys {
		out[k] = pk[k]
	}
	return out
}

// checkBranchLocked returns a BRANCH_LOCKED APIError if the branch has a pending
// approval request (req/ tag). Called before commit/revert/sync on work branches.
func checkBranchLocked(ctx context.Context, conn *sql.Conn, branchName string) *model.APIError {
	// Only work branches follow the wi/...  naming; others are skipped.
	if !strings.HasPrefix(branchName, "wi/") {
		return nil
	}
	reqTag := "req/" + strings.TrimPrefix(branchName, "wi/")
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?", reqTag).Scan(&count); err != nil {
		return nil // DB error: fail open (don't block on lock check failure)
	}
	if count > 0 {
		return &model.APIError{
			Status:  423,
			Code:    model.CodeBranchLocked,
			Msg:     "承認申請中のブランチは編集できません。却下されるとロックが解除されます。",
			Details: map[string]string{"request_tag": reqTag},
		}
	}
	return nil
}

// Commit applies draft operations to the work branch.
// Per v6f spec section 4.1: expected_head check, START TRANSACTION, apply ops,
// DOLT_VERIFY_CONSTRAINTS, DOLT_ADD, DOLT_COMMIT.
func (s *Service) Commit(ctx context.Context, req model.CommitRequest) (*model.CommitResponse, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}
	if len(req.Ops) == 0 {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "ops must not be empty"}
	}

	conn, err := s.repo.ConnWrite(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Step -1: Branch lock check (Submit後はロック)
	if apiErr := checkBranchLocked(ctx, conn, req.BranchName); apiErr != nil {
		return nil, apiErr
	}

	// Step 1a: Pre-ensure memo tables (DDL cannot run inside a transaction)
	for _, op := range req.Ops {
		if strings.HasPrefix(op.Table, "_memo_") {
			if err := ensureMemoTable(ctx, conn, op.Table); err != nil {
				return nil, err
			}
		}
	}

	// Step 1b: START TRANSACTION
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// Step 0 (inside TX): expected_head check — must be inside transaction to eliminate race window.
	// BUG-B fix: moved from pre-TX position.
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

	// Step 2: Apply ops
	for i, op := range req.Ops {
		if err := validation.ValidateIdentifier("table", op.Table); err != nil {
			conn.ExecContext(context.Background(), "ROLLBACK")
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("ops[%d]: invalid table name", i)}
		}

		switch op.Type {
		case "insert":
			if err := applyInsert(ctx, conn, op); err != nil {
				conn.ExecContext(context.Background(), "ROLLBACK")
				return nil, err
			}
		case "update":
			if err := applyUpdate(ctx, conn, op); err != nil {
				conn.ExecContext(context.Background(), "ROLLBACK")
				return nil, err
			}
		case "delete":
			if err := applyDelete(ctx, conn, op); err != nil {
				conn.ExecContext(context.Background(), "ROLLBACK")
				return nil, err
			}
		default:
			conn.ExecContext(context.Background(), "ROLLBACK")
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("ops[%d]: unknown operation type %q", i, op.Type)}
		}
	}

	// Step 3: DOLT_VERIFY_CONSTRAINTS
	if _, err := conn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to verify constraints: %w", err)
	}
	var violationCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "constraint violations detected"}
	}

	// Step 4: DOLT_ADD + DOLT_COMMIT
	if _, err := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to add: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', ?)", req.CommitMessage); err != nil {
		conn.ExecContext(context.Background(), "ROLLBACK")
		return nil, fmt.Errorf("failed to commit: %w", err)
	}

	// Step 5: Get new HEAD
	var newHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&newHead); err != nil {
		return nil, fmt.Errorf("failed to get new HEAD: %w", err)
	}

	return &model.CommitResponse{Hash: newHead}, nil
}

func applyInsert(ctx context.Context, conn *sql.Conn, op model.CommitOp) error {
	cols := make([]string, 0, len(op.Values))
	placeholders := make([]string, 0, len(op.Values))
	args := make([]interface{}, 0, len(op.Values))
	for col, val := range op.Values {
		if err := validation.ValidateIdentifier("column", col); err != nil {
			return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("invalid column name: %s", col)}
		}
		cols = append(cols, fmt.Sprintf("`%s`", col))
		placeholders = append(placeholders, "?")
		args = append(args, val)
	}

	query := fmt.Sprintf("INSERT INTO `%s` (%s) VALUES (%s)",
		op.Table, strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	if _, err := conn.ExecContext(ctx, query, args...); err != nil {
		// Surface duplicate PK as PK_COLLISION (HTTP 400) rather than opaque DB error
		errStr := err.Error()
		if strings.Contains(errStr, "Duplicate entry") || strings.Contains(errStr, "PRIMARY") {
			return &model.APIError{Status: 400, Code: model.CodePKCollision,
				Msg: fmt.Sprintf("PK already exists in %s", op.Table)}
		}
		return fmt.Errorf("failed to insert into %s: %w", op.Table, err)
	}
	return nil
}

func applyUpdate(ctx context.Context, conn *sql.Conn, op model.CommitOp) error {
	if len(op.PK) < 1 {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "pk must not be empty for update"}
	}

	setParts := make([]string, 0, len(op.Values))
	setArgs := make([]interface{}, 0, len(op.Values))
	for col, val := range op.Values {
		if err := validation.ValidateIdentifier("column", col); err != nil {
			return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("invalid column name: %s", col)}
		}
		setParts = append(setParts, fmt.Sprintf("`%s` = ?", col))
		setArgs = append(setArgs, val)
	}

	// Build WHERE from all PK columns (composite support)
	whereParts := make([]string, 0, len(op.PK))
	whereArgs := make([]interface{}, 0, len(op.PK))
	for k, v := range op.PK {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name: " + k}
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	query := fmt.Sprintf("UPDATE `%s` SET %s WHERE %s",
		op.Table, strings.Join(setParts, ", "), strings.Join(whereParts, " AND "))
	args := make([]interface{}, 0, len(setArgs)+len(whereArgs))
	args = append(args, setArgs...)
	args = append(args, whereArgs...)

	result, err := conn.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update %s: %w", op.Table, err)
	}

	// Per v6f spec: affected rows 0 → 404
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: fmt.Sprintf("row not found in %s", op.Table)}
	}

	return nil
}

func applyDelete(ctx context.Context, conn *sql.Conn, op model.CommitOp) error {
	if len(op.PK) < 1 {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "pk must not be empty for delete"}
	}

	// Build WHERE from all PK columns (composite support)
	whereParts := make([]string, 0, len(op.PK))
	whereArgs := make([]interface{}, 0, len(op.PK))
	for k, v := range op.PK {
		if err := validation.ValidateIdentifier("pk column", k); err != nil {
			return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name: " + k}
		}
		whereParts = append(whereParts, fmt.Sprintf("`%s` = ?", k))
		whereArgs = append(whereArgs, v)
	}

	query := fmt.Sprintf("DELETE FROM `%s` WHERE %s", op.Table, strings.Join(whereParts, " AND "))
	result, err := conn.ExecContext(ctx, query, whereArgs...)
	if err != nil {
		return fmt.Errorf("failed to delete from %s: %w", op.Table, err)
	}

	affected, _ := result.RowsAffected()
	if affected == 0 {
		return &model.APIError{Status: 404, Code: model.CodeNotFound, Msg: fmt.Sprintf("row not found in %s", op.Table)}
	}
	// Cascade-delete memos for the deleted row.
	if pkJSON, jsonErr := json.Marshal(normalizePkJSON(op.PK)); jsonErr == nil {
		memoTbl := memoTableName(op.Table)
		conn.ExecContext(ctx, //nolint:errcheck
			fmt.Sprintf("DELETE FROM `%s` WHERE pk_value = ?", memoTbl),
			string(pkJSON))
	}

	return nil
}
