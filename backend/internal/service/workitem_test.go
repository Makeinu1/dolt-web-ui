package service

import "testing"

func TestWorkItemDerivation(t *testing.T) {
	workItem, ok := workItemFromWorkBranch("wi/task-123")
	if !ok {
		t.Fatalf("expected wi/task-123 to be a valid work branch")
	}
	if workItem != "task-123" {
		t.Fatalf("unexpected work item: got %q", workItem)
	}

	requestID, ok := requestIDFromWorkBranch("wi/task-123")
	if !ok {
		t.Fatalf("expected request id derivation to succeed")
	}
	if requestID != "req/task-123" {
		t.Fatalf("unexpected request id: got %q", requestID)
	}

	workBranch, ok := workBranchFromRequestID("req/task-123")
	if !ok {
		t.Fatalf("expected work branch derivation to succeed")
	}
	if workBranch != "wi/task-123" {
		t.Fatalf("unexpected work branch: got %q", workBranch)
	}
}

func TestParseArchiveTag(t *testing.T) {
	workItem, sequence, ok := parseArchiveTag("merged/task-123/07")
	if !ok {
		t.Fatalf("expected archive tag to parse")
	}
	if workItem != "task-123" {
		t.Fatalf("unexpected work item: got %q", workItem)
	}
	if sequence != 7 {
		t.Fatalf("unexpected sequence: got %d", sequence)
	}
}

func TestNormalizeWorkItemSearchKeyword(t *testing.T) {
	tests := map[string]string{
		"task-123":      "task-123",
		"wi/task-123":   "task-123",
		"req/task-123":  "task-123",
		"merged/task-1": "task-1",
	}
	for input, want := range tests {
		if got := normalizeWorkItemSearchKeyword(input); got != want {
			t.Fatalf("keyword %q: got %q want %q", input, got, want)
		}
	}
}
