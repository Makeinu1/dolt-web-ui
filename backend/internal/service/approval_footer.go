package service

import (
	"github.com/Makeinu1/dolt-web-ui/backend/internal/footer"
)

// approvalFooter is a type alias for the shared footer package type.
// Using a type alias preserves backward compatibility for all existing usages
// within this package (struct literals, field access, etc.).
type approvalFooter = footer.ApprovalFooter

// buildApprovalFooter constructs a commit message with human-readable subject and
// machine-readable trailer block. Delegates to the shared footer package.
func buildApprovalFooter(humanSubject string, f approvalFooter) string {
	return footer.BuildApprovalFooter(humanSubject, f)
}

// parseApprovalFooter extracts the approval footer from a commit message.
// Returns (nil, nil) if no approval footer is present (normal commit or pre-cutover).
// Returns (nil, err) if a footer is present but invalid (data corruption — must not silent-skip).
// Delegates to the shared footer package.
func parseApprovalFooter(commitMsg string) (*approvalFooter, error) {
	return footer.ParseApprovalFooter(commitMsg)
}
