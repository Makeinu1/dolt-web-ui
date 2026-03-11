package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"strings"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// approveTestRepo is a sessionRepository that records calls and allows both
// ConnRevision (for lookupNamedRef) and ConnProtectedMaintenance (for ApproveRequest).
// Handlers are dispatched by connection method name.
type approveTestRepo struct {
	t                  *testing.T
	revisionHandler    func(refName, query string, args []driver.NamedValue) (testQueryResult, error)
	maintenanceHandler func(refName, query string, args []driver.NamedValue) (testQueryResult, error)
	dbs                []*sql.DB
	calls              []repoCall
}

func newApproveTestRepo(
	t *testing.T,
	revisionHandler func(refName, query string, args []driver.NamedValue) (testQueryResult, error),
	maintenanceHandler func(refName, query string, args []driver.NamedValue) (testQueryResult, error),
) *approveTestRepo {
	t.Helper()
	repo := &approveTestRepo{t: t, revisionHandler: revisionHandler, maintenanceHandler: maintenanceHandler}
	t.Cleanup(func() {
		for _, db := range repo.dbs {
			_ = db.Close()
		}
	})
	return repo
}

func (r *approveTestRepo) openConn(ctx context.Context, refName string, handler func(refName, query string, args []driver.NamedValue) (testQueryResult, error)) (*sql.Conn, error) {
	driverName := fmt.Sprintf("approve-test-%d", testDriverID.Add(1))
	sql.Register(driverName, &testDriver{
		handler: func(query string, args []driver.NamedValue) (testQueryResult, error) {
			return handler(refName, query, args)
		},
	})
	db, err := sql.Open(driverName, "")
	if err != nil {
		return nil, err
	}
	r.dbs = append(r.dbs, db)
	return db.Conn(ctx)
}

func (r *approveTestRepo) Conn(ctx context.Context, targetID, dbName, ref string) (*sql.Conn, error) {
	return r.ConnRevision(ctx, targetID, dbName, ref)
}

func (r *approveTestRepo) ConnRevision(ctx context.Context, targetID, dbName, ref string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnRevision", ref: ref})
	return r.openConn(ctx, ref, r.revisionHandler)
}

func (r *approveTestRepo) ConnWorkBranchWrite(ctx context.Context, targetID, dbName, branch string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnWorkBranchWrite", ref: branch})
	return nil, fmt.Errorf("unexpected ConnWorkBranchWrite in approve test")
}

func (r *approveTestRepo) ConnProtectedMaintenance(ctx context.Context, targetID, dbName, branch string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnProtectedMaintenance", ref: branch})
	return r.openConn(ctx, branch, r.maintenanceHandler)
}

// approveMaintenanceHandler returns a SQL handler that drives the happy-path
// ApproveRequest merge flow:
//  1. tag lookup (tag_hash + message)
//  2. HASHOF(workBranch) → same hash (no change)
//  3. SET autocommit=1
//  4. CALL DOLT_MERGE → (hash, 0, 0, "")
//  5. SELECT DOLT_HASHOF('HEAD') → newHead
//  6. archive tag sequence query → empty
//  7. CALL DOLT_TAG (create archive tag) → ok
func approveMaintenanceHandler(
	reqMessage string,
	submittedWorkHash string,
	newHead string,
) func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
	return func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.HasPrefix(query, "SELECT tag_hash, message FROM dolt_tags WHERE tag_name = ?"):
			return testQueryResult{
				columns: []string{"tag_hash", "message"},
				rows:    [][]driver.Value{{submittedWorkHash, reqMessage}},
			}, nil

		case strings.HasPrefix(query, "SELECT HASHOF(?)"):
			return testQueryResult{
				columns: []string{"hashof(?)"},
				rows:    [][]driver.Value{{submittedWorkHash}},
			}, nil

		case strings.HasPrefix(query, "SET autocommit"):
			return testQueryResult{}, nil

		case strings.HasPrefix(query, "CALL DOLT_MERGE("):
			return testQueryResult{
				columns: []string{"hash", "fast_forward", "conflicts", "message"},
				rows:    [][]driver.Value{{newHead, int64(0), int64(0), ""}},
			}, nil

		case strings.HasPrefix(query, "SELECT DOLT_HASHOF('HEAD')"):
			return testQueryResult{
				columns: []string{"dolt_hashof('head')"},
				rows:    [][]driver.Value{{newHead}},
			}, nil

		case strings.Contains(query, "dolt_tags WHERE tag_name LIKE"):
			// nextArchiveSequence — no existing tags
			return testQueryResult{
				columns: []string{"tag_name"},
			}, nil

		case strings.HasPrefix(query, "CALL DOLT_TAG('-m',"):
			return testQueryResult{}, nil

		default:
			return testQueryResult{}, nil
		}
	}
}

const (
	approveTestWorkBranch        = "wi/task-hook-test"
	approveTestRequestID         = "req/task-hook-test"
	approveTestSubmittedWorkHash = "aabbccdd001122334455667788990011"
	approveTestNewHead           = "11223344aabbccdd00112233aabbccdd"
)

// buildApproveHookTestService creates a service wired with the happy-path merge SQL
// handler. The returned service has all 3 postcondition hooks set to real defaults,
// which the caller can then override to inject specific failures.
func buildApproveHookTestService(t *testing.T) *Service {
	t.Helper()

	reqMessage := fmt.Sprintf(
		`{"schema":"dolt-webui/request@2","submitted_main_hash":"main-hash","submitted_work_hash":%q,"submitted_at":"2026-03-11T00:00:00Z","work_branch":%q,"summary_ja":"test"}`,
		approveTestSubmittedWorkHash, approveTestWorkBranch,
	)

	maintenanceHandler := approveMaintenanceHandler(
		reqMessage,
		approveTestSubmittedWorkHash,
		approveTestNewHead,
	)

	repo := newApproveTestRepo(t,
		// revision handler: not called in normal approve flow
		func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
			t.Errorf("unexpected ConnRevision query on ref %s: %s", refName, query)
			return testQueryResult{}, fmt.Errorf("unexpected revision query")
		},
		maintenanceHandler,
	)

	svc := newWithDeps(repo, testServiceConfig())

	// Replace branchReadinessProbe to avoid needing a real DB for readiness check.
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: true, Attempts: 1}
	}

	return svc
}

// TestApproveRequest_RequestCleanupFailure_IsRetryRequired verifies that if the
// deleteRequestTag step fails AFTER the main merge succeeded, the outcome is
// "retry_required" (not "completed").
func TestApproveRequest_RequestCleanupFailure_IsRetryRequired(t *testing.T) {
	svc := buildApproveHookTestService(t)

	// Inject failure: deleteRequestTag fails
	svc.approveDeleteRequestTagHook = func(ctx context.Context, targetID, dbName, requestID string) error {
		return fmt.Errorf("injected tag delete failure")
	}

	resp, err := svc.ApproveRequest(context.Background(), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      approveTestRequestID,
		MergeMessageJa: "hook test approve",
	})
	if err != nil {
		t.Fatalf("expected no error (merge succeeded), got: %v", err)
	}

	if resp.Outcome != "retry_required" {
		t.Errorf("expected outcome=retry_required, got %q", resp.Outcome)
	}
	if resp.Completion["audit_recorded"] != true {
		t.Errorf("expected audit_recorded=true, got %v", resp.Completion["audit_recorded"])
	}
	if resp.Completion["request_cleared"] != false {
		t.Errorf("expected request_cleared=false, got %v", resp.Completion["request_cleared"])
	}
	if resp.RetryReason != "request_cleanup_failed" {
		t.Errorf("expected retry_reason=request_cleanup_failed, got %q", resp.RetryReason)
	}
	if len(resp.Warnings) != 0 {
		t.Errorf("expected no advisory warnings on retry_required, got %v", resp.Warnings)
	}
	// Merge hash must be set (audit truth exists).
	if resp.Hash != approveTestNewHead {
		t.Errorf("expected hash=%q, got %q", approveTestNewHead, resp.Hash)
	}
}

// TestApproveRequest_AdvanceFailure_IsRetryRequired verifies that if the work branch
// advance fails AFTER the main merge and request cleanup succeeded, the outcome is
// "retry_required".
func TestApproveRequest_AdvanceFailure_IsRetryRequired(t *testing.T) {
	svc := buildApproveHookTestService(t)

	// Request cleanup succeeds, advance fails.
	svc.approveDeleteRequestTagHook = func(ctx context.Context, targetID, dbName, requestID string) error {
		return nil // success
	}
	svc.approveAdvanceWorkBranchHook = func(ctx context.Context, targetID, dbName, workBranch string, warnings *[]string) bool {
		*warnings = append(*warnings, "injected advance failure")
		return false
	}

	resp, err := svc.ApproveRequest(context.Background(), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      approveTestRequestID,
		MergeMessageJa: "hook test approve",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if resp.Outcome != "retry_required" {
		t.Errorf("expected outcome=retry_required, got %q", resp.Outcome)
	}
	if resp.Completion["request_cleared"] != true {
		t.Errorf("expected request_cleared=true, got %v", resp.Completion["request_cleared"])
	}
	if resp.Completion["resume_branch_ready"] != false {
		t.Errorf("expected resume_branch_ready=false, got %v", resp.Completion["resume_branch_ready"])
	}
	if resp.RetryReason != "resume_branch_not_ready" {
		t.Errorf("expected retry_reason=resume_branch_not_ready, got %q", resp.RetryReason)
	}
}

// TestApproveRequest_QueryabilityFailure_IsRetryRequired verifies that if the work
// branch advance SQL succeeds but the readiness probe reports not-ready, the outcome
// is "retry_required".
func TestApproveRequest_QueryabilityFailure_IsRetryRequired(t *testing.T) {
	svc := buildApproveHookTestService(t)

	// Request cleanup succeeds, advance hook calls the real advanceWorkBranch logic
	// but branchReadinessProbe reports not-ready.
	svc.approveDeleteRequestTagHook = func(ctx context.Context, targetID, dbName, requestID string) error {
		return nil
	}
	// Override readiness probe to report not-ready.
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		return branchQueryabilityResult{Ready: false, Attempts: 3}
	}
	// Use the advance hook that calls real advanceWorkBranch — it will open a maintenance
	// conn (which succeeds with our mock repo) and then fail on readiness.
	// The maintenance conn handler needs to handle DOLT_BRANCH.
	svc.approveAdvanceWorkBranchHook = func(ctx context.Context, targetID, dbName, workBranch string, warnings *[]string) bool {
		// Simulate: DOLT_BRANCH succeeds but readiness fails.
		// We mimic advanceWorkBranch behavior directly.
		readiness := svc.branchReadiness(ctx, targetID, dbName, workBranch)
		if !readiness.Ready {
			*warnings = append(*warnings, fmt.Sprintf("作業ブランチ %s は更新済みですが、接続反映を確認できませんでした。時間をおいて再度開いてください。", workBranch))
			return false
		}
		return true
	}

	resp, err := svc.ApproveRequest(context.Background(), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      approveTestRequestID,
		MergeMessageJa: "hook test approve",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if resp.Outcome != "retry_required" {
		t.Errorf("expected outcome=retry_required, got %q", resp.Outcome)
	}
	if resp.Completion["audit_recorded"] != true {
		t.Errorf("expected audit_recorded=true")
	}
	if resp.Completion["resume_branch_ready"] != false {
		t.Errorf("expected resume_branch_ready=false")
	}
	if resp.RetryReason != "resume_branch_not_ready" {
		t.Errorf("expected retry_reason=resume_branch_not_ready, got %q", resp.RetryReason)
	}
}

// TestApproveRequest_HappyPath_IsCompleted verifies that when all postconditions
// succeed, the outcome is "completed".
func TestApproveRequest_HappyPath_IsCompleted(t *testing.T) {
	svc := buildApproveHookTestService(t)

	svc.approveDeleteRequestTagHook = func(ctx context.Context, targetID, dbName, requestID string) error {
		return nil
	}
	svc.approveAdvanceWorkBranchHook = func(ctx context.Context, targetID, dbName, workBranch string, warnings *[]string) bool {
		return true
	}

	resp, err := svc.ApproveRequest(context.Background(), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      approveTestRequestID,
		MergeMessageJa: "hook test approve",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if resp.Outcome != "completed" {
		t.Errorf("expected outcome=completed, got %q", resp.Outcome)
	}
	if resp.Completion["audit_recorded"] != true {
		t.Errorf("expected audit_recorded=true")
	}
	if resp.Completion["request_cleared"] != true {
		t.Errorf("expected request_cleared=true")
	}
	if resp.Completion["resume_branch_ready"] != true {
		t.Errorf("expected resume_branch_ready=true")
	}
	if resp.Completion["audit_indexed"] != true {
		t.Errorf("expected audit_indexed=true")
	}
	if len(resp.Warnings) != 0 {
		t.Errorf("expected no warnings, got: %v", resp.Warnings)
	}
}

// TestApproveRequest_SecondaryIndexFailure_DoesNotEraseAuditTruth verifies that
// a merged/* tag creation failure does NOT prevent the audit truth (merge on main)
// and does NOT prevent request cleanup or branch advance (B-PR2 invariant).
func TestApproveRequest_SecondaryIndexFailure_DoesNotEraseAuditTruth(t *testing.T) {
	svc := buildApproveHookTestService(t)

	// Secondary index creation fails.
	svc.approveCreateSecondaryIndexHook = func(ctx context.Context, conn *sql.Conn, workItem, message string) (string, error) {
		return "", fmt.Errorf("injected secondary index failure")
	}
	// Postconditions still succeed.
	svc.approveDeleteRequestTagHook = func(ctx context.Context, targetID, dbName, requestID string) error {
		return nil
	}
	svc.approveAdvanceWorkBranchHook = func(ctx context.Context, targetID, dbName, workBranch string, warnings *[]string) bool {
		return true
	}

	resp, err := svc.ApproveRequest(context.Background(), model.ApproveRequest{
		TargetID:       "local",
		DBName:         "test_db",
		RequestID:      approveTestRequestID,
		MergeMessageJa: "hook test approve",
	})
	if err != nil {
		t.Fatalf("expected no error despite secondary index failure, got: %v", err)
	}

	// Outcome must still be completed — archive tag failure is secondary index missing,
	// not audit truth failure.
	if resp.Outcome != "completed" {
		t.Errorf("expected outcome=completed (secondary index failure only), got %q", resp.Outcome)
	}
	if resp.Completion["audit_recorded"] != true {
		t.Errorf("expected audit_recorded=true")
	}
	if resp.Completion["request_cleared"] != true {
		t.Errorf("expected request_cleared=true")
	}
	if resp.Completion["audit_indexed"] != false {
		t.Errorf("expected audit_indexed=false")
	}
	// ArchiveTag will be empty due to failure.
	if resp.ArchiveTag != "" {
		t.Errorf("expected empty ArchiveTag, got %q", resp.ArchiveTag)
	}
	// A warning should have been emitted.
	if len(resp.Warnings) == 0 {
		t.Error("expected warning for secondary index failure")
	}
}
