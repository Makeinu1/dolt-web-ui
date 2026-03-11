package service

// Track B-PR2: footer-first history read service tests.
//
// These tests verify the behaviour of parseApprovalFooter when used in a
// history-read context:
//
//   HistoryCommits_InvalidFooter_ReturnsIntegrityError
//     → a commit whose message contains a footer marker but is invalid must
//       not be silently skipped.
//
//   HistoryCommits_FooterMergedMismatch_PrefersFooter
//     → when footer data and a legacy merged/* record disagree, footer wins.
//
//   HistoryCommits_LegacyMergedAdapter_OnlyPreCutover
//     → footer-absent records may fall back to the merged/* adapter;
//       footer-present records must use footer only.
//
// NOTE: The actual integration of parseApprovalFooter into HistoryCommits
// is the B-PR2 production code change (footer-first read path).  These unit
// tests cover the parser and the adapter decision logic in isolation so that
// the invariants are captured before the read-path refactor.

import (
	"errors"
	"testing"
)

// TestHistoryCommits_InvalidFooter_ReturnsIntegrityError verifies that
// parseApprovalFooter returns a non-nil error (not nil,nil) when a commit
// message contains the Dolt-Approval-Schema marker but has missing or
// inconsistent required fields.  Callers must not silently skip such records.
func TestHistoryCommits_InvalidFooter_ReturnsIntegrityError(t *testing.T) {
	tests := []struct {
		name string
		msg  string
	}{
		{
			name: "schema present but Request-Id missing",
			msg: "承認マージ: foo\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Work-Item: foo\n" +
				"Work-Branch: wi/foo\n" +
				"Submitted-Work-Hash: " + validHash,
		},
		{
			name: "cross-field inconsistency",
			msg: "承認マージ: foo\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/OTHER\n" +
				"Work-Item: foo\n" +
				"Work-Branch: wi/foo\n" +
				"Submitted-Work-Hash: " + validHash,
		},
		{
			name: "invalid hash",
			msg: "承認マージ: foo\n\n" +
				"Dolt-Approval-Schema: v1\n" +
				"Request-Id: req/foo\n" +
				"Work-Item: foo\n" +
				"Work-Branch: wi/foo\n" +
				"Submitted-Work-Hash: NOTAHASH",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := parseApprovalFooter(tt.msg)
			if f != nil {
				t.Errorf("expected nil footer for invalid input, got %+v", f)
			}
			if err == nil {
				t.Error("expected integrity error, got nil — silent skip is forbidden")
			}
		})
	}
}

// TestHistoryCommits_FooterMergedMismatch_PrefersFooter verifies the adapter
// rule: when both a footer and a merged/* derived record are available for the
// same commit hash, the footer fields are preferred and the discrepancy is
// classified as index corruption (not a parse error).
//
// The rule is expressed as a pure function test over the merge-precedence logic:
// footer.WorkBranch != legacyWorkBranch → use footer.WorkBranch, flag corruption.
func TestHistoryCommits_FooterMergedMismatch_PrefersFooter(t *testing.T) {
	footerMsg := "承認マージ: task-1\n\n" +
		"Dolt-Approval-Schema: v1\n" +
		"Request-Id: req/task-1\n" +
		"Work-Item: task-1\n" +
		"Work-Branch: wi/task-1\n" +
		"Submitted-Work-Hash: " + validHash

	footer, err := parseApprovalFooter(footerMsg)
	if err != nil {
		t.Fatalf("parse error: %v", err)
	}
	if footer == nil {
		t.Fatal("expected footer, got nil")
	}

	// Simulate a legacy merged/* record claiming a different work branch.
	legacyWorkBranch := "wi/task-1-legacy"

	// Footer must win.
	if footer.WorkBranch == legacyWorkBranch {
		t.Error("footer and legacy should disagree in this test setup")
	}

	// resolveHistoryWorkBranch embodies: footer wins, index corruption flagged.
	resolved, indexCorruption := resolveHistoryWorkBranch(footer, legacyWorkBranch)
	if resolved != footer.WorkBranch {
		t.Errorf("expected footer.WorkBranch=%q, got %q", footer.WorkBranch, resolved)
	}
	if !indexCorruption {
		t.Error("expected index corruption flag when footer and merged/* disagree")
	}
}

// TestHistoryCommits_LegacyMergedAdapter_OnlyPreCutover verifies the adapter
// selection rule:
//   - footer present → use footer fields, ignore merged/* completely
//   - footer absent  → fall back to merged/* adapter (pre-cutover legacy)
func TestHistoryCommits_LegacyMergedAdapter_OnlyPreCutover(t *testing.T) {
	t.Run("footer present — ignore merged/* entirely", func(t *testing.T) {
		footerMsg := "subject\n\n" +
			"Dolt-Approval-Schema: v1\n" +
			"Request-Id: req/task-2\n" +
			"Work-Item: task-2\n" +
			"Work-Branch: wi/task-2\n" +
			"Submitted-Work-Hash: " + validHash

		f, err := parseApprovalFooter(footerMsg)
		if err != nil || f == nil {
			t.Fatalf("expected valid footer, err=%v f=%v", err, f)
		}

		source := selectHistorySource(f, "merged/task-2/01")
		if source != "footer" {
			t.Errorf("expected source=footer, got %q", source)
		}
	})

	t.Run("footer absent — use merged/* legacy adapter", func(t *testing.T) {
		noFooterMsg := "plain commit message without footer"

		f, err := parseApprovalFooter(noFooterMsg)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if f != nil {
			t.Fatalf("expected nil footer for plain message, got %+v", f)
		}

		source := selectHistorySource(f, "merged/task-2/01")
		if source != "legacy" {
			t.Errorf("expected source=legacy when footer absent, got %q", source)
		}
	})

	t.Run("footer absent, no merged/* tag — skip record", func(t *testing.T) {
		f, err := parseApprovalFooter("plain message")
		if err != nil || f != nil {
			t.Fatalf("unexpected state: err=%v f=%v", err, f)
		}

		source := selectHistorySource(f, "")
		if source != "skip" {
			t.Errorf("expected source=skip when both absent, got %q", source)
		}
	})
}

// TestHistoryCommits_FooterAbsent_ReturnsNilNotError verifies that a commit
// message with no approval footer returns (nil, nil) — i.e. the record is a
// normal commit, not a corruption.
func TestHistoryCommits_FooterAbsent_ReturnsNilNotError(t *testing.T) {
	messages := []string{
		"通常コミット",
		"fix: something\n\nbody paragraph",
		"feat: add table\n\nSome-Key: value-but-not-approval-schema",
	}
	for _, msg := range messages {
		f, err := parseApprovalFooter(msg)
		if err != nil {
			t.Errorf("message %q: expected nil error, got %v", msg, err)
		}
		if f != nil {
			t.Errorf("message %q: expected nil footer, got %+v", msg, f)
		}
	}
}

// --- Pure helper functions exercised by the tests above ---
// These are the adapter-logic helpers that will be used by the B-PR2 HistoryCommits refactor.

// resolveHistoryWorkBranch returns the authoritative work branch for a commit
// record, together with an indexCorruption flag when footer and merged/* disagree.
func resolveHistoryWorkBranch(footer *approvalFooter, legacyWorkBranch string) (workBranch string, indexCorruption bool) {
	if footer == nil {
		return legacyWorkBranch, false
	}
	if legacyWorkBranch != "" && footer.WorkBranch != legacyWorkBranch {
		return footer.WorkBranch, true // footer wins, index needs repair
	}
	return footer.WorkBranch, false
}

// selectHistorySource determines which data source to use for a history record.
// Returns "footer", "legacy", or "skip".
func selectHistorySource(footer *approvalFooter, mergedTagName string) string {
	if footer != nil {
		return "footer"
	}
	if mergedTagName != "" {
		return "legacy"
	}
	return "skip"
}

// Ensure the helper functions compile (they are package-internal, not exported).
var _ = errors.New // keep errors import live if needed
