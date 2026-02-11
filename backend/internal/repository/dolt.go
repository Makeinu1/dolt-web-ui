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
		db.SetMaxIdleConns(5)
		r.pools[target.ID] = db
	}

	return r, nil
}

// Conn acquires a connection for a specific target, database, and branch.
// Per v6f spec: 1 request = 1 connection = 1 branch session.
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

	// Use the specified database
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE `%s`", dbName)); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to use database %q: %w", dbName, err)
	}

	// Checkout the branch
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("CALL DOLT_CHECKOUT('%s')", branchName)); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to checkout branch %q: %w", branchName, err)
	}

	return conn, nil
}

// ConnDB acquires a connection for a specific target and database (without branch checkout).
func (r *Repository) ConnDB(ctx context.Context, targetID, dbName string) (*sql.Conn, error) {
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

	if _, err := conn.ExecContext(ctx, fmt.Sprintf("USE `%s`", dbName)); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to use database %q: %w", dbName, err)
	}

	return conn, nil
}

func (r *Repository) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, db := range r.pools {
		db.Close()
	}
}
