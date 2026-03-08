package service

import (
	"context"
	"database/sql"
	"log"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
	"github.com/Makeinu1/dolt-web-ui/backend/internal/repository"
)

// safeRollback attempts a ROLLBACK and logs a warning if it fails.
// Use instead of bare conn.ExecContext(context.Background(), "ROLLBACK") //nolint:errcheck.
func safeRollback(conn *sql.Conn) {
	if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
		log.Printf("WARN: ROLLBACK failed: %v", err)
	}
}

// Service provides the business logic for the Dolt Web UI API.
type Service struct {
	repo *repository.Repository
	cfg  *config.Config
}

func New(repo *repository.Repository, cfg *config.Config) *Service {
	return &Service{repo: repo, cfg: cfg}
}
