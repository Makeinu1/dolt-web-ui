package service

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func syncSuccessResult(hash string) testQueryResult {
	return testQueryResult{
		columns: []string{"hash", "fast_forward", "conflicts", "message"},
		rows:    [][]driver.Value{{hash, int64(1), int64(0), "merged"}},
	}
}

func TestCrossCopyAdminPrepareRows_PreparesMainAndSyncsBranch(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch {
			case query == "SHOW COLUMNS FROM `users`" && refName == "audit":
				return showColumnsResult("varchar(255)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "main":
				return showColumnsResult("varchar(50)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "wi/dest-users":
				return showColumnsResult("varchar(255)"), nil
			case query == "SELECT DOLT_HASHOF('HEAD')" && refName == "wi/dest-users":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"dest-head-2"}}}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
				return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(0)}}}, nil
			case "SELECT DOLT_HASHOF('HEAD')":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"dest-head-2"}}}, nil
			case "SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('wi/dest-users', 'main')":
				return testQueryResult{columns: []string{"table", "data_conflicts", "schema_conflicts"}, rows: nil}, nil
			case "START TRANSACTION":
				return testQueryResult{}, nil
			case "CALL DOLT_MERGE('main')":
				return syncSuccessResult("merge-hash"), nil
			case "COMMIT":
				return testQueryResult{}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
			}
		},
	)
	repo.protectedHandler = func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch query {
		case "ALTER TABLE `users` MODIFY COLUMN `name` varchar(255) NULL":
			return testQueryResult{}, nil
		case "CALL DOLT_ADD('.')":
			return testQueryResult{}, nil
		case "CALL DOLT_COMMIT('--allow-empty', '-m', ?)":
			return testQueryResult{}, nil
		case "SELECT DOLT_HASHOF('HEAD')":
			return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"main-head-2"}}}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected protected query on %s/%s: %s", dbName, branchName, query)
		}
	}

	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true, Attempts: 1}
	}

	resp, err := svc.CrossCopyAdminPrepareRows(context.Background(), model.CrossCopyAdminPrepareRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
		DestBranch:   "wi/dest-users",
	})
	if err != nil {
		t.Fatalf("prepare rows: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", resp.Outcome)
	}
	if resp.MainHash != "main-head-2" {
		t.Fatalf("unexpected main hash: %s", resp.MainHash)
	}
	if resp.BranchHash != "dest-head-2" {
		t.Fatalf("unexpected branch hash: %s", resp.BranchHash)
	}
	if repo.protectedCalls != 1 {
		t.Fatalf("expected one protected maintenance call, got %d", repo.protectedCalls)
	}
}

func TestCrossCopyAdminPrepareRows_NoSchemaPrepSkipsProtectedMaintenance(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch {
			case query == "SHOW COLUMNS FROM `users`" && refName == "audit":
				return showColumnsResult("varchar(255)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "main":
				return showColumnsResult("varchar(255)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "wi/dest-users":
				return showColumnsResult("varchar(255)"), nil
			case query == "SELECT DOLT_HASHOF('HEAD')" && refName == "main":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"main-head-current"}}}, nil
			case query == "SELECT DOLT_HASHOF('HEAD')" && refName == "wi/dest-users":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"dest-head-current"}}}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
				return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(0)}}}, nil
			case "SELECT DOLT_HASHOF('HEAD')":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"dest-head-current"}}}, nil
			case "SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('wi/dest-users', 'main')":
				return testQueryResult{columns: []string{"table", "data_conflicts", "schema_conflicts"}, rows: nil}, nil
			case "START TRANSACTION":
				return testQueryResult{}, nil
			case "CALL DOLT_MERGE('main')":
				return syncSuccessResult("merge-hash"), nil
			case "COMMIT":
				return testQueryResult{}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
			}
		},
	)

	svc := newWithDeps(repo, testServiceConfig())
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true, Attempts: 1}
	}

	resp, err := svc.CrossCopyAdminPrepareRows(context.Background(), model.CrossCopyAdminPrepareRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
		DestBranch:   "wi/dest-users",
	})
	if err != nil {
		t.Fatalf("prepare rows without schema prep: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", resp.Outcome)
	}
	if repo.protectedCalls != 0 {
		t.Fatalf("expected no protected maintenance calls, got %d", repo.protectedCalls)
	}
}

func TestCrossCopyAdminPrepareRows_SyncFailureAfterPrepReturnsRetryRequired(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch {
			case query == "SHOW COLUMNS FROM `users`" && refName == "audit":
				return showColumnsResult("varchar(255)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "main":
				return showColumnsResult("varchar(50)"), nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch query {
			case "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
				return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(0)}}}, nil
			case "SELECT DOLT_HASHOF('HEAD')":
				return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"dest-head-before-sync"}}}, nil
			case "SELECT * FROM DOLT_PREVIEW_MERGE_CONFLICTS_SUMMARY('wi/dest-users', 'main')":
				return testQueryResult{columns: []string{"table", "data_conflicts", "schema_conflicts"}, rows: [][]driver.Value{{"users", int64(0), int64(1)}}}, nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
			}
		},
	)
	repo.protectedHandler = func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch query {
		case "ALTER TABLE `users` MODIFY COLUMN `name` varchar(255) NULL":
			return testQueryResult{}, nil
		case "CALL DOLT_ADD('.')":
			return testQueryResult{}, nil
		case "CALL DOLT_COMMIT('--allow-empty', '-m', ?)":
			return testQueryResult{}, nil
		case "SELECT DOLT_HASHOF('HEAD')":
			return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"main-head-2"}}}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected protected query on %s/%s: %s", dbName, branchName, query)
		}
	}

	svc := newWithDeps(repo, testServiceConfig())

	resp, err := svc.CrossCopyAdminPrepareRows(context.Background(), model.CrossCopyAdminPrepareRowsRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
		DestBranch:   "wi/dest-users",
	})
	if err != nil {
		t.Fatalf("prepare rows should return retry response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeRetryRequired {
		t.Fatalf("expected retry_required outcome, got %s", resp.Outcome)
	}
	if resp.RetryReason != "destination_branch_sync_requires_manual_recovery" {
		t.Fatalf("unexpected retry reason: %s", resp.RetryReason)
	}
	if resp.MainHash != "main-head-2" {
		t.Fatalf("unexpected main hash: %s", resp.MainHash)
	}
}

func TestCrossCopyAdminPrepareTable_PreparesMain(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			switch {
			case query == "SHOW COLUMNS FROM `users`" && refName == "audit":
				return showColumnsResult("varchar(255)"), nil
			case query == "SHOW COLUMNS FROM `users`" && refName == "main":
				return showColumnsResult("varchar(50)"), nil
			default:
				return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
			}
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	repo.protectedHandler = func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch query {
		case "ALTER TABLE `users` MODIFY COLUMN `name` varchar(255) NULL":
			return testQueryResult{}, nil
		case "CALL DOLT_ADD('.')":
			return testQueryResult{}, nil
		case "CALL DOLT_COMMIT('--allow-empty', '-m', ?)":
			return testQueryResult{}, nil
		case "SELECT DOLT_HASHOF('HEAD')":
			return testQueryResult{columns: []string{"hash"}, rows: [][]driver.Value{{"main-head-2"}}}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected protected query on %s/%s: %s", dbName, branchName, query)
		}
	}

	svc := newWithDeps(repo, testServiceConfig())

	resp, err := svc.CrossCopyAdminPrepareTable(context.Background(), model.CrossCopyAdminPrepareTableRequest{
		TargetID:     "local",
		SourceDB:     "test_db",
		SourceBranch: "audit",
		SourceTable:  "users",
		DestDB:       "test_db",
	})
	if err != nil {
		t.Fatalf("prepare table: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", resp.Outcome)
	}
	if resp.MainHash != "main-head-2" {
		t.Fatalf("unexpected main hash: %s", resp.MainHash)
	}
}

func TestCrossCopyAdminCleanupImport_MissingBranchIsCompletedNoop(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	repo.protectedHandler = func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if query == "SELECT COUNT(*) FROM dolt_branches WHERE name = ?" {
			return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(0)}}}, nil
		}
		return testQueryResult{}, fmt.Errorf("unexpected protected query on %s/%s: %s", dbName, branchName, query)
	}

	svc := newWithDeps(repo, testServiceConfig())
	resp, err := svc.CrossCopyAdminCleanupImport(context.Background(), model.CrossCopyAdminCleanupImportRequest{
		TargetID:   "local",
		DestDB:     "test_db",
		BranchName: "wi/import-test_db-users",
	})
	if err != nil {
		t.Fatalf("cleanup import: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeCompleted {
		t.Fatalf("expected completed outcome, got %s", resp.Outcome)
	}
}

func TestCrossCopyAdminCleanupImport_AmbiguousCleanupReturnsRetryRequired(t *testing.T) {
	repo := newCrossCopyTestRepo(t,
		func(dbName, refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected revision query on %s/%s: %s", dbName, refName, query)
		},
		func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
			return testQueryResult{}, fmt.Errorf("unexpected work query on %s/%s: %s", dbName, branchName, query)
		},
	)
	checks := 0
	repo.protectedHandler = func(dbName, branchName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch query {
		case "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
			checks++
			return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(1)}}}, nil
		case "CALL DOLT_BRANCH('-D', ?)":
			return testQueryResult{}, errors.New("delete failed")
		default:
			return testQueryResult{}, fmt.Errorf("unexpected protected query on %s/%s: %s", dbName, branchName, query)
		}
	}

	svc := newWithDeps(repo, testServiceConfig())
	resp, err := svc.CrossCopyAdminCleanupImport(context.Background(), model.CrossCopyAdminCleanupImportRequest{
		TargetID:   "local",
		DestDB:     "test_db",
		BranchName: "wi/import-test_db-users",
	})
	if err != nil {
		t.Fatalf("cleanup import should return retry response, got error: %v", err)
	}
	if resp.Outcome != model.OperationOutcomeRetryRequired {
		t.Fatalf("expected retry_required outcome, got %s", resp.Outcome)
	}
	if resp.RetryReason != "destination_branch_cleanup_failed" {
		t.Fatalf("unexpected retry reason: %s", resp.RetryReason)
	}
	if checks < 2 {
		t.Fatalf("expected existence to be checked before and after delete, got %d checks", checks)
	}
}
