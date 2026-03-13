package service

import (
	"errors"
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/model"
)

// Tests for pure functions in commit.go that don't require a DB connection.

func TestNormalizePkJSON(t *testing.T) {
	tests := []struct {
		name string
		in   map[string]interface{}
		want []string // expected key order (alphabetical)
	}{
		{
			name: "single key is unchanged",
			in:   map[string]interface{}{"id": 1},
			want: []string{"id"},
		},
		{
			name: "two keys are sorted alphabetically",
			in:   map[string]interface{}{"z": 1, "a": 2},
			want: []string{"a", "z"},
		},
		{
			name: "three keys are sorted alphabetically",
			in:   map[string]interface{}{"cat": 1, "apple": 2, "banana": 3},
			want: []string{"apple", "banana", "cat"},
		},
		{
			name: "already sorted is unchanged",
			in:   map[string]interface{}{"a": 1, "b": 2, "c": 3},
			want: []string{"a", "b", "c"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := normalizePkJSON(tc.in)
			// Verify all keys are present
			if len(result) != len(tc.in) {
				t.Errorf("got %d keys, want %d", len(result), len(tc.in))
			}
			for _, k := range tc.want {
				if _, ok := result[k]; !ok {
					t.Errorf("missing key %q in result", k)
				}
			}
			// Verify values are preserved
			for k, v := range tc.in {
				if result[k] != v {
					t.Errorf("key %q: got %v, want %v", k, result[k], v)
				}
			}
		})
	}
}

func TestNormalizePkJSON_SingleKey_PassThrough(t *testing.T) {
	// Single-key maps are returned as-is (optimization path).
	in := map[string]interface{}{"id": 42}
	out := normalizePkJSON(in)
	if len(out) != 1 {
		t.Fatalf("expected 1 key, got %d", len(out))
	}
	if out["id"] != 42 {
		t.Errorf("expected id=42, got %v", out["id"])
	}
}

func TestNormalizePkJSON_ValuesPreserved(t *testing.T) {
	in := map[string]interface{}{
		"name": "Alice",
		"age":  30,
		"id":   "usr-001",
	}
	out := normalizePkJSON(in)
	if out["name"] != "Alice" {
		t.Errorf("name: got %v, want Alice", out["name"])
	}
	if out["age"] != 30 {
		t.Errorf("age: got %v, want 30", out["age"])
	}
	if out["id"] != "usr-001" {
		t.Errorf("id: got %v, want usr-001", out["id"])
	}
}

func TestValidateMemoOpsAgainstRowOps_RejectsMemoUpsertForDeletedRow(t *testing.T) {
	err := validateMemoOpsAgainstRowOps([]model.CommitOp{
		{
			Type:  "delete",
			Table: "users",
			PK:    map[string]interface{}{"id": 1},
			Values: map[string]interface{}{},
		},
		{
			Type:  "insert",
			Table: "_memo_users",
			Values: map[string]interface{}{
				"pk_value":    `{"id":1}`,
				"column_name": "role",
				"memo_text":   "should fail",
			},
		},
	})

	var apiErr *model.APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T: %v", err, err)
	}
	if apiErr.Code != model.CodeInvalidArgument {
		t.Fatalf("expected %s, got %s", model.CodeInvalidArgument, apiErr.Code)
	}
}

func TestValidateMemoOpsAgainstRowOps_AllowsMemoDeleteForDeletedRow(t *testing.T) {
	err := validateMemoOpsAgainstRowOps([]model.CommitOp{
		{
			Type:  "delete",
			Table: "users",
			PK:    map[string]interface{}{"id": 1},
			Values: map[string]interface{}{},
		},
		{
			Type: "delete",
			Table: "_memo_users",
			PK: map[string]interface{}{
				"pk_value":    `{"id":1}`,
				"column_name": "role",
			},
			Values: map[string]interface{}{},
		},
	})
	if err != nil {
		t.Fatalf("expected memo delete to be allowed, got %v", err)
	}
}
