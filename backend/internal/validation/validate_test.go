package validation

import "testing"

func TestValidateRevisionRefAllowsHistorySuffixes(t *testing.T) {
	refs := []string{
		"main",
		"audit",
		"wi/task-123",
		"abc123def456",
		"main^",
		"main~2",
	}

	for _, ref := range refs {
		if err := ValidateRevisionRef(ref); err != nil {
			t.Fatalf("ValidateRevisionRef(%q) returned error: %v", ref, err)
		}
	}
}

func TestIsAllowedBranchMatchesExactAndWildcardPatterns(t *testing.T) {
	patterns := []string{"main", "audit", "wi/*"}

	if !IsAllowedBranch("main", patterns) {
		t.Fatalf("expected main to be allowed")
	}
	if !IsAllowedBranch("wi/task-123", patterns) {
		t.Fatalf("expected work branch to be allowed by wildcard")
	}
	if IsAllowedBranch("scratch/tmp", patterns) {
		t.Fatalf("expected scratch/tmp to be rejected")
	}
}

func TestValidateDBName_AcceptsValidIdentifiers(t *testing.T) {
	valid := []string{
		"Test",
		"test_db",
		"MyDB",
		"_private",
		"db123",
	}
	for _, name := range valid {
		if err := ValidateDBName(name); err != nil {
			t.Errorf("ValidateDBName(%q) unexpected error: %v", name, err)
		}
	}
}

func TestValidateDBName_RejectsSQLInjectionChars(t *testing.T) {
	invalid := []string{
		"test;drop",
		"test'db",
		"test--db",
		"test`db",
		"test db",
		"123test",  // starts with digit
		"",
		"test-db",  // hyphen not allowed in identifiers
		"test/db",
	}
	for _, name := range invalid {
		if err := ValidateDBName(name); err == nil {
			t.Errorf("ValidateDBName(%q) expected error, got nil", name)
		}
	}
}

func TestValidateRevisionRef_RejectsSQLInjectionChars(t *testing.T) {
	// Only chars outside [a-zA-Z0-9._/\-\^~] are rejected.
	// Note: '-' (hyphen) is allowed (e.g. wi/task-001); '--' is two hyphens and also allowed
	// because branch names are always used in parameterized queries or backtick-quoted.
	invalid := []string{
		"main;DROP TABLE", // semicolon
		"main'branch",     // single quote
		"main branch",     // space not allowed
		"main`ref",        // backtick
	}
	for _, ref := range invalid {
		if err := ValidateRevisionRef(ref); err == nil {
			t.Errorf("ValidateRevisionRef(%q) expected error, got nil", ref)
		}
	}
}

func TestValidateRevisionRef_AcceptsHistoryExpressionsWithSpecialChars(t *testing.T) {
	// ^ and ~ are valid in revision refs (history expressions)
	valid := []string{
		"main^",
		"main~2",
		"main^^",
		"HEAD~10",
	}
	for _, ref := range valid {
		if err := ValidateRevisionRef(ref); err != nil {
			t.Errorf("ValidateRevisionRef(%q) unexpected error: %v", ref, err)
		}
	}
}

func TestValidateBranchName_RejectsSQLInjectionChars(t *testing.T) {
	// '-' (hyphen) is valid in branch names (e.g. wi/task-001), always used via ? params.
	invalid := []string{
		"main;drop",   // semicolon
		"main'branch", // single quote
		"main branch", // space
		"main`name",   // backtick
	}
	for _, name := range invalid {
		if err := ValidateBranchName(name); err == nil {
			t.Errorf("ValidateBranchName(%q) expected error, got nil", name)
		}
	}
}
