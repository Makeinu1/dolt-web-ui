package service

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

func TestGetMemoMap_MissingTable_ReturnsEmpty(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if strings.Contains(query, "SELECT pk_value, column_name") {
			return testQueryResult{}, errors.New("table `_memo_users` doesn't exist")
		}
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	cells, err := svc.GetMemoMap(context.Background(), "local", "test_db", "main", "users")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cells) != 0 {
		t.Fatalf("expected empty cells, got %v", cells)
	}
}

func TestGetMemoMap_QueryFailure_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if strings.Contains(query, "SELECT pk_value, column_name") {
			return testQueryResult{}, errors.New("boom")
		}
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.GetMemoMap(context.Background(), "local", "test_db", "main", "users")
	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInternal {
		t.Fatalf("expected %s, got %s", model.CodeInternal, apiErr.Code)
	}
}

func TestGetMemo_MissingTable_ReturnsEmpty(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if strings.Contains(query, "SELECT memo_text") {
			return testQueryResult{}, errors.New("table `_memo_users` doesn't exist")
		}
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	memo, err := svc.GetMemo(context.Background(), "local", "test_db", "main", "users", `{"id":1}`, "role")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if memo.MemoText != "" {
		t.Fatalf("expected empty memo text, got %q", memo.MemoText)
	}
}

func TestGetMemo_QueryFailure_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if strings.Contains(query, "SELECT memo_text") {
			return testQueryResult{}, errors.New("boom")
		}
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.GetMemo(context.Background(), "local", "test_db", "main", "users", `{"id":1}`, "role")
	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInternal {
		t.Fatalf("expected %s, got %s", model.CodeInternal, apiErr.Code)
	}
}

func TestGetMemo_HistoryRef_UsesRequestedRevision(t *testing.T) {
	const previewHash = "0123456789abcdef0123456789abcdef"

	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case refName == "main" && query == "SELECT COUNT(*) FROM dolt_branches WHERE name = ?":
			return testQueryResult{
				columns: []string{"count"},
				rows:    [][]driver.Value{{0}},
			}, nil
		case refName == "main" && query == "SELECT COUNT(*) FROM dolt_tags WHERE tag_name = ?":
			return testQueryResult{
				columns: []string{"count"},
				rows:    [][]driver.Value{{0}},
			}, nil
		case refName == previewHash && strings.Contains(query, "SELECT memo_text"):
			return testQueryResult{
				columns: []string{"memo_text", "updated_at"},
				rows:    [][]driver.Value{{"preview memo", "2026-03-13T12:00:00"}},
			}, nil
		default:
			return testQueryResult{}, fmt.Errorf("unexpected query on %s: %s", refName, query)
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	memo, err := svc.GetMemo(context.Background(), "local", "test_db", previewHash, "users", `{"id":1}`, "role")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if memo.MemoText != "preview memo" {
		t.Fatalf("expected preview memo, got %q", memo.MemoText)
	}
	if fmt.Sprint(repo.calls) != fmt.Sprint([]repoCall{
		{method: "ConnRevision", ref: "main"},
		{method: "ConnRevision", ref: previewHash},
	}) {
		t.Fatalf("unexpected session calls: %v", repo.calls)
	}
}
