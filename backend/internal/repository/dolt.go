package repository

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
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
		// MaxIdleConns=0: Dolt branch contexts persist on pooled connections.
		// A connection last used for a deleted branch will fail USE on reuse.
		// Setting MaxIdleConns=0 closes connections on release, avoiding stale contexts.
		db.SetMaxIdleConns(0)
		r.pools[target.ID] = db
	}

	return r, nil
}

// Conn acquires a connection for a specific target, database, and branch.
// Uses USE + DOLT_CHECKOUT to handle branch names containing slashes (e.g. wi/work/01).
// 1 request = 1 connection = 1 branch session.
func (r *Repository) Conn(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
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

	// USE `db` to select the database, then DOLT_CHECKOUT to switch branch.
	// Backtick-quoting the full "db/branch" path breaks when branch names
	// contain slashes (e.g. wi/work/01), so we split into two steps.
	useStmt := fmt.Sprintf("USE `%s`", dbName)
	if _, err := conn.ExecContext(ctx, useStmt); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to set db context %s: %w", dbName, err)
	}
	if branchName != "main" {
		if _, err := conn.ExecContext(ctx, "CALL DOLT_CHECKOUT(?)", branchName); err != nil {
			conn.Close()
			return nil, fmt.Errorf("failed to checkout branch %s: %w", branchName, err)
		}
	}

	return conn, nil
}

// ConnDB acquires a connection for a specific target and database on main branch.
// Used for operations that don't target a specific work branch.
func (r *Repository) ConnDB(ctx context.Context, targetID, dbName string) (*sql.Conn, error) {
	return r.Conn(ctx, targetID, dbName, "main")
}

func (r *Repository) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, db := range r.pools {
		db.Close()
	}
}
