package service

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// TestSearch_Timeout_FailsLoud_NotEmptySuccess verifies that a search context deadline
// during per-table query is surfaced as a 408 error, not empty success or partial results.
func TestSearch_Timeout_FailsLoud_NotEmptySuccess(t *testing.T) {
	// Table list succeeds, then the per-table data query returns DeadlineExceeded.
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.Contains(query, "SHOW FULL TABLES"):
			return testQueryResult{
				columns: []string{"Tables_in_db", "Table_type"},
				rows:    [][]driver.Value{{"users", "BASE TABLE"}},
			}, nil
		case strings.Contains(query, "INFORMATION_SCHEMA.COLUMNS"):
			// Return empty to trigger SHOW COLUMNS fallback.
			return testQueryResult{
				columns: []string{"TABLE_NAME", "COLUMN_NAME", "COLUMN_KEY"},
			}, nil
		case strings.Contains(query, "SHOW COLUMNS"):
			return testQueryResult{
				columns: []string{"Field", "Type", "Null", "Key", "Default", "Extra"},
				rows:    [][]driver.Value{{"id", "int", "NO", "PRI", nil, ""}},
			}, nil
		default:
			// Per-table SELECT returns timeout to simulate exhausted budget.
			return testQueryResult{}, context.DeadlineExceeded
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.Search(context.Background(), "local", "test_db", "main", "keyword", false, 10)

	var apiErr *model.APIError
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Status != 408 {
		t.Errorf("expected HTTP 408, got %d (%v)", apiErr.Status, err)
	}
}

// TestSearch_TableListTimeout_FailsLoud verifies that a timeout during table enumeration
// returns a loud 408 error rather than empty results.
func TestSearch_TableListTimeout_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		if strings.Contains(query, "SHOW FULL TABLES") {
			return testQueryResult{}, context.DeadlineExceeded
		}
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.Search(context.Background(), "local", "test_db", "main", "keyword", false, 10)

	var apiErr *model.APIError
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Status != 408 {
		t.Errorf("expected HTTP 408, got %d", apiErr.Status)
	}
}

// TestSearch_EmptyKeyword_ReturnsEmpty verifies that an empty keyword short-circuits
// without hitting the repository at all.
func TestSearch_EmptyKeyword_ReturnsEmpty(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		t.Fatalf("unexpected query with empty keyword: %s", query)
		return testQueryResult{}, nil
	})
	svc := newWithDeps(repo, testServiceConfig())

	resp, err := svc.Search(context.Background(), "local", "test_db", "main", "", false, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Results) != 0 {
		t.Errorf("expected empty results, got %d", len(resp.Results))
	}
	if resp.ReadIntegrity != model.ReadIntegrityComplete {
		t.Errorf("expected read_integrity=%q, got %q", model.ReadIntegrityComplete, resp.ReadIntegrity)
	}
	if len(repo.calls) != 0 {
		t.Errorf("expected no repo calls for empty keyword, got %v", repo.calls)
	}
}

func TestSearch_ShowColumnsFailure_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.Contains(query, "SHOW FULL TABLES"):
			return testQueryResult{
				columns: []string{"Tables_in_db", "Table_type"},
				rows:    [][]driver.Value{{"users", "BASE TABLE"}},
			}, nil
		case strings.Contains(query, "INFORMATION_SCHEMA.COLUMNS"):
			return testQueryResult{
				columns: []string{"TABLE_NAME", "COLUMN_NAME", "COLUMN_KEY"},
			}, nil
		case strings.Contains(query, "SHOW COLUMNS"):
			return testQueryResult{}, errors.New("boom")
		default:
			return testQueryResult{}, nil
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.Search(context.Background(), "local", "test_db", "main", "keyword", false, 10)
	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInternal {
		t.Fatalf("expected code %s, got %s", model.CodeInternal, apiErr.Code)
	}
}

func TestSearch_DataQueryFailure_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.Contains(query, "SHOW FULL TABLES"):
			return testQueryResult{
				columns: []string{"Tables_in_db", "Table_type"},
				rows:    [][]driver.Value{{"users", "BASE TABLE"}},
			}, nil
		case strings.Contains(query, "INFORMATION_SCHEMA.COLUMNS"):
			return testQueryResult{
				columns: []string{"TABLE_NAME", "COLUMN_NAME", "COLUMN_KEY"},
				rows: [][]driver.Value{
					{"users", "id", "PRI"},
					{"users", "name", ""},
				},
			}, nil
		case strings.Contains(query, "SELECT JSON_OBJECT("):
			return testQueryResult{}, errors.New("data query failed")
		default:
			return testQueryResult{}, nil
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.Search(context.Background(), "local", "test_db", "main", "keyword", false, 10)
	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInternal {
		t.Fatalf("expected code %s, got %s", model.CodeInternal, apiErr.Code)
	}
}

func TestSearch_MemoQueryFailure_FailsLoud(t *testing.T) {
	repo := newRecordingSessionRepo(t, func(refName, query string, args []driver.NamedValue) (testQueryResult, error) {
		switch {
		case strings.Contains(query, "SHOW FULL TABLES"):
			return testQueryResult{
				columns: []string{"Tables_in_db", "Table_type"},
				rows:    [][]driver.Value{{"users", "BASE TABLE"}},
			}, nil
		case strings.Contains(query, "INFORMATION_SCHEMA.COLUMNS"):
			return testQueryResult{
				columns: []string{"TABLE_NAME", "COLUMN_NAME", "COLUMN_KEY"},
				rows: [][]driver.Value{
					{"users", "id", "PRI"},
					{"users", "name", ""},
				},
			}, nil
		case strings.Contains(query, "SELECT JSON_OBJECT("):
			return testQueryResult{
				columns: []string{"pk_json", "id", "name"},
			}, nil
		case strings.Contains(query, "FROM `_memo_users`"):
			return testQueryResult{}, errors.New("memo query failed")
		default:
			return testQueryResult{}, nil
		}
	})
	svc := newWithDeps(repo, testServiceConfig())

	_, err := svc.Search(context.Background(), "local", "test_db", "main", "keyword", true, 10)
	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInternal {
		t.Fatalf("expected code %s, got %s", model.CodeInternal, apiErr.Code)
	}
}
