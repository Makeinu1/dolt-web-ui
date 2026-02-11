package validation

import (
	"fmt"
	"regexp"
)

var safeIdentifierRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

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

// IsMainBranch returns true if the branch name is "main".
func IsMainBranch(branchName string) bool {
	return branchName == "main"
}
