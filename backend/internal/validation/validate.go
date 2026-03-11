package validation

import (
	"fmt"
	"regexp"
	"strings"
)

var safeIdentifierRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// safeRefRe validates Dolt refs: branch names (wi/ticket-123), commit hashes, tags.
// Allows alphanumeric, dot, underscore, hyphen, and forward slash.
var safeRefRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-]+$`)
var safeRevisionRefRe = regexp.MustCompile(`^[a-zA-Z0-9._/\-\^~]+$`)
var workBranchRe = regexp.MustCompile(`^wi/[A-Za-z0-9._-]+$`)

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
// Branch names may contain forward slashes (e.g. wi/ticket-123).
func ValidateBranchName(branchName string) error {
	if !safeRefRe.MatchString(branchName) {
		return fmt.Errorf("branch name contains invalid characters: %q", branchName)
	}
	return nil
}

// ValidateRevisionRef validates a read-only revision ref, including history suffixes.
func ValidateRevisionRef(ref string) error {
	if !safeRevisionRefRe.MatchString(ref) {
		return fmt.Errorf("ref contains invalid characters: %q", ref)
	}
	return nil
}

// IsWorkBranchName returns true when the ref matches the canonical wi/<WorkItem> pattern.
func IsWorkBranchName(branchName string) bool {
	return workBranchRe.MatchString(branchName)
}

// MatchesAllowedBranchPattern returns true when branchName matches an exact pattern
// or a terminal wildcard pattern such as wi/*.
func MatchesAllowedBranchPattern(branchName, pattern string) bool {
	if pattern == "" {
		return false
	}
	if branchName == pattern {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(branchName, strings.TrimSuffix(pattern, "*"))
	}
	return false
}

// IsAllowedBranch returns true when branchName is included in the configured allowlist.
func IsAllowedBranch(branchName string, patterns []string) bool {
	for _, pattern := range patterns {
		if MatchesAllowedBranchPattern(branchName, pattern) {
			return true
		}
	}
	return false
}

// IsProtectedBranch returns true if the branch is protected from direct writes.
// Protected branches: "main" (source of truth) and "audit" (PSX import snapshot).
func IsProtectedBranch(branchName string) bool {
	return branchName == "main" || branchName == "audit"
}
