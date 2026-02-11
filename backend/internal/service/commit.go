package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

// Commit applies draft operations to the work branch.
// Per v6f spec section 4.1: expected_head check, START TRANSACTION, apply ops,
// DOLT_VERIFY_CONSTRAINTS, DOLT_ADD, DOLT_COMMIT.
func (s *Service) Commit(ctx context.Context, req model.CommitRequest) (*model.CommitResponse, error) {
	if validation.IsMainBranch(req.BranchName) {
		return nil, &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DBName, req.BranchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Step 0: expected_head check
	var currentHead string
	if err := conn.QueryRowContext(ctx, "SELECT DOLT_HASHOF('HEAD')").Scan(&currentHead); err != nil {
		return nil, fmt.Errorf("failed to get HEAD: %w", err)
	}
	if currentHead != req.ExpectedHead {
		return nil, &model.APIError{
			Status:  409,
			Code:    model.CodeStaleHead,
			Msg:     "expected_head mismatch",
			Details: map[string]string{"expected_head": req.ExpectedHead, "actual_head": currentHead},
		}
	}

	// Step 1: START TRANSACTION
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}

	// Step 2: Apply ops
	for i, op := range req.Ops {
		if err := validation.ValidateIdentifier("table", op.Table); err != nil {
			conn.ExecContext(ctx, "ROLLBACK")
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("ops[%d]: invalid table name", i)}
		}

		switch op.Type {
		case "insert":
			if err := applyInsert(ctx, conn, op); err != nil {
				conn.ExecContext(ctx, "ROLLBACK")
				return nil, err
			}
		case "update":
			if err := applyUpdate(ctx, conn, op); err != nil {
				conn.ExecContext(ctx, "ROLLBACK")
				return nil, err
			}
		default:
			conn.ExecContext(ctx, "ROLLBACK")
			return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: fmt.Sprintf("ops[%d]: unknown operation type %q", i, op.Type)}
		}
	}

	// Step 3: DOLT_VERIFY_CONSTRAINTS
	if _, err := conn.ExecContext(ctx, "CALL DOLT_VERIFY_CONSTRAINTS()"); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to verify constraints: %w", err)
	}
	var violationCount int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM dolt_constraint_violations").Scan(&violationCount); err == nil && violationCount > 0 {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "constraint violations detected"}
	}

	// Step 4: DOLT_ADD + DOLT_COMMIT
	if _, err := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
		return nil, fmt.Errorf("failed to add: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('-m', ?)", req.CommitMessage); err != nil {
		conn.ExecContext(ctx, "ROLLBACK")
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
		return fmt.Errorf("failed to insert into %s: %w", op.Table, err)
	}
	return nil
}

func applyUpdate(ctx context.Context, conn *sql.Conn, op model.CommitOp) error {
	if len(op.PK) != 1 {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "single primary key required for update"}
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

	var pkCol string
	var pkVal interface{}
	for k, v := range op.PK {
		pkCol = k
		pkVal = v
	}
	if err := validation.ValidateIdentifier("pk column", pkCol); err != nil {
		return &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid pk column name"}
	}

	query := fmt.Sprintf("UPDATE `%s` SET %s WHERE `%s` = ?",
		op.Table, strings.Join(setParts, ", "), pkCol)
	args := append(setArgs, pkVal)

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
