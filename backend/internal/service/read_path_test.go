package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/config"
)

type testQueryResult struct {
	columns []string
	rows    [][]driver.Value
}

type testQueryHandler func(query string, args []driver.NamedValue) (testQueryResult, error)

type testDriver struct {
	handler testQueryHandler
}

func (d *testDriver) Open(name string) (driver.Conn, error) {
	return &testConn{handler: d.handler}, nil
}

type testConn struct {
	handler testQueryHandler
}

func (c *testConn) Prepare(query string) (driver.Stmt, error) {
	return nil, fmt.Errorf("Prepare not supported in tests: %s", query)
}

func (c *testConn) Close() error {
	return nil
}

func (c *testConn) Begin() (driver.Tx, error) {
	return nil, fmt.Errorf("Begin not supported in tests")
}

func (c *testConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	result, err := c.handler(query, args)
	if err != nil {
		return nil, err
	}
	return &testRows{columns: result.columns, rows: result.rows}, nil
}

// ExecContext implements driver.ExecerContext so that conn.ExecContext (used for SET,
// CALL DOLT_MERGE, CALL DOLT_TAG, etc.) routes through the test handler rather than
// falling back to the unsupported Prepare path.
func (c *testConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	_, err := c.handler(query, args)
	return driver.ResultNoRows, err
}

type testRows struct {
	columns []string
	rows    [][]driver.Value
	index   int
}

func (r *testRows) Columns() []string {
	return r.columns
}

func (r *testRows) Close() error {
	return nil
}

func (r *testRows) Next(dest []driver.Value) error {
	if r.index >= len(r.rows) {
		return io.EOF
	}
	copy(dest, r.rows[r.index])
	r.index++
	return nil
}

type repoCall struct {
	method string
	ref    string
}

type recordingSessionRepo struct {
	t       *testing.T
	handler func(refName, query string, args []driver.NamedValue) (testQueryResult, error)
	calls   []repoCall
	dbs     []*sql.DB
}

func newRecordingSessionRepo(t *testing.T, handler func(refName, query string, args []driver.NamedValue) (testQueryResult, error)) *recordingSessionRepo {
	t.Helper()

	repo := &recordingSessionRepo{t: t, handler: handler}
	t.Cleanup(func() {
		for _, db := range repo.dbs {
			_ = db.Close()
		}
	})
	return repo
}

func (r *recordingSessionRepo) Conn(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	return r.ConnRevision(ctx, targetID, dbName, branchName)
}

func (r *recordingSessionRepo) ConnRevision(ctx context.Context, targetID, dbName, refName string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnRevision", ref: refName})

	driverName := fmt.Sprintf("track-a-read-path-%d", testDriverID.Add(1))
	sql.Register(driverName, &testDriver{
		handler: func(query string, args []driver.NamedValue) (testQueryResult, error) {
			return r.handler(refName, query, args)
		},
	})

	db, err := sql.Open(driverName, "")
	if err != nil {
		return nil, err
	}
	r.dbs = append(r.dbs, db)
	return db.Conn(ctx)
}

func (r *recordingSessionRepo) ConnWorkBranchWrite(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnWorkBranchWrite", ref: branchName})
	return nil, fmt.Errorf("unexpected ConnWorkBranchWrite(%s)", branchName)
}

func (r *recordingSessionRepo) ConnProtectedMaintenance(ctx context.Context, targetID, dbName, branchName string) (*sql.Conn, error) {
	r.calls = append(r.calls, repoCall{method: "ConnProtectedMaintenance", ref: branchName})
	return nil, fmt.Errorf("unexpected ConnProtectedMaintenance(%s)", branchName)
}

func (r *recordingSessionRepo) PurgeIdleConns(targetID string) {}

var testDriverID atomic.Uint64

func testServiceConfig() *config.Config {
	return &config.Config{
		Targets: []config.Target{
			{ID: "local"},
		},
		Databases: []config.Database{
			{
				TargetID:        "local",
				Name:            "test_db",
				AllowedBranches: []string{"main", "audit", "wi/*"},
			},
		},
		Server: config.Server{
			Recovery: config.Recovery{
				BranchReadySec:    1,
				BranchReadyPollMS: 1,
			},
			Search: config.Search{
				TimeoutSec: 1,
			},
		},
	}
}

func TestMetadataRead_UsesConnRevision_NotProtectedMaintenance(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if refName != "main" {
			return testQueryResult{}, fmt.Errorf("unexpected ref: %s", refName)
		}
		if query != "SELECT name, hash FROM dolt_branches" {
			return testQueryResult{}, fmt.Errorf("unexpected query: %s", query)
		}
		return testQueryResult{
			columns: []string{"name", "hash"},
			rows: [][]driver.Value{
				{"main", "hash-main"},
				{"wi/visible", "hash-visible"},
			},
		}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	branches, err := svc.ListBranches(context.Background(), "local", "test_db")
	if err != nil {
		t.Fatalf("ListBranches: %v", err)
	}
	if len(branches) != 2 {
		t.Fatalf("expected 2 visible branches, got %d", len(branches))
	}
	if fmt.Sprint(repo.calls) != fmt.Sprint([]repoCall{{method: "ConnRevision", ref: "main"}}) {
		t.Fatalf("unexpected session calls: %v", repo.calls)
	}
}

func TestRequestRead_UsesConnRevision_NotProtectedMaintenance(t *testing.T) {
	message := `{"submitted_main_hash":"main-hash","submitted_work_hash":"work-hash","summary_ja":"hello","submitted_at":"2026-03-11T00:00:00Z"}`
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if refName != "main" {
			return testQueryResult{}, fmt.Errorf("unexpected ref: %s", refName)
		}
		switch query {
		case "SELECT tag_name, tag_hash, message FROM dolt_tags WHERE tag_name LIKE 'req/%' ORDER BY tag_name":
			return testQueryResult{
				columns: []string{"tag_name", "tag_hash", "message"},
				rows: [][]driver.Value{
					{"req/visible", "tag-hash", message},
				},
			}, nil
		case "SELECT tag_hash, message FROM dolt_tags WHERE tag_name = ?":
			return testQueryResult{
				columns: []string{"tag_hash", "message"},
				rows: [][]driver.Value{
					{"tag-hash", message},
				},
			}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected query: %s", query)
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	requests, err := svc.ListRequests(context.Background(), "local", "test_db")
	if err != nil {
		t.Fatalf("ListRequests: %v", err)
	}
	if len(requests) != 1 || requests[0].WorkBranch != "wi/visible" {
		t.Fatalf("unexpected requests: %+v", requests)
	}

	request, err := svc.GetRequest(context.Background(), "local", "test_db", "req/visible")
	if err != nil {
		t.Fatalf("GetRequest: %v", err)
	}
	if request.WorkBranch != "wi/visible" {
		t.Fatalf("unexpected request work branch: %+v", request)
	}

	wantCalls := []repoCall{
		{method: "ConnRevision", ref: "main"},
		{method: "ConnRevision", ref: "main"},
	}
	if fmt.Sprint(repo.calls) != fmt.Sprint(wantCalls) {
		t.Fatalf("unexpected session calls: %v", repo.calls)
	}
}

func TestHistoryRead_UsesConnRevision_ForAllowedHistoryRef(t *testing.T) {
	tagRef := "release-tag"
	const legacyMergeHash = "1234567890abcdef1234567890abcdef"
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case refName == "main" && query == "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
			return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(0)}}}, nil
		case refName == "main" && query == "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
			return testQueryResult{columns: []string{"count(*)"}, rows: [][]driver.Value{{int64(1)}}}, nil

		// B-PR2: Step 1 — merged/* tag index for legacy adapter.
		case refName == tagRef && strings.HasPrefix(query, "SELECT tag_name, tag_hash FROM dolt_tags WHERE tag_name LIKE 'merged/%'"):
			return testQueryResult{
				columns: []string{"tag_name", "tag_hash"},
				rows: [][]driver.Value{
					{"merged/demo/01", legacyMergeHash},
				},
			}, nil

		// B-PR2: Step 2 — dolt_log walk.
		case refName == tagRef && strings.HasPrefix(query, "SELECT commit_hash, committer, date, message FROM dolt_log"):
			return testQueryResult{
				columns: []string{"commit_hash", "committer", "date", "message"},
				rows: [][]driver.Value{
					// pre-cutover legacy commit (no footer) matched by merged/* tag.
					{legacyMergeHash, "tester", "2026-03-11 00:00:00", "merge message"},
					// normal commit (no footer, no merged/* tag) — skipped.
					{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "someone", "2026-03-10 00:00:00", "chore: update"},
				},
			}, nil

		default:
			return testQueryResult{}, fmt.Errorf("unexpected query for ref %s: %s", refName, query)
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	commitsResp, err := svc.HistoryCommits(context.Background(), "local", "test_db", tagRef, 1, 20, "", "", "", "", "", "")
	if err != nil {
		t.Fatalf("HistoryCommits: %v", err)
	}
	if len(commitsResp.Commits) != 1 {
		t.Fatalf("expected 1 commit (legacy), got %d", len(commitsResp.Commits))
	}
	if commitsResp.Commits[0].Hash != legacyMergeHash {
		t.Errorf("expected legacy merge hash %s, got %s", legacyMergeHash, commitsResp.Commits[0].Hash)
	}
	if commitsResp.Commits[0].MergeBranch != "wi/demo" {
		t.Errorf("expected MergeBranch=wi/demo, got %s", commitsResp.Commits[0].MergeBranch)
	}

	wantCalls := []repoCall{
		{method: "ConnRevision", ref: "main"},
		{method: "ConnRevision", ref: tagRef},
	}
	if fmt.Sprint(repo.calls) != fmt.Sprint(wantCalls) {
		t.Fatalf("unexpected session calls: %v", repo.calls)
	}
}

// TestSubmitAndRequestReads_DegradedReqJSON_StillUseTagTruth verifies that when a
// req/* tag message contains invalid JSON, ListRequests and GetRequest still return
// results using the tag target hash as the submitted_work_hash fallback.
// This confirms that pending truth is tag existence + target hash, not message JSON.
func TestSubmitAndRequestReads_DegradedReqJSON_StillUseTagTruth(t *testing.T) {
	const brokenJSON = "not-valid-json{{{" // deliberately malformed
	const tagHash = "aabbccdd001122334455667788990011"

	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if refName != "main" {
			return testQueryResult{}, fmt.Errorf("unexpected ref: %s", refName)
		}
		switch query {
		case "SELECT tag_name, tag_hash, message FROM dolt_tags WHERE tag_name LIKE 'req/%' ORDER BY tag_name":
			return testQueryResult{
				columns: []string{"tag_name", "tag_hash", "message"},
				rows:    [][]driver.Value{{"req/degraded", tagHash, brokenJSON}},
			}, nil
		case "SELECT tag_hash, message FROM dolt_tags WHERE tag_name = ?":
			return testQueryResult{
				columns: []string{"tag_hash", "message"},
				rows:    [][]driver.Value{{tagHash, brokenJSON}},
			}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected query: %s", query)
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	// ListRequests must succeed and use tag_hash as submitted_work_hash.
	requests, err := svc.ListRequests(context.Background(), "local", "test_db")
	if err != nil {
		t.Fatalf("ListRequests: %v", err)
	}
	if len(requests) != 1 {
		t.Fatalf("expected 1 request, got %d", len(requests))
	}
	req := requests[0]
	if req.RequestID != "req/degraded" {
		t.Errorf("RequestID: got %q", req.RequestID)
	}
	if req.WorkBranch != "wi/degraded" {
		t.Errorf("WorkBranch: got %q", req.WorkBranch)
	}
	// submitted_work_hash must fall back to tag target hash when JSON is broken.
	if req.SubmittedWorkHash != tagHash {
		t.Errorf("SubmittedWorkHash: got %q want %q", req.SubmittedWorkHash, tagHash)
	}

	// GetRequest must succeed with the same fallback.
	single, err := svc.GetRequest(context.Background(), "local", "test_db", "req/degraded")
	if err != nil {
		t.Fatalf("GetRequest: %v", err)
	}
	if single.SubmittedWorkHash != tagHash {
		t.Errorf("GetRequest SubmittedWorkHash: got %q want %q", single.SubmittedWorkHash, tagHash)
	}
}

func TestGetBranchReady_UsesBranchReadinessPredicate(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if refName != "main" {
			return testQueryResult{}, fmt.Errorf("unexpected ref: %s", refName)
		}
		if query != "SELECT COUNT(*) FROM dolt_branches WHERE name = ?" {
			return testQueryResult{}, fmt.Errorf("unexpected query: %s", query)
		}
		return testQueryResult{
			columns: []string{"count(*)"},
			rows:    [][]driver.Value{{int64(1)}},
		}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	probeCalls := 0
	svc.branchReadinessProbe = func(ctx context.Context, targetID, dbName, branch string) branchQueryabilityResult {
		probeCalls++
		if targetID != "local" || dbName != "test_db" || branch != "wi/visible" {
			t.Fatalf("unexpected readiness probe input: target=%s db=%s branch=%s", targetID, dbName, branch)
		}
		return branchQueryabilityResult{Ready: true, Attempts: 1}
	}

	resp, err := svc.GetBranchReady(context.Background(), "local", "test_db", "wi/visible")
	if err != nil {
		t.Fatalf("GetBranchReady: %v", err)
	}
	if !resp.Ready {
		t.Fatalf("expected branch ready response, got %+v", resp)
	}
	if probeCalls != 1 {
		t.Fatalf("expected 1 readiness probe call, got %d", probeCalls)
	}
}
