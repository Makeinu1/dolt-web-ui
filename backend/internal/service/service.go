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

type sessionRepository interface {
	Conn(context.Context, string, string, string) (*sql.Conn, error)
	ConnRevision(context.Context, string, string, string) (*sql.Conn, error)
	ConnWorkBranchWrite(context.Context, string, string, string) (*sql.Conn, error)
	ConnProtectedMaintenance(context.Context, string, string, string) (*sql.Conn, error)
	PurgeIdleConns(targetID string)
}

// approveDeleteRequestTagFn is the hook type for deleting a req/* tag during approval.
// Production: opens its own protected-maintenance connection and retries.
// Tests: can be overridden to inject failure without SQL.
type approveDeleteRequestTagFn func(ctx context.Context, targetID, dbName, requestID string) error

// approveCreateSecondaryIndexFn is the hook type for creating a merged/* archive tag.
// Production: uses the provided merge connection.
// Tests: can be overridden to simulate secondary-index failure.
type approveCreateSecondaryIndexFn func(ctx context.Context, conn *sql.Conn, workItem, message string) (string, error)

// approveAdvanceWorkBranchFn is the hook type for advancing the work branch after approval.
// Production: opens its own connection and calls advanceWorkBranch.
// Tests: can be overridden to inject failure without SQL.
type approveAdvanceWorkBranchFn func(ctx context.Context, targetID, dbName, workBranch string, warnings *[]string) bool

// Service provides the business logic for the Dolt Web UI API.
type Service struct {
	repo                 sessionRepository
	cfg                  *config.Config
	branchReadinessProbe branchReadinessProbe

	// Approve postcondition hooks — set to real implementations by default.
	// Override in tests to inject failures without SQL mocking.
	approveCreateSecondaryIndexHook approveCreateSecondaryIndexFn
	approveDeleteRequestTagHook     approveDeleteRequestTagFn
	approveAdvanceWorkBranchHook    approveAdvanceWorkBranchFn
}

func New(repo *repository.Repository, cfg *config.Config) *Service {
	return newWithDeps(repo, cfg)
}

func newWithDeps(repo sessionRepository, cfg *config.Config) *Service {
	svc := &Service{
		repo: repo,
		cfg:  cfg,
	}
	svc.branchReadinessProbe = svc.probeBranchReadiness
	svc.approveCreateSecondaryIndexHook = svc.createArchiveTag
	svc.approveDeleteRequestTagHook = svc.defaultDeleteRequestTag
	svc.approveAdvanceWorkBranchHook = svc.defaultAdvanceWorkBranchForApprove
	return svc
}
