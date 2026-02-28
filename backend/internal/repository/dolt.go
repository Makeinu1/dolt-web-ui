package repository

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/validation"
	_ "github.com/go-sql-driver/mysql"
)

// Repository manages connections to Dolt SQL servers.
type Repository struct {
	cfg   *config.Config
	pools map[string]*sql.DB // key: target_id
	mu    sync.RWMutex
}

func New(cfg *config.Config) (*Repository, error) {
	r := &Repository{
		cfg:   cfg,
		pools: make(map[string]*sql.DB),
	}

	for _, target := range cfg.Targets {
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/",
			target.User, target.Password, target.Host, target.Port)
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return nil, fmt.Errorf("failed to connect to target %q: %w", target.ID, err)
		}
		db.SetMaxOpenConns(20)
		// Re-enable connection pooling to fix performance bottleneck
		// Previously MaxIdleConns=0 was used to avoid Stale Context,
		// but we now use stateless revision specifiers (`db/branch`).
		db.SetMaxIdleConns(10)
		db.SetConnMaxLifetime(0) // Connections can be reused indefinitely
		r.pools[target.ID] = db
	}

	return r, nil
}

// Conn acquires a connection for a specific target, database, and branch.
// We use Dolt's revision specifier in the USE statement: USE `db/branch`
// This makes the connection stateless and safe for pooling.
func (r *Repository) Conn(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := validation.ValidateDBName(dbName); err != nil {
		return nil, fmt.Errorf("invalid db name: %w", err)
	}
	if err := validation.ValidateBranchName(branchName); err != nil {
		return nil, fmt.Errorf("invalid branch name: %w", err)
	}

	r.mu.RLock()
	pool, ok := r.pools[targetID]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("target %q not found", targetID)
	}

	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}

	// USE `dbName/branchName` is the standard Dolt way to specify a revision database.
	// This avoids stateful CALL DOLT_CHECKOUT(?) which pollutes the connection pool.
	revisionDb := fmt.Sprintf("%s/%s", dbName, branchName)
	useStmt := fmt.Sprintf("USE `%s`", revisionDb)

	if _, err := conn.ExecContext(ctx, useStmt); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to set db context %s: %w", revisionDb, err)
	}

	return conn, nil
}

// ConnWrite acquires a writable connection for a specific target, database, and branch.
// Uses USE + DOLT_CHECKOUT to ensure the session is on the correct branch.
// Required for write operations: INSERT, UPDATE, DELETE, DOLT_COMMIT, DOLT_ADD, etc.
// Read-only queries should use Conn() which uses stateless revision specifiers.
func (r *Repository) ConnWrite(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := validation.ValidateDBName(dbName); err != nil {
		return nil, fmt.Errorf("invalid db name: %w", err)
	}
	if err := validation.ValidateBranchName(branchName); err != nil {
		return nil, fmt.Errorf("invalid branch name: %w", err)
	}

	r.mu.RLock()
	pool, ok := r.pools[targetID]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("target %q not found", targetID)
	}

	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}

	useStmt := fmt.Sprintf("USE `%s`", dbName)
	if _, err := conn.ExecContext(ctx, useStmt); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to set db context %s: %w", dbName, err)
	}
	// Always checkout the requested branch to avoid stale branch state from pooled connections.
	if _, err := conn.ExecContext(ctx, "CALL DOLT_CHECKOUT(?)", branchName); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to checkout branch %s: %w", branchName, err)
	}

	return conn, nil
}

// ConnDB acquires a connection for a specific target and database on main branch.
// Used for operations that don't target a specific work branch.
func (r *Repository) ConnDB(ctx context.Context, targetID, dbName string) (*sql.Conn, error) {
	return r.ConnWrite(ctx, targetID, dbName, "main")
}

func (r *Repository) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, db := range r.pools {
		db.Close()
	}
}
