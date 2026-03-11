package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

type crossCopyTestRepo struct {
	t                *testing.T
	revisionHandler  func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error)
	workHandler      func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error)
	protectedHandler func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error)
	dbs              []*sql.DB
	calls            []repoCall
	protectedCalls   int
}

func newCrossCopyTestRepo(
	t *testing.T,
	revisionHandler func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error),
	workHandler func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error),
) *crossCopyTestRepo {
	t.Helper()
	repo := &crossCopyTestRepo{
		t:               t,
		revisionHandler: revisionHandler,
		workHandler:     workHandler,
	}
	t.Cleanup(func() {
		for _, db := range repo.dbs {
			_ = db.Close()
		}
	})
	return repo
}

func (r *crossCopyTestRepo) openConn(ctx context.Context, handler testQueryHandler) (*sql.Conn, error) {
	driverName := fmt.Sprintf("crosscopy-test-%d", testDriverID.Add(1))
	sql.Register(driverName, &testDriver{handler: handler})
	db, err := sql.Open(driverName, "")
	if err != nil {
		return nil, err
	}
	r.dbs = append(r.dbs, db)
	return db.Conn(ctx)
}

func (r *crossCopyTestRepo) Conn(ctx context.Context, targetID, dbName, ref string) (*sql.Conn, error) {
	return r.ConnRevision(ctx, targetID, dbName, ref)
}

func (r *crossCopyTestRepo) ConnRevision(ctx context.Context, targetID, dbName, ref string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnRevision", ref: ref})
	return r.openConn(ctx, func(query string, args []driver.NamedValue) (testQueryResult, error) {
		return r.revisionHandler(dbName, ref, query, args)
	})
}

func (r *crossCopyTestRepo) ConnWorkBranchWrite(ctx context.Context, targetID, dbName, branch string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnWorkBranchWrite", ref: branch})
	return r.openConn(ctx, func(query string, args []driver.NamedValue) (testQueryResult, error) {
		return r.workHandler(dbName, branch, query, args)
	})
}

func (r *crossCopyTestRepo) ConnProtectedMaintenance(ctx context.Context, targetID, dbName, branch string) (*sql.Conn, error) {
	r.protectedCalls++
	r.calls = append(r.calls, repoCall{method: "ConnProtectedMaintenance", ref: branch})
	if r.protectedHandler == nil {
		return nil, fmt.Errorf("unexpected ConnProtectedMaintenance(%s)", branch)
	}
	return r.openConn(ctx, func(query string, args []driver.NamedValue) (testQueryResult, error) {
		return r.protectedHandler(dbName, branch, query, args)
	})
}

func showColumnsResult(columnType string) testQueryResult {
	return testQueryResult{
		columns: []string{"Field", "Type", "Null", "Key", "Default", "Extra"},
		rows: [][]driver.Value{
			{"id", "int", "NO", "PRI", nil, ""},
			{"name", columnType, "YES", "", nil, ""},
		},
	}
}

func TestCrossCopyRows_SchemaMismatchStopsBeforeProtectedMaintenance(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			if query == "SHOW COLUMNS FROM `users`" && refName == "audit" {
				return showColumnsResult("varchar(255)"), nil
			}
			return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
				return testQueryResult{
					columns: []string{"count(*)"},
					rows:    [][]driver.Value{{int64(0)}},
				}, nil
			case "SHOW COLUMNS FROM `users`":
				return showColumnsResult("varchar(50)"), nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
			}
		},
	)
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.CrossCopyRows(context.Background(), model.CrossCopyRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		SourcePKs:    []string{`{"id":1}`},
		DestDB:       "test_db",
		DestBranch:   "wi/dest-users",
	})

	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodePreconditionFailed {
		t.Fatalf("expected %s, got %s", model.CodePreconditionFailed, apiErr.Code)
	}
	if repo.protectedCalls != 0 {
		t.Fatalf("expected no protected maintenance calls, got %d", repo.protectedCalls)
	}
}

func TestCrossCopyTable_SchemaMismatchStopsBeforeProtectedMaintenance(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			if query == "SHOW COLUMNS FROM `users`" && refName == "audit" {
				return showColumnsResult("varchar(255)"), nil
			}
			if query == "SHOW COLUMNS FROM `users`" && refName == "main" {
				return showColumnsResult("varchar(50)"), nil
			}
			return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})

	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodePreconditionFailed {
		t.Fatalf("expected %s, got %s", model.CodePreconditionFailed, apiErr.Code)
	}
	if repo.protectedCalls != 0 {
		t.Fatalf("expected no protected maintenance calls, got %d", repo.protectedCalls)
	}
}

func TestCrossCopyTable_QueryabilityFailureCleanupSuccessIsFailed(t *testing.T) {
	var cleanupDeletes int
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SHOW COLUMNS FROM `users`":
				return showColumnsResult("varchar(255)"), nil
			case "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
				return testQueryResult{
					columns: []string{"count(*)"},
					rows:    [][]driver.Value{{int64(0)}},
				}, nil
			case "CALL DOLT_BRANCH(?)":
				return testQueryResult{}, nil
			case "CALL DOLT_BRANCH('-D', ?)":
				cleanupDeletes++
				return testQueryResult{}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: false, Attempts: 3}
	}

	resp, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})
	if err != nil {
		t.Fatalf("expected terminal response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeFailed {
		t.Fatalf("expected outcome=failed, got %s", resp.Outcome)
	}
	if resp.BranchName != "" {
		t.Fatalf("expected cleaned branch_name to be empty, got %s", resp.BranchName)
	}
	if cleanupDeletes != 1 {
		t.Fatalf("expected one cleanup delete, got %d", cleanupDeletes)
	}
	if repo.protectedCalls != 0 {
		t.Fatalf("expected no protected maintenance calls, got %d", repo.protectedCalls)
	}
}

func TestCrossCopyTable_QueryabilityFailureCleanupFailureIsRetryRequired(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SHOW COLUMNS FROM `users`":
				return showColumnsResult("varchar(255)"), nil
			case "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
				return testQueryResult{
					columns: []string{"count(*)"},
					rows:    [][]driver.Value{{int64(0)}},
				}, nil
			case "CALL DOLT_BRANCH(?)":
				return testQueryResult{}, nil
			case "CALL DOLT_BRANCH('-D', ?)":
				return testQueryResult{}, errors.New("cleanup failed")
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: false, Attempts: 3}
	}

	resp, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})
	if err != nil {
		t.Fatalf("expected terminal response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeRetryRequired {
		t.Fatalf("expected outcome=retry_required, got %s", resp.Outcome)
	}
	if resp.BranchName != importWorkBranchName("test_db", "users") {
		t.Fatalf("expected surviving branch name, got %s", resp.BranchName)
	}
	if repo.protectedCalls != 0 {
		t.Fatalf("expected no protected maintenance calls, got %d", repo.protectedCalls)
	}
}

// revisionHandlerForCopyTable builds a revision handler that covers the full
// CrossCopyTable flow up to the INSERT phase.
// cleanupAction controls what happens when DOLT_BRANCH('-D', ?) is called.
func revisionHandlerForCopyTable(
	t *testing.T,
	cleanupDeletes *int,
	cleanupAction func() error,
) func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
	t.Helper()
	return func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.HasPrefix(query, "SHOW COLUMNS FROM"):
			return showColumnsResult("varchar(255)"), nil
		case query == "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
			return testQueryResult{
				columns: []string{"count(*)"},
				rows:    [][]driver.Value{{int64(0)}},
			}, nil
		case query == "CALL DOLT_BRANCH(?)":
			return testQueryResult{}, nil
		case query == "CALL DOLT_BRANCH('-D', ?)":
			if cleanupDeletes != nil {
				*cleanupDeletes++
			}
			return testQueryResult{}, cleanupAction()
		default:
			return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
		}
	}
}

// workHandlerDataTooLong builds a work handler that fails on INSERT with a "Data too long" MySQL error.
func workHandlerDataTooLong(t *testing.T) func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
	t.Helper()
	return func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case query == "START TRANSACTION":
			return testQueryResult{}, nil
		case strings.HasPrefix(query, "DELETE FROM"):
			return testQueryResult{}, nil
		case strings.HasPrefix(query, "INSERT INTO"):
			return testQueryResult{}, errors.New("Data too long for column 'name' at row 1")
		case query == "ROLLBACK":
			return testQueryResult{}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		}
	}
}

// workHandlerFKViolation builds a work handler that reports 1 constraint violation after INSERT.
func workHandlerFKViolation(t *testing.T) func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
	t.Helper()
	return func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case query == "START TRANSACTION":
			return testQueryResult{}, nil
		case strings.HasPrefix(query, "DELETE FROM"):
			return testQueryResult{}, nil
		case strings.HasPrefix(query, "INSERT INTO"):
			return testQueryResult{}, nil
		case query == "CALL DOLT_VERIFY_CONSTRAINTS()":
			return testQueryResult{}, nil
		case query == "SELECT COUNT(*) FROM dolt_constraint_violations":
			return testQueryResult{
				columns: []string{"count(*)"},
				rows:    [][]driver.Value{{int64(1)}},
			}, nil
		case query == "ROLLBACK":
			return testQueryResult{}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		}
	}
}

func TestCrossCopyTable_DataTooLong_CleanupCalledOnce_ReturnsDataError(t *testing.T) {
	var cleanupDeletes int
	repo := newCrossCopyTestRepo(t,
		revisionHandlerForCopyTable(t, &cleanupDeletes, func() error { return nil }),
		workHandlerDataTooLong(t),
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true}
	}

	_, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})

	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeCopyDataError {
		t.Fatalf("expected %s, got %s", model.CodeCopyDataError, apiErr.Code)
	}
	if cleanupDeletes != 1 {
		t.Fatalf("expected 1 cleanup delete, got %d", cleanupDeletes)
	}
}

func TestCrossCopyTable_DataTooLong_CleanupFailure_IsRetryRequired(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		revisionHandlerForCopyTable(t, nil, func() error { return errors.New("cleanup failed") }),
		workHandlerDataTooLong(t),
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true}
	}

	resp, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})
	if err != nil {
		t.Fatalf("expected terminal response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeRetryRequired {
		t.Fatalf("expected outcome=retry_required, got %s", resp.Outcome)
	}
	if resp.RetryReason != "destination_branch_cleanup_failed" {
		t.Fatalf("expected retryReason=destination_branch_cleanup_failed, got %s", resp.RetryReason)
	}
}

func TestCrossCopyTable_FKViolation_CleanupCalledOnce_ReturnsFKError(t *testing.T) {
	var cleanupDeletes int
	repo := newCrossCopyTestRepo(t,
		revisionHandlerForCopyTable(t, &cleanupDeletes, func() error { return nil }),
		workHandlerFKViolation(t),
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true}
	}

	_, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})

	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeCopyFKError {
		t.Fatalf("expected %s, got %s", model.CodeCopyFKError, apiErr.Code)
	}
	if cleanupDeletes != 1 {
		t.Fatalf("expected 1 cleanup delete, got %d", cleanupDeletes)
	}
}

func TestCrossCopyTable_FKViolation_CleanupFailure_IsRetryRequired(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		revisionHandlerForCopyTable(t, nil, func() error { return errors.New("cleanup failed") }),
		workHandlerFKViolation(t),
	)
	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true}
	}

	resp, err := svc.CrossCopyTable(context.Background(), model.CrossCopyTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})
	if err != nil {
		t.Fatalf("expected terminal response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeRetryRequired {
		t.Fatalf("expected outcome=retry_required, got %s", resp.Outcome)
	}
	if resp.RetryReason != "destination_branch_cleanup_failed" {
		t.Fatalf("expected retryReason=destination_branch_cleanup_failed, got %s", resp.RetryReason)
	}
}
