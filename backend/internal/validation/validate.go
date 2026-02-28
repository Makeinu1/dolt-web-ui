package validation

import (
	"fmt"
	"regexp"
)

var safeIdentifierRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// safeRefRe validates Dolt refs: branch names (wi/ticket/01), commit hashes, tags.
// Allows alphanumeric, dot, underscore, hyphen, and forward slash.
var safeRefRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-]+$`)

// IsSafeIdentifier checks if a string is safe to use as a SQL identifier.
func IsSafeIdentifier(s string) bool {
	return safeIdentifierRe.MatchString(s)
}

// ValidateIdentifier returns an error if the identifier is not safe for SQL use.
func ValidateIdentifier(name, value string) error {
	if !IsSafeIdentifier(value) {
		return fmt.Errorf("%s contains invalid characters: %q", name, value)
	}
	return nil
}

// ValidateDBName validates a database name for safe SQL embedding.
func ValidateDBName(dbName string) error {
	if !safeIdentifierRe.MatchString(dbName) {
		return fmt.Errorf("database name contains invalid characters: %q", dbName)
	}
	return nil
}

// ValidateBranchName validates a branch name for safe SQL embedding.
// Branch names may contain forward slashes (e.g. wi/ticket/01).
func ValidateBranchName(branchName string) error {
	if !safeRefRe.MatchString(branchName) {
		return fmt.Errorf("branch name contains invalid characters: %q", branchName)
	}
	return nil
}

// IsProtectedBranch returns true if the branch is protected from direct writes.
// Protected branches: "main" (source of truth) and "audit" (PSX import snapshot).
func IsProtectedBranch(branchName string) bool {
	return branchName == "main" || branchName == "audit"
}
