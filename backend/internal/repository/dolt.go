package repository

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"

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
		db.SetMaxOpenConns(cfg.Server.Pool.MaxOpen)
		db.SetMaxIdleConns(cfg.Server.Pool.MaxIdle)
		db.SetConnMaxLifetime(time.Duration(cfg.Server.Pool.ConnLifetimeSec) * time.Second)
		r.pools[target.ID] = db
	}

	return r, nil
}

func (r *Repository) poolForTarget(targetID string) (*sql.DB, error) {
	r.mu.RLock()
	pool, ok := r.pools[targetID]
	r.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("target %q not found", targetID)
	}
	return pool, nil
}

func (r *Repository) resetDatabaseContext(ctx context.Context, conn *sql.Conn, dbName string) error {
	resetStmt := fmt.Sprintf("USE `%s`", dbName)
	if _, err := conn.ExecContext(ctx, resetStmt); err != nil {
		return fmt.Errorf("failed to reset db context %s: %w", dbName, err)
	}
	return nil
}

func (r *Repository) checkoutSession(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if err := validation.ValidateDBName(dbName); err != nil {
		return nil, fmt.Errorf("invalid db name: %w", err)
	}
	if err := validation.ValidateBranchName(branchName); err != nil {
		return nil, fmt.Errorf("invalid branch name: %w", err)
	}

	pool, err := r.poolForTarget(targetID)
	if err != nil {
		return nil, err
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

// ConnRevision acquires a read-only revision connection for a specific ref.
// We use Dolt's revision specifier in the USE statement: USE `db/ref`.
func (r *Repository) ConnRevision(ctx context.Context, targetID, dbName, refName string) (*sql.Conn, error) {
	if err := validation.ValidateDBName(dbName); err != nil {
		return nil, fmt.Errorf("invalid db name: %w", err)
	}
	if err := validation.ValidateRevisionRef(refName); err != nil {
		return nil, fmt.Errorf("invalid ref: %w", err)
	}

	pool, err := r.poolForTarget(targetID)
	if err != nil {
		return nil, err
	}
	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get connection: %w", err)
	}

	// Reset any DOLT_CHECKOUT state left by a previous write session on this pooled connection.
	if err := r.resetDatabaseContext(ctx, conn, dbName); err != nil {
		conn.Close()
		return nil, err
	}

	revisionDb := fmt.Sprintf("%s/%s", dbName, refName)
	useStmt := fmt.Sprintf("USE `%s`", revisionDb)
	if _, err := conn.ExecContext(ctx, useStmt); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to set db context %s: %w", revisionDb, err)
	}

	return conn, nil
}

// ConnWorkBranchWrite acquires a writable session for wi/* work branches only.
func (r *Repository) ConnWorkBranchWrite(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if !validation.IsWorkBranchName(branchName) {
		return nil, fmt.Errorf("work branch write session requires wi/* branch: %s", branchName)
	}
	return r.checkoutSession(ctx, targetID, dbName, branchName)
}

// ConnProtectedMaintenance acquires a writable session on a protected branch.
func (r *Repository) ConnProtectedMaintenance(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	if !validation.IsProtectedBranch(branchName) {
		return nil, fmt.Errorf("protected maintenance session requires protected branch: %s", branchName)
	}
	return r.checkoutSession(ctx, targetID, dbName, branchName)
}

// Conn is the legacy alias for a read-only revision session.
func (r *Repository) Conn(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	return r.ConnRevision(ctx, targetID, dbName, branchName)
}

func (r *Repository) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, db := range r.pools {
		db.Close()
	}
}
