package service

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
)

const createCommentsTableSQL = `CREATE TABLE IF NOT EXISTS _cell_comments (
    comment_id   VARCHAR(36)   NOT NULL,
    table_name   VARCHAR(255)  NOT NULL,
    pk_value     VARCHAR(1024) NOT NULL,
    column_name  VARCHAR(255)  NOT NULL,
    comment_text TEXT          NOT NULL,
    created_at   DATETIME      NOT NULL,
    PRIMARY KEY (comment_id),
    INDEX idx_cell  (table_name, pk_value, column_name),
    INDEX idx_table (table_name)
)`

func ensureCommentsTable(ctx context.Context, conn *sql.Conn) {
	conn.ExecContext(ctx, createCommentsTableSQL) //nolint:errcheck — CREATE IF NOT EXISTS is safe to ignore
}

func generateUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("failed to generate UUID: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant bits
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:], nil
}

// AddComment inserts a comment for a cell and immediately commits with a [comment] prefix.
func (s *Service) AddComment(ctx context.Context, req model.AddCommentRequest) (string, error) {
	if validation.IsProtectedBranch(req.BranchName) {
		return "", &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}
	if req.CommentText == "" {
		return "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "comment_text must not be empty"}
	}
	if len([]rune(req.CommentText)) > 5000 {
		return "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "comment_text exceeds maximum length of 5000"}
	}
	if err := validation.ValidateIdentifier("table_name", req.TableName); err != nil {
		return "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid table_name"}
	}
	if err := validation.ValidateIdentifier("column_name", req.ColumnName); err != nil {
		return "", &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "invalid column_name"}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DbName, req.BranchName)
	if err != nil {
		return "", fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	ensureCommentsTable(ctx, conn)

	id, err := generateUUID()
	if err != nil {
		return "", fmt.Errorf("failed to generate comment ID: %w", err)
	}

	if _, err := conn.ExecContext(ctx,
		"INSERT INTO _cell_comments (comment_id, table_name, pk_value, column_name, comment_text, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
		id, req.TableName, req.PkValue, req.ColumnName, req.CommentText,
	); err != nil {
		return "", fmt.Errorf("failed to insert comment: %w", err)
	}

	if _, err := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		return "", fmt.Errorf("failed to stage comment: %w", err)
	}

	msg := fmt.Sprintf("[comment] %s/%s/%s", req.TableName, req.PkValue, req.ColumnName)
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('-m', ?)", msg); err != nil {
		return "", fmt.Errorf("failed to commit comment: %w", err)
	}

	return id, nil
}

// DeleteComment deletes a comment by ID and immediately commits.
// Idempotent: if the comment does not exist, it succeeds silently.
func (s *Service) DeleteComment(ctx context.Context, req model.DeleteCommentRequest) error {
	if validation.IsProtectedBranch(req.BranchName) {
		return &model.APIError{Status: 403, Code: model.CodeForbidden, Msg: "write operations on main branch are forbidden"}
	}

	conn, err := s.repo.Conn(ctx, req.TargetID, req.DbName, req.BranchName)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	// Ignore error: table may not exist (idempotent delete)
	conn.ExecContext(ctx, "DELETE FROM _cell_comments WHERE comment_id = ?", req.CommentID) //nolint:errcheck

	if _, err := conn.ExecContext(ctx, "CALL DOLT_ADD('.')"); err != nil {
		return fmt.Errorf("failed to stage deletion: %w", err)
	}
	if _, err := conn.ExecContext(ctx, "CALL DOLT_COMMIT('--allow-empty', '-m', '[comment] deleted')"); err != nil {
		return fmt.Errorf("failed to commit deletion: %w", err)
	}

	return nil
}

// ListComments returns all comments for a specific cell (table + pk + column), ordered by created_at ASC.
func (s *Service) ListComments(ctx context.Context, targetID, dbName, branchName, table, pk, column string) ([]model.CellComment, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx,
		"SELECT comment_id, table_name, pk_value, column_name, comment_text, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') FROM _cell_comments WHERE table_name = ? AND pk_value = ? AND column_name = ? ORDER BY created_at ASC",
		table, pk, column,
	)
	if err != nil {
		// Table likely doesn't exist — return empty
		return make([]model.CellComment, 0), nil
	}
	defer rows.Close()

	result := make([]model.CellComment, 0)
	for rows.Next() {
		var c model.CellComment
		if err := rows.Scan(&c.CommentID, &c.TableName, &c.PkValue, &c.ColumnName, &c.CommentText, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// GetCommentMap returns the set of "pk_value:column_name" keys that have at least one comment for a table.
func (s *Service) GetCommentMap(ctx context.Context, targetID, dbName, branchName, table string) ([]string, error) {
	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx,
		"SELECT DISTINCT pk_value, column_name FROM _cell_comments WHERE table_name = ?", table,
	)
	if err != nil {
		// Table doesn't exist — return empty
		return make([]string, 0), nil
	}
	defer rows.Close()

	cells := make([]string, 0)
	for rows.Next() {
		var pk, col string
		if err := rows.Scan(&pk, &col); err != nil {
			return nil, fmt.Errorf("failed to scan comment map: %w", err)
		}
		cells = append(cells, pk+":"+col)
	}
	return cells, rows.Err()
}

// SearchComments searches comments by keyword (partial match) in the current branch.
func (s *Service) SearchComments(ctx context.Context, targetID, dbName, branchName, keyword string) ([]model.CellComment, error) {
	if keyword == "" {
		return nil, &model.APIError{Status: 400, Code: model.CodeInvalidArgument, Msg: "keyword must not be empty"}
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	rows, err := conn.QueryContext(ctx,
		"SELECT comment_id, table_name, pk_value, column_name, comment_text, DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s') FROM _cell_comments WHERE comment_text LIKE ? ORDER BY created_at DESC",
		"%"+keyword+"%",
	)
	if err != nil {
		return make([]model.CellComment, 0), nil
	}
	defer rows.Close()

	result := make([]model.CellComment, 0)
	for rows.Next() {
		var c model.CellComment
		if err := rows.Scan(&c.CommentID, &c.TableName, &c.PkValue, &c.ColumnName, &c.CommentText, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// ListCommentsForPks returns all comments for specific PKs in a table (for DiffCommentsPanel).
func (s *Service) ListCommentsForPks(ctx context.Context, targetID, dbName, branchName, table string, pks []string) ([]model.CellComment, error) {
	if len(pks) == 0 {
		return make([]model.CellComment, 0), nil
	}

	conn, err := s.repo.Conn(ctx, targetID, dbName, branchName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	placeholders := make([]string, len(pks))
	args := make([]interface{}, 0, len(pks)+1)
	args = append(args, table)
	for i, pk := range pks {
		placeholders[i] = "?"
		args = append(args, pk)
	}

	query := fmt.Sprintf(
		"SELECT comment_id, table_name, pk_value, column_name, comment_text, DATE_FORMAT(created_at, '%%Y-%%m-%%dT%%H:%%i:%%s') FROM _cell_comments WHERE table_name = ? AND pk_value IN (%s) ORDER BY pk_value, column_name, created_at ASC",
		strings.Join(placeholders, ", "),
	)

	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return make([]model.CellComment, 0), nil
	}
	defer rows.Close()

	result := make([]model.CellComment, 0)
	for rows.Next() {
		var c model.CellComment
		if err := rows.Scan(&c.CommentID, &c.TableName, &c.PkValue, &c.ColumnName, &c.CommentText, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan comment: %w", err)
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
