package main

import (
	"testing"

	"github.com/Makeinu1/dolt-web-ui/backend/internal/footer"
)

func TestScanApprovalFooters_ClassifiesValidFooter(t *testing.T) {
	commits := []footerScanCommit{
		{
			Hash: "aaaa",
			Message: footer.BuildApprovalFooter("merge subject", footer.ApprovalFooter{
				Schema:            "v1",
				RequestID:         "req/task-123",
				WorkItem:          "task-123",
				WorkBranch:        "wi/task-123",
				SubmittedWorkHash: "0123456789abcdef0123456789abcdef",
			}),
		},
	}

	results, invalidCount := scanApprovalFooters(commits)

	if invalidCount != 0 {
		t.Fatalf("expected 0 invalid footers, got %d", invalidCount)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Status != footerScanStatusValid {
		t.Fatalf("expected valid status, got %s", results[0].Status)
	}
	if results[0].WorkItem != "task-123" {
		t.Fatalf("expected work item task-123, got %s", results[0].WorkItem)
	}
	if results[0].Problem != "" {
		t.Fatalf("expected empty problem, got %q", results[0].Problem)
	}
}

func TestScanApprovalFooters_ClassifiesInvalidFooter(t *testing.T) {
	commits := []footerScanCommit{
		{
			Hash: "bbbb",
			Message: "merge subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/task-123\n" +
				"Work-Item: task-123\n",
		},
	}

	results, invalidCount := scanApprovalFooters(commits)

	if invalidCount != 1 {
		t.Fatalf("expected 1 invalid footer, got %d", invalidCount)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Status != footerScanStatusInvalid {
		t.Fatalf("expected invalid status, got %s", results[0].Status)
	}
	if results[0].Problem == "" {
		t.Fatal("expected invalid footer problem to be recorded")
	}
}

func TestScanApprovalFooters_ClassifiesNoFooter(t *testing.T) {
	commits := []footerScanCommit{
		{Hash: "cccc", Message: "plain commit message"},
	}

	results, invalidCount := scanApprovalFooters(commits)

	if invalidCount != 0 {
		t.Fatalf("expected 0 invalid footers, got %d", invalidCount)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Status != footerScanStatusNoFooter {
		t.Fatalf("expected no_footer status, got %s", results[0].Status)
	}
	if results[0].WorkItem != "" {
		t.Fatalf("expected empty work item, got %s", results[0].WorkItem)
	}
	if results[0].Problem != "" {
		t.Fatalf("expected empty problem, got %q", results[0].Problem)
	}
}
