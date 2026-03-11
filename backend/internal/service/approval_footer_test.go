package service

import (
	"strings"
	"testing"
)

const validHash = "0123456789abcdef0123456789abcdef"
const validHash2 = "fedcba9876543210fedcba9876543210"

func validFooter() approvalFooter {
	return approvalFooter{
		Schema:            "v1",
		RequestID:         "req/ProjectA",
		WorkItem:          "ProjectA",
		WorkBranch:        "wi/ProjectA",
		SubmittedWorkHash: validHash,
	}
}

// TestApprovalFooter_RoundTrip_Valid verifies that a valid footer survives build → parse intact.
func TestApprovalFooter_RoundTrip_Valid(t *testing.T) {
	tests := []struct {
		name    string
		subject string
		footer  approvalFooter
	}{
		{
			name:    "required fields only",
			subject: "承認マージ: ProjectA",
			footer:  validFooter(),
		},
		{
			name:    "with optional fields",
			subject: "承認マージ: feature-123",
			footer: approvalFooter{
				Schema:             "v1",
				RequestID:          "req/feature-123",
				WorkItem:           "feature-123",
				WorkBranch:         "wi/feature-123",
				SubmittedWorkHash:  validHash,
				SubmittedMainHash:  validHash2,
				RequestSubmittedAt: "2026-03-11T09:15:00Z",
			},
		},
		{
			name:    "work item with slash in name",
			subject: "承認マージ: team/task-99",
			footer: approvalFooter{
				Schema:            "v1",
				RequestID:         "req/team/task-99",
				WorkItem:          "team/task-99",
				WorkBranch:        "wi/team/task-99",
				SubmittedWorkHash: validHash,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg := buildApprovalFooter(tt.subject, tt.footer)

			got, err := parseApprovalFooter(msg)
			if err != nil {
				t.Fatalf("parse error: %v", err)
			}
			if got == nil {
				t.Fatal("expected footer, got nil")
			}

			if got.Schema != tt.footer.Schema {
				t.Errorf("Schema: got %q want %q", got.Schema, tt.footer.Schema)
			}
			if got.RequestID != tt.footer.RequestID {
				t.Errorf("RequestID: got %q want %q", got.RequestID, tt.footer.RequestID)
			}
			if got.WorkItem != tt.footer.WorkItem {
				t.Errorf("WorkItem: got %q want %q", got.WorkItem, tt.footer.WorkItem)
			}
			if got.WorkBranch != tt.footer.WorkBranch {
				t.Errorf("WorkBranch: got %q want %q", got.WorkBranch, tt.footer.WorkBranch)
			}
			if got.SubmittedWorkHash != tt.footer.SubmittedWorkHash {
				t.Errorf("SubmittedWorkHash: got %q want %q", got.SubmittedWorkHash, tt.footer.SubmittedWorkHash)
			}
			if got.SubmittedMainHash != tt.footer.SubmittedMainHash {
				t.Errorf("SubmittedMainHash: got %q want %q", got.SubmittedMainHash, tt.footer.SubmittedMainHash)
			}
			if got.RequestSubmittedAt != tt.footer.RequestSubmittedAt {
				t.Errorf("RequestSubmittedAt: got %q want %q", got.RequestSubmittedAt, tt.footer.RequestSubmittedAt)
			}
		})
	}
}

// TestApprovalFooter_RejectsMissingRequiredOrInconsistentFields verifies that
// footers with missing required fields or cross-field inconsistencies return an error.
func TestApprovalFooter_RejectsMissingRequiredOrInconsistentFields(t *testing.T) {
	tests := []struct {
		name    string
		msg     string
		wantErr string
	}{
		{
			name: "missing Request-Id",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "Request-Id",
		},
		{
			name: "missing Work-Item",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "Work-Item",
		},
		{
			name: "missing Work-Branch",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "Work-Branch",
		},
		{
			name: "missing Submitted-Work-Hash",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA",
			wantErr: "Submitted-Work-Hash",
		},
		{
			name: "Request-Id does not match Work-Item",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/OTHER\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "inconsistency",
		},
		{
			name: "Work-Branch does not match Work-Item",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/OTHER\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "inconsistency",
		},
		{
			name: "invalid Submitted-Work-Hash — too short",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: abc123",
			wantErr: "Submitted-Work-Hash",
		},
		{
			name: "invalid Submitted-Work-Hash — uppercase",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + strings.ToUpper(validHash),
			wantErr: "Submitted-Work-Hash",
		},
		{
			name: "invalid Submitted-Main-Hash",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + validHash + "\n" +
				"Submitted-Main-Hash: not-a-hash",
			wantErr: "Submitted-Main-Hash",
		},
		{
			name: "unsupported schema version",
			msg: "subject\n\n" +
				"Dolt-Approval-Schema: v2\n" +
				"Request-Id: req/ProjectA\n" +
				"Work-Item: ProjectA\n" +
				"Work-Branch: wi/ProjectA\n" +
				"Submitted-Work-Hash: " + validHash,
			wantErr: "unsupported",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseApprovalFooter(tt.msg)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil (footer=%+v)", tt.wantErr, got)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestApprovalFooter_IgnoresUnknownFields_And_HumanBody verifies that unknown trailer
// fields are silently ignored, and human-readable body content does not affect parse truth.
func TestApprovalFooter_IgnoresUnknownFields_And_HumanBody(t *testing.T) {
	msg := "承認マージ: ProjectA\n\n" +
		"This is a human-readable summary.\n" +
		"It can contain multiple lines.\n\n" +
		"Dolt-Approval-Schema: v1\n" +
		"Request-Id: req/ProjectA\n" +
		"Work-Item: ProjectA\n" +
		"Work-Branch: wi/ProjectA\n" +
		"Submitted-Work-Hash: " + validHash + "\n" +
		"X-Future-Field: some-value\n" +
		"X-Another-Unknown: ignored"

	got, err := parseApprovalFooter(msg)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	if got == nil {
		t.Fatal("expected footer, got nil")
	}

	// Required fields must be correct.
	if got.WorkItem != "ProjectA" {
		t.Errorf("WorkItem: got %q", got.WorkItem)
	}
	if got.SubmittedWorkHash != validHash {
		t.Errorf("SubmittedWorkHash: got %q", got.SubmittedWorkHash)
	}

	// Human body paragraph must not have been used as trailer data.
	// (parseTrailers only looks at the LAST paragraph)
}

// TestApprovalFooter_AbsentWhenNoFooterMarker verifies that a plain commit message
// (no Dolt-Approval-Schema key) returns nil, nil.
func TestApprovalFooter_AbsentWhenNoFooterMarker(t *testing.T) {
	tests := []struct {
		name string
		msg  string
	}{
		{"empty string", ""},
		{"single line subject", "commit message"},
		{"subject with body, no trailers", "subject\n\nbody paragraph"},
		{"trailers without approval schema", "subject\n\nSome-Key: some-value\nOther-Key: other"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseApprovalFooter(tt.msg)
			if err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
			if got != nil {
				t.Fatalf("expected nil footer, got %+v", got)
			}
		})
	}
}
