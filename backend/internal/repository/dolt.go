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
// Per v6f spec section 5.1:
//   - Uses USE <db_name>/<branch_name> (DOLT_CHECKOUT is forbidden)
//   - 1 request = 1 connection = 1 branch session
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

	// Per v6f spec 5.1: USE <db_name>/<branch_name> to fix current location.
	// DOLT_CHECKOUT() is forbidden.
	useStmt := fmt.Sprintf("USE `%s/%s`", dbName, branchName)
	if _, err := conn.ExecContext(ctx, useStmt); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to set db/branch context %s/%s: %w", dbName, branchName, err)
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
