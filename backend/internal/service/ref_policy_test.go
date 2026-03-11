package service

import (
	"context"
	"database/sql/driver"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// noQueryRepo is a recording repo that fails if any DB call is made.
// Used for tests where policy is enforced before any DB access.
func noQueryRepo(t *testing.T) *recordingSessionRepo {
	t.Helper()
	return newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		t.Errorf("unexpected DB call on ref %s: %s", refName, query)
		return testQueryResult{}, nil
	})
}

// lookupRepo builds a repo whose ConnRevision handler answers branch/tag lookups.
// branchExists and tagExists control what the lookup returns for the queried refName.
func lookupRepo(t *testing.T, branchExists, tagExists bool) *recordingSessionRepo {
	t.Helper()
	return newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch query {
		case "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
			count := int64(0)
			if branchExists {
				count = 1
			}
			return testQueryResult{
				columns: []string{"count(*)"},
				rows:    [][]driver.Value{{count}},
			}, nil
		case "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
			count := int64(0)
			if tagExists {
				count = 1
			}
			return testQueryResult{
				columns: []string{"count(*)"},
				rows:    [][]driver.Value{{count}},
			}, nil
		default:
			t.Errorf("unexpected query on ref %s: %s", refName, query)
			return testQueryResult{}, nil
		}
	})
}

// ── ensureAllowedBranchRef ────────────────────────────────────────────────────

func TestEnsureAllowedBranchRef_AllowsExactMatch(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	if err := svc.ensureAllowedBranchRef("local", "test_db", "main"); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestEnsureAllowedBranchRef_AllowsWildcardWorkBranch(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	if err := svc.ensureAllowedBranchRef("local", "test_db", "wi/task-123"); err != nil {
		t.Fatalf("expected nil for wi/*, got %v", err)
	}
}

func TestEnsureAllowedBranchRef_RejectsDisallowedBranch(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	err := svc.ensureAllowedBranchRef("local", "test_db", "scratch/tmp")
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
}

func TestEnsureAllowedBranchRef_RejectsInvalidBranchNameFormat(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	// semicolon is not allowed in branch names
	err := svc.ensureAllowedBranchRef("local", "test_db", "main;DROP TABLE users")
	expectUnitAPIErrorCode(t, err, model.CodeInvalidArgument)
}

// ── ensureAllowedWorkBranchWrite ──────────────────────────────────────────────

func TestEnsureAllowedWorkBranchWrite_AllowsAllowlistedWorkBranch(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	if err := svc.ensureAllowedWorkBranchWrite("local", "test_db", "wi/task-001"); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestEnsureAllowedWorkBranchWrite_RejectsMainBranch(t *testing.T) {
	// main is not a wi/* branch — must be rejected before allowlist check
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	err := svc.ensureAllowedWorkBranchWrite("local", "test_db", "main")
	expectUnitAPIErrorCode(t, err, model.CodeInvalidArgument)
}

func TestEnsureAllowedWorkBranchWrite_RejectsNonWiBranchPattern(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	err := svc.ensureAllowedWorkBranchWrite("local", "test_db", "feature/foo")
	expectUnitAPIErrorCode(t, err, model.CodeInvalidArgument)
}

func TestEnsureAllowedWorkBranchWrite_RejectsDisallowedWorkBranch(t *testing.T) {
	// testServiceConfigWithoutWorkBranches only allows main and audit
	svc := newWithDeps(noQueryRepo(t), testServiceConfigWithoutWorkBranches())
	err := svc.ensureAllowedWorkBranchWrite("local", "test_db", "wi/task-001")
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
}

func TestEnsureAllowedWorkBranchWrite_RejectsInvalidBranchNameFormat(t *testing.T) {
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	err := svc.ensureAllowedWorkBranchWrite("local", "test_db", "wi/task 001")
	expectUnitAPIErrorCode(t, err, model.CodeInvalidArgument)
}

// ── ensureHistoryRef ─────────────────────────────────────────────────────────

func TestEnsureHistoryRef_AllowsAllowlistedBranchWithoutDBLookup(t *testing.T) {
	// "main" is in allowlist → early return, no DB query
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	if err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "main"); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestEnsureHistoryRef_AllowsCommitHash(t *testing.T) {
	// 32-char lowercase hex commit hash: not in allowlist but is a history expression
	svc := newWithDeps(lookupRepo(t, false, false), testServiceConfig())
	hash := "0123456789abcdef0123456789abcdef"
	if err := svc.ensureHistoryRef(context.Background(), "local", "test_db", hash); err != nil {
		t.Fatalf("expected nil for commit hash, got %v", err)
	}
}

func TestEnsureHistoryRef_AllowsHistoryExpressionWithCaret(t *testing.T) {
	// "main^" is not in allowlist but isHistoryExpressionRef returns true
	svc := newWithDeps(lookupRepo(t, false, false), testServiceConfig())
	if err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "main^"); err != nil {
		t.Fatalf("expected nil for main^, got %v", err)
	}
}

func TestEnsureHistoryRef_AllowsHistoryExpressionWithTilde(t *testing.T) {
	svc := newWithDeps(lookupRepo(t, false, false), testServiceConfig())
	if err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "main~3"); err != nil {
		t.Fatalf("expected nil for main~3, got %v", err)
	}
}

func TestEnsureHistoryRef_AllowsTag(t *testing.T) {
	// Tag exists in dolt_tags but not in allowlist → allowed
	svc := newWithDeps(lookupRepo(t, false, true), testServiceConfig())
	if err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "merged/task-001/01"); err != nil {
		t.Fatalf("expected nil for existing tag, got %v", err)
	}
}

func TestEnsureHistoryRef_RejectsNonAllowlistedBranchFoundInDB(t *testing.T) {
	// Branch exists in dolt_branches but is not in the allowlist → forbidden
	svc := newWithDeps(lookupRepo(t, true, false), testServiceConfig())
	err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "scratch/tmp")
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
}

func TestEnsureHistoryRef_RejectsUnknownRef(t *testing.T) {
	// Not in allowlist, not a branch, not a tag, not a hash expression → forbidden
	svc := newWithDeps(lookupRepo(t, false, false), testServiceConfig())
	err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "unknown-ref")
	expectUnitAPIErrorCode(t, err, model.CodeForbidden)
}

func TestEnsureHistoryRef_RejectsInvalidRefFormat(t *testing.T) {
	// Spaces not allowed in revision refs
	svc := newWithDeps(noQueryRepo(t), testServiceConfig())
	err := svc.ensureHistoryRef(context.Background(), "local", "test_db", "main branch")
	expectUnitAPIErrorCode(t, err, model.CodeInvalidArgument)
}
